use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use http::header::{HeaderName, HeaderValue};
use rand_core::OsRng;
#[cfg(not(target_os = "android"))]
use rmcp::transport::TokioChildProcess;
use rmcp::{
    model::{CallToolRequestParams, ClientCapabilities, ClientInfo, Implementation},
    transport::streamable_http_client::StreamableHttpClientTransportConfig,
    transport::StreamableHttpClientTransport,
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use sys_locale::get_locale;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
#[cfg(not(target_os = "android"))]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(not(target_os = "android"))]
use tokio::net::TcpListener;
#[cfg(not(target_os = "android"))]
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use uuid::Uuid;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod desktop_shell;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod browser_manager;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod computer_manager;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod ax_assist;

mod kb;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod imported_archive;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod legacy_rename;
mod workspace;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
enum McpTransportConfig {
    #[serde(rename = "stdio")]
    Stdio {
        command: String,
        args: Vec<String>,
        env: Option<HashMap<String, String>>,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        headers: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Clone)]
struct McpServerState {
    id: String,
    transport: McpTransportConfig,
    connected: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolInfo {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Default)]
struct AppState {
    store: Mutex<HashMap<String, Value>>,
    blobs: Mutex<HashMap<String, String>>,
    mcp_servers: Mutex<HashMap<String, McpServerState>>,
    openclaw_streams: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    next_mcp_id: AtomicU64,
    kb: kb::KbRuntime,
    /// Cancels an in-flight local OAuth callback listener (desktop PKCE).
    oauth_cancel: Mutex<Option<oneshot::Sender<()>>>,
    workspace: workspace::WorkspaceRuntime,
}

type CommandResult<T> = Result<T, String>;

type OpenClawSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawAuth {
    token: Option<String>,
    password: Option<String>,
    cloudflare_client_id: Option<String>,
    cloudflare_client_secret: Option<String>,
}

impl OpenClawAuth {
    fn token(&self) -> Option<&str> {
        self.token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn password(&self) -> Option<&str> {
        self.password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn cloudflare_client_id(&self) -> Option<&str> {
        self.cloudflare_client_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn cloudflare_client_secret(&self) -> Option<&str> {
        self.cloudflare_client_secret
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawGatewayRequest {
    url: String,
    #[serde(default)]
    auth: OpenClawAuth,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawInvokeRequest {
    stream_id: String,
    url: String,
    #[serde(default)]
    auth: OpenClawAuth,
    agent_id: String,
    message: String,
    session_id: Option<String>,
    session_key: Option<String>,
    extra_system_prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawInvokeAccepted {
    invocation_id: String,
    run_id: String,
}

#[derive(Debug, Serialize)]
struct OpenClawRequestFrame<'a> {
    #[serde(rename = "type")]
    frame_type: &'static str,
    id: &'a str,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
struct OpenClawResponseFrame {
    id: Value,
    ok: bool,
    payload: Option<Value>,
    error: Option<OpenClawErrorFrame>,
}

#[derive(Debug, Deserialize)]
struct OpenClawEventFrame {
    event: String,
    #[serde(alias = "data")]
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct OpenClawConnectChallenge {
    nonce: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestPayload {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    status: u16,
    headers: HashMap<String, String>,
    body_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawDeviceIdentityStore {
    version: u8,
    device_id: String,
    public_key: String,
    private_key: String,
    created_at_ms: i64,
}

#[derive(Debug, Clone)]
struct OpenClawDeviceIdentity {
    device_id: String,
    public_key_base64url: String,
    signing_key: SigningKey,
}

#[derive(Debug, Deserialize)]
struct OpenClawErrorFrame {
    message: String,
    details: Option<Value>,
}

fn get_store_path(app: &AppHandle, filename: &str) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    path.push(filename);
    path
}

fn load_store_from_disk(app: &AppHandle, filename: &str) -> HashMap<String, Value> {
    let path = get_store_path(app, filename);
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str(&content) {
            return map;
        }
    }
    HashMap::new()
}

fn load_blobs_from_disk(app: &AppHandle, filename: &str) -> HashMap<String, String> {
    let path = get_store_path(app, filename);
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str(&content) {
            return map;
        }
    }
    HashMap::new()
}

fn save_store_to_disk(app: &AppHandle, filename: &str, store: &HashMap<String, Value>) {
    let path = get_store_path(app, filename);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string(store) {
        let _ = fs::write(path, content);
    }
}

fn save_blobs_to_disk(app: &AppHandle, filename: &str, blobs: &HashMap<String, String>) {
    let path = get_store_path(app, filename);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string(blobs) {
        let _ = fs::write(path, content);
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const OPENCLAW_CONNECT_CHALLENGE_TIMEOUT_MS: u64 = 10_000;
const OPENCLAW_PROTOCOL_VERSION: i64 = 3;
const OPENCLAW_ROLE: &str = "operator";
const OPENCLAW_CLIENT_ID: &str = "gateway-client";
const OPENCLAW_CLIENT_MODE: &str = "backend";

fn openclaw_device_identity_path(app: &AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    path.push("openclaw");
    path.push("device-identity.json");
    path
}

fn openclaw_normalize_metadata_for_auth(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

fn openclaw_hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn openclaw_derive_device_id(public_key_bytes: &[u8]) -> String {
    let digest = Sha256::digest(public_key_bytes);
    openclaw_hex_encode(&digest)
}

fn openclaw_write_device_identity_store(
    path: &PathBuf,
    store: &OpenClawDeviceIdentityStore,
) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("create OpenClaw identity dir failed: {err}"))?;
    }

    let serialized = serde_json::to_string_pretty(store)
        .map_err(|err| format!("serialize OpenClaw identity failed: {err}"))?;
    let mut file = fs::File::create(path)
        .map_err(|err| format!("create OpenClaw identity file failed: {err}"))?;
    file.write_all(serialized.as_bytes())
        .map_err(|err| format!("write OpenClaw identity file failed: {err}"))?;
    file.write_all(b"\n")
        .map_err(|err| format!("finalize OpenClaw identity file failed: {err}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

fn openclaw_load_or_create_device_identity(
    app: &AppHandle,
) -> CommandResult<OpenClawDeviceIdentity> {
    let identity_path = openclaw_device_identity_path(app);

    if let Ok(raw) = fs::read_to_string(&identity_path) {
        if let Ok(mut store) = serde_json::from_str::<OpenClawDeviceIdentityStore>(&raw) {
            let private_bytes = URL_SAFE_NO_PAD
                .decode(store.private_key.as_bytes())
                .map_err(|err| format!("decode OpenClaw private key failed: {err}"))?;
            let private_bytes: [u8; 32] = private_bytes
                .as_slice()
                .try_into()
                .map_err(|_| "OpenClaw private key has invalid length".to_string())?;
            let signing_key = SigningKey::from_bytes(&private_bytes);
            let public_key_base64url =
                URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());
            let derived_device_id =
                openclaw_derive_device_id(&signing_key.verifying_key().to_bytes());

            let needs_refresh = store.device_id != derived_device_id
                || store.public_key != public_key_base64url
                || store.version != 1;
            if needs_refresh {
                store.version = 1;
                store.device_id = derived_device_id.clone();
                store.public_key = public_key_base64url.clone();
                let _ = openclaw_write_device_identity_store(&identity_path, &store);
            }

            return Ok(OpenClawDeviceIdentity {
                device_id: derived_device_id,
                public_key_base64url,
                signing_key,
            });
        }
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key = signing_key.verifying_key().to_bytes();
    let device_id = openclaw_derive_device_id(&public_key);
    let private_key_base64url = URL_SAFE_NO_PAD.encode(signing_key.to_bytes());
    let public_key_base64url = URL_SAFE_NO_PAD.encode(public_key);
    let store = OpenClawDeviceIdentityStore {
        version: 1,
        device_id: device_id.clone(),
        public_key: public_key_base64url.clone(),
        private_key: private_key_base64url,
        created_at_ms: now_ms(),
    };
    openclaw_write_device_identity_store(&identity_path, &store)?;

    Ok(OpenClawDeviceIdentity {
        device_id,
        public_key_base64url,
        signing_key,
    })
}

fn openclaw_build_device_auth_payload_v3(
    identity: &OpenClawDeviceIdentity,
    role: &str,
    scopes: &[&str],
    nonce: &str,
    signed_at_ms: i64,
    signature_token: Option<&str>,
    platform: &str,
    device_family: Option<&str>,
) -> String {
    let scopes = scopes.join(",");
    let token = signature_token.unwrap_or_default();
    let normalized_platform = openclaw_normalize_metadata_for_auth(Some(platform));
    let normalized_device_family = openclaw_normalize_metadata_for_auth(device_family);

    [
        "v3".to_string(),
        identity.device_id.clone(),
        OPENCLAW_CLIENT_ID.to_string(),
        OPENCLAW_CLIENT_MODE.to_string(),
        role.to_string(),
        scopes,
        signed_at_ms.to_string(),
        token.to_string(),
        nonce.to_string(),
        normalized_platform,
        normalized_device_family,
    ]
    .join("|")
}

fn openclaw_build_connect_params(
    auth: &OpenClawAuth,
    challenge_nonce: &str,
    identity: &OpenClawDeviceIdentity,
) -> Value {
    let role = OPENCLAW_ROLE;
    let scopes = [String::from("operator.admin")];
    let scopes_refs = scopes
        .iter()
        .map(std::string::String::as_str)
        .collect::<Vec<_>>();
    let signed_at_ms = now_ms();
    let platform = map_platform();
    let device_family = map_arch();
    let signature_payload = openclaw_build_device_auth_payload_v3(
        identity,
        role,
        &scopes_refs,
        challenge_nonce,
        signed_at_ms,
        auth.token(),
        &platform,
        Some(device_family.as_str()),
    );
    let signature = URL_SAFE_NO_PAD.encode(
        identity
            .signing_key
            .sign(signature_payload.as_bytes())
            .to_bytes(),
    );

    let mut auth_map = serde_json::Map::new();
    if let Some(token) = auth.token() {
        auth_map.insert("token".to_string(), Value::String(token.to_string()));
    } else if let Some(password) = auth.password() {
        auth_map.insert("password".to_string(), Value::String(password.to_string()));
    }

    let mut params = serde_json::Map::new();
    params.insert(
        "minProtocol".to_string(),
        Value::Number(OPENCLAW_PROTOCOL_VERSION.into()),
    );
    params.insert(
        "maxProtocol".to_string(),
        Value::Number(OPENCLAW_PROTOCOL_VERSION.into()),
    );
    params.insert(
        "client".to_string(),
        json!({
          "id": OPENCLAW_CLIENT_ID,
          "version": env!("CARGO_PKG_VERSION"),
          "platform": platform,
          "deviceFamily": device_family,
          "mode": OPENCLAW_CLIENT_MODE,
        }),
    );
    params.insert("role".to_string(), Value::String(role.to_string()));
    params.insert(
        "scopes".to_string(),
        Value::Array(scopes.into_iter().map(Value::String).collect()),
    );
    params.insert("caps".to_string(), Value::Array(vec![]));
    params.insert("commands".to_string(), Value::Array(vec![]));
    params.insert(
        "permissions".to_string(),
        Value::Object(serde_json::Map::new()),
    );

    if !auth_map.is_empty() {
        params.insert("auth".to_string(), Value::Object(auth_map));
    }
    if let Some(locale) = get_locale().filter(|locale| !locale.trim().is_empty()) {
        params.insert("locale".to_string(), Value::String(locale));
    }
    params.insert(
        "userAgent".to_string(),
        Value::String(format!("dango-tauri/{}", env!("CARGO_PKG_VERSION"))),
    );
    params.insert(
        "device".to_string(),
        json!({
          "id": identity.device_id,
          "publicKey": identity.public_key_base64url,
          "signature": signature,
          "signedAt": signed_at_ms,
          "nonce": challenge_nonce,
        }),
    );

    Value::Object(params)
}

fn openclaw_build_connect_params_without_device(auth: &OpenClawAuth) -> Value {
    let role = OPENCLAW_ROLE;
    let scopes = [String::from("operator.admin")];
    let platform = map_platform();
    let device_family = map_arch();

    let mut auth_map = serde_json::Map::new();
    if let Some(token) = auth.token() {
        auth_map.insert("token".to_string(), Value::String(token.to_string()));
    } else if let Some(password) = auth.password() {
        auth_map.insert("password".to_string(), Value::String(password.to_string()));
    }

    let mut params = serde_json::Map::new();
    params.insert(
        "minProtocol".to_string(),
        Value::Number(OPENCLAW_PROTOCOL_VERSION.into()),
    );
    params.insert(
        "maxProtocol".to_string(),
        Value::Number(OPENCLAW_PROTOCOL_VERSION.into()),
    );
    params.insert(
        "client".to_string(),
        json!({
          "id": OPENCLAW_CLIENT_ID,
          "version": env!("CARGO_PKG_VERSION"),
          "platform": platform,
          "deviceFamily": device_family,
          "mode": OPENCLAW_CLIENT_MODE,
        }),
    );
    params.insert("role".to_string(), Value::String(role.to_string()));
    params.insert(
        "scopes".to_string(),
        Value::Array(scopes.into_iter().map(Value::String).collect()),
    );
    params.insert("caps".to_string(), Value::Array(vec![]));
    params.insert("commands".to_string(), Value::Array(vec![]));
    params.insert(
        "permissions".to_string(),
        Value::Object(serde_json::Map::new()),
    );
    if !auth_map.is_empty() {
        params.insert("auth".to_string(), Value::Object(auth_map));
    }
    if let Some(locale) = get_locale().filter(|locale| !locale.trim().is_empty()) {
        params.insert("locale".to_string(), Value::String(locale));
    }
    params.insert(
        "userAgent".to_string(),
        Value::String(format!("dango-tauri/{}", env!("CARGO_PKG_VERSION"))),
    );

    Value::Object(params)
}

fn openclaw_response_id_to_string(id: &Value) -> Option<String> {
    if let Some(value) = id.as_str() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_u64() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_i64() {
        return Some(value.to_string());
    }
    None
}

fn openclaw_map_hello_to_connect_response(payload: &Value) -> Value {
    if payload.get("type").and_then(Value::as_str) != Some("hello-ok") {
        return payload.clone();
    }

    let state_presence = payload
        .get("snapshot")
        .and_then(|snapshot| snapshot.get("stateVersion"))
        .and_then(|value| value.get("presence"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let state_health = payload
        .get("snapshot")
        .and_then(|snapshot| snapshot.get("stateVersion"))
        .and_then(|value| value.get("health"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let state_version = state_presence.max(state_health);

    let uptime_ms = payload
        .get("snapshot")
        .and_then(|snapshot| snapshot.get("uptimeMs"))
        .and_then(Value::as_i64)
        .unwrap_or(0);

    let methods = payload
        .get("features")
        .and_then(|features| features.get("methods"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_method = |prefix: &str| {
        methods
            .iter()
            .filter_map(Value::as_str)
            .any(|method| method == prefix || method.starts_with(&format!("{prefix}.")))
    };

    json!({
      "status": "ok",
      "stateVersion": state_version,
      "uptimeMs": uptime_ms,
      "limits": {},
      "policy": {
        "tickIntervalMs": payload
          .get("policy")
          .and_then(|policy| policy.get("tickIntervalMs"))
          .and_then(Value::as_i64),
      },
      "features": {
        "streaming": true,
        "agentInvocation": has_method("agent"),
        "sessionManagement": has_method("sessions"),
        "presence": has_method("system-presence"),
        "toolExecution": has_method("tools"),
      },
      "hello": payload,
    })
}

fn map_platform() -> String {
    match std::env::consts::OS {
        "macos" => "darwin".to_string(),
        "windows" => "win32".to_string(),
        "android" => "android".to_string(),
        other => other.to_string(),
    }
}

fn map_arch() -> String {
    match std::env::consts::ARCH {
        "aarch64" => "arm64".to_string(),
        "x86_64" => "x64".to_string(),
        "arm" => "arm".to_string(),
        other => other.to_string(),
    }
}

fn get_arg<'a>(args: &'a [Value], idx: usize) -> CommandResult<&'a Value> {
    args.get(idx)
        .ok_or_else(|| format!("missing argument at index {idx}"))
}

fn get_arg_string(args: &[Value], idx: usize) -> CommandResult<String> {
    get_arg(args, idx)?
        .as_str()
        .map(std::string::ToString::to_string)
        .ok_or_else(|| format!("argument {idx} is not a string"))
}

/// Expand leading `~` to the user home directory (for reading ~/.codex/auth.json etc.).
fn expand_user_path(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

fn get_arg_bool(args: &[Value], idx: usize) -> CommandResult<bool> {
    get_arg(args, idx)?
        .as_bool()
        .ok_or_else(|| format!("argument {idx} is not a boolean"))
}

async fn http_request(request: &HttpRequestPayload) -> CommandResult<Value> {
    let client = reqwest::Client::new();
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|err| format!("invalid http method: {err}"))?;

    let mut builder = client.request(method, &request.url);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|err| format!("invalid header name '{key}': {err}"))?;
            let header_value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|err| format!("invalid header value for '{key}': {err}"))?;
            builder = builder.header(header_name, header_value);
        }
    }

    if let Some(body_base64) = &request.body_base64 {
        let body = STANDARD
            .decode(body_base64)
            .map_err(|err| format!("invalid http body encoding: {err}"))?;
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("http request failed: {err}"))?;
    let status = response.status().as_u16();

    let mut headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(value_str) = value.to_str() {
            headers
                .entry(key.as_str().to_string())
                .and_modify(|existing: &mut String| {
                    existing.push_str(", ");
                    existing.push_str(value_str);
                })
                .or_insert_with(|| value_str.to_string());
        }
    }

    let body_base64 = STANDARD.encode(
        response
            .bytes()
            .await
            .map_err(|err| format!("http response read failed: {err}"))?,
    );

    serde_json::to_value(HttpResponsePayload {
        status,
        headers,
        body_base64,
    })
    .map_err(|err| format!("serialize http response failed: {err}"))
}

fn default_settings() -> Value {
    json!({
      "mcp": {
        "enabledBuiltinServers": [],
        "servers": []
      },
      "shortcuts": {
        "quickToggle": "CommandOrControl+Shift+Space"
      }
    })
}

fn default_config() -> Value {
    json!({
      "uuid": Uuid::new_v4().to_string()
    })
}

fn openclaw_transport_error_event(run_id: &str, message: &str) -> Value {
    json!({
      "type": "done",
      "invocationId": run_id,
      "runId": run_id,
      "status": "error",
      "error": {
        "code": "transport_error",
        "message": message,
      }
    })
}

async fn openclaw_connect_socket(url: &str, auth: &OpenClawAuth) -> CommandResult<OpenClawSocket> {
    let mut request = url
        .into_client_request()
        .map_err(|err| format!("openclaw websocket request build failed: {err}"))?;

    // Some OpenClaw gateway deployments enforce stricter non-local handshake checks.
    // Explicit Origin + User-Agent avoids the "origin=n/a, ua=n/a" rejection path.
    let user_agent = format!("dango-tauri/{}", env!("CARGO_PKG_VERSION"));
    if let Ok(value) = HeaderValue::from_str(&user_agent) {
        request.headers_mut().insert("User-Agent", value);
    }

    if let Ok(parsed_url) = url::Url::parse(url) {
        let origin_scheme = if parsed_url.scheme() == "wss" {
            "https"
        } else if parsed_url.scheme() == "ws" {
            "http"
        } else {
            parsed_url.scheme()
        };
        if let Some(host) = parsed_url.host_str() {
            let origin = if let Some(port) = parsed_url.port() {
                format!("{origin_scheme}://{host}:{port}")
            } else {
                format!("{origin_scheme}://{host}")
            };
            if let Ok(value) = HeaderValue::from_str(&origin) {
                request.headers_mut().insert("Origin", value);
            }
        }
    }

    if let Some(client_id) = auth.cloudflare_client_id() {
        let value = HeaderValue::from_str(client_id)
            .map_err(|err| format!("invalid CF Access client id header: {err}"))?;
        request.headers_mut().insert("CF-Access-Client-Id", value);
    }

    if let Some(client_secret) = auth.cloudflare_client_secret() {
        let value = HeaderValue::from_str(client_secret)
            .map_err(|err| format!("invalid CF Access client secret header: {err}"))?;
        request
            .headers_mut()
            .insert("CF-Access-Client-Secret", value);
    }

    let (socket, response) = connect_async(request)
        .await
        .map_err(|err| format!("openclaw websocket connect failed: {err}"))?;

    eprintln!(
        "[openclaw-debug] websocket upgrade ok, status={:?}, headers={:?}",
        response.status(),
        response.headers()
    );

    Ok(socket)
}

async fn openclaw_send_request(
    socket: &mut OpenClawSocket,
    id: &str,
    method: &str,
    params: Value,
) -> CommandResult<()> {
    let frame = OpenClawRequestFrame {
        frame_type: "req",
        id,
        method,
        params,
    };
    let payload = serde_json::to_string(&frame)
        .map_err(|err| format!("openclaw request serialize failed: {err}"))?;
    socket
        .send(Message::Text(payload))
        .await
        .map_err(|err| format!("openclaw websocket send failed: {err}"))
}

async fn openclaw_wait_for_connect_challenge(
    socket: &mut OpenClawSocket,
) -> CommandResult<Option<OpenClawConnectChallenge>> {
    eprintln!(
        "[openclaw-debug] waiting for connect challenge (timeout {}ms)",
        OPENCLAW_CONNECT_CHALLENGE_TIMEOUT_MS
    );
    tokio::time::timeout(
        Duration::from_millis(OPENCLAW_CONNECT_CHALLENGE_TIMEOUT_MS),
        async {
            while let Some(message) = socket.next().await {
                let message = message.map_err(|err| {
                    eprintln!("[openclaw-debug] websocket read error: {err}");
                    format!("openclaw websocket read failed: {err}")
                })?;
                match &message {
                    Message::Text(text) => {
                        eprintln!(
                            "[openclaw-debug] received text frame: {}",
                            &text[..text.len().min(200)]
                        );
                        let frame: Value = serde_json::from_str(text)
                            .map_err(|err| format!("openclaw frame parse failed: {err}"))?;
                        let frame_type = frame
                            .get("type")
                            .and_then(Value::as_str)
                            .ok_or_else(|| "openclaw frame missing type".to_string())?;
                        if frame_type != "event" {
                            continue;
                        }

                        let event_frame: OpenClawEventFrame = serde_json::from_value(frame)
                            .map_err(|err| format!("openclaw event decode failed: {err}"))?;
                        if event_frame.event != "connect.challenge" {
                            eprintln!("[openclaw-debug] ignoring event: {}", event_frame.event);
                            continue;
                        }

                        eprintln!("[openclaw-debug] received connect.challenge");
                        let payload = event_frame.payload.ok_or_else(|| {
                            "openclaw connect challenge missing payload".to_string()
                        })?;
                        let challenge: OpenClawConnectChallenge = serde_json::from_value(payload)
                            .map_err(|err| {
                            format!("openclaw connect challenge payload decode failed: {err}")
                        })?;
                        let nonce = challenge.nonce.trim();
                        if nonce.is_empty() {
                            return Err("openclaw connect challenge nonce is empty".to_string());
                        }

                        return Ok(OpenClawConnectChallenge {
                            nonce: nonce.to_string(),
                        });
                    }
                    Message::Ping(_) => {
                        eprintln!("[openclaw-debug] received ping");
                        socket
                            .send(Message::Pong(vec![].into()))
                            .await
                            .map_err(|err| format!("openclaw websocket pong failed: {err}"))?;
                    }
                    Message::Close(frame) => {
                        let reason = frame
                            .as_ref()
                            .map(|f| format!("code={} reason={}", f.code, f.reason))
                            .unwrap_or_else(|| "no close frame".to_string());
                        eprintln!("[openclaw-debug] received close: {reason}");
                        return Err(format!("openclaw websocket closed: {reason}"));
                    }
                    Message::Binary(data) => {
                        eprintln!(
                            "[openclaw-debug] received binary frame ({} bytes)",
                            data.len()
                        );
                    }
                    Message::Pong(_) => {
                        eprintln!("[openclaw-debug] received pong");
                    }
                    _ => {
                        eprintln!("[openclaw-debug] received unknown frame type");
                    }
                }
            }

            eprintln!("[openclaw-debug] socket stream ended (no more messages)");
            Err("openclaw websocket closed before connect challenge was received".to_string())
        },
    )
    .await
    .map(|value| value.map(Some))
    .unwrap_or_else(|_| {
        eprintln!("[openclaw-debug] challenge wait timed out, proceeding without challenge");
        Ok(None)
    })
}

async fn openclaw_wait_for_response(
    socket: &mut OpenClawSocket,
    request_id: &str,
) -> CommandResult<Value> {
    while let Some(message) = socket.next().await {
        let message = message.map_err(|err| format!("openclaw websocket read failed: {err}"))?;
        match message {
            Message::Text(text) => {
                let frame: Value = serde_json::from_str(&text)
                    .map_err(|err| format!("openclaw frame parse failed: {err}"))?;
                let frame_type = frame
                    .get("type")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "openclaw frame missing type".to_string())?;

                match frame_type {
                    "res" => {
                        let response: OpenClawResponseFrame = serde_json::from_value(frame)
                            .map_err(|err| format!("openclaw response decode failed: {err}"))?;
                        let Some(response_id) = openclaw_response_id_to_string(&response.id) else {
                            continue;
                        };
                        if response_id != request_id {
                            continue;
                        }

                        if response.ok {
                            return Ok(response.payload.unwrap_or(Value::Null));
                        }

                        let message = if let Some(error) = response.error {
                            let detail_code = error
                                .details
                                .as_ref()
                                .and_then(|details| details.get("code"))
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            if detail_code.is_empty() {
                                error.message
                            } else {
                                format!("{} ({detail_code})", error.message)
                            }
                        } else {
                            format!("OpenClaw request {request_id} failed without an error message")
                        };
                        return Err(message);
                    }
                    "event" => {
                        // Ignore out-of-band events while waiting for request responses.
                    }
                    _ => {}
                }
            }
            Message::Ping(payload) => {
                socket
                    .send(Message::Pong(payload))
                    .await
                    .map_err(|err| format!("openclaw websocket pong failed: {err}"))?;
            }
            Message::Close(frame) => {
                let reason = frame
                    .map(|frame| frame.reason.to_string())
                    .unwrap_or_else(|| "connection closed".to_string());
                return Err(format!("openclaw websocket closed: {reason}"));
            }
            _ => {}
        }
    }

    Err("openclaw websocket closed before a response was received".to_string())
}

async fn openclaw_connect_and_auth(
    app: &AppHandle,
    url: &str,
    auth: &OpenClawAuth,
) -> CommandResult<(OpenClawSocket, Value)> {
    // Retry connection up to 3 times — CF Tunnel may close the WebSocket
    // before the origin is fully connected (1006 "closed before connect").
    let mut last_error = String::from("openclaw connection failed");
    for attempt in 0..3u32 {
        if attempt > 0 {
            eprintln!(
                "[openclaw-debug] retry attempt {}/3 after {}ms",
                attempt + 1,
                500 * attempt
            );
            tokio::time::sleep(Duration::from_millis(500 * u64::from(attempt))).await;
        } else {
            eprintln!("[openclaw-debug] connect attempt 1/3 to {url}");
        }

        let mut socket = match openclaw_connect_socket(url, auth).await {
            Ok(socket) => socket,
            Err(err) => {
                last_error = err;
                continue;
            }
        };

        let challenge = match openclaw_wait_for_connect_challenge(&mut socket).await {
            Ok(challenge) => challenge,
            Err(err) => {
                eprintln!("[openclaw-debug] challenge step failed: {err}");
                last_error = err;
                let _ = socket.close(None).await;
                continue;
            }
        };

        eprintln!(
            "[openclaw-debug] building connect params (challenge={})",
            challenge.is_some()
        );
        let connect_params = if let Some(challenge) = challenge {
            let identity = openclaw_load_or_create_device_identity(app)?;
            eprintln!("[openclaw-debug] device identity loaded, signing challenge");
            openclaw_build_connect_params(auth, &challenge.nonce, &identity)
        } else {
            openclaw_build_connect_params_without_device(auth)
        };
        eprintln!("[openclaw-debug] connect params built, sending connect request");

        let connect_request_id = "1";
        if let Err(err) =
            openclaw_send_request(&mut socket, connect_request_id, "connect", connect_params).await
        {
            eprintln!("[openclaw-debug] send connect request failed: {err}");
            last_error = err;
            let _ = socket.close(None).await;
            continue;
        }
        eprintln!("[openclaw-debug] connect request sent, waiting for response");

        match openclaw_wait_for_response(&mut socket, connect_request_id).await {
            Ok(response) => {
                eprintln!("[openclaw-debug] connect response received ok");
                return Ok((socket, response));
            }
            Err(err) => {
                eprintln!("[openclaw-debug] wait for connect response failed: {err}");
                last_error = err;
                let _ = socket.close(None).await;
                continue;
            }
        }
    }

    Err(last_error)
}

async fn openclaw_test_connection(
    app: &AppHandle,
    params: &OpenClawGatewayRequest,
) -> CommandResult<Value> {
    let (mut socket, response) = openclaw_connect_and_auth(app, &params.url, &params.auth).await?;
    let _ = socket.close(None).await;
    Ok(openclaw_map_hello_to_connect_response(&response))
}

async fn openclaw_list_agents(
    app: &AppHandle,
    params: &OpenClawGatewayRequest,
) -> CommandResult<Value> {
    let (mut socket, _) = openclaw_connect_and_auth(app, &params.url, &params.auth).await?;
    let request_id = "2";
    openclaw_send_request(&mut socket, request_id, "agents.list", json!({})).await?;
    let response = openclaw_wait_for_response(&mut socket, request_id).await?;
    let _ = socket.close(None).await;
    Ok(response)
}

async fn openclaw_list_sessions(
    app: &AppHandle,
    params: &OpenClawGatewayRequest,
) -> CommandResult<Value> {
    let (mut socket, _) = openclaw_connect_and_auth(app, &params.url, &params.auth).await?;
    let request_id = "2";
    openclaw_send_request(&mut socket, request_id, "sessions.list", json!({})).await?;
    let response = openclaw_wait_for_response(&mut socket, request_id).await?;
    let _ = socket.close(None).await;
    Ok(response)
}

async fn openclaw_list_commands(
    app: &AppHandle,
    params: &OpenClawGatewayRequest,
) -> CommandResult<Value> {
    let (mut socket, _) = openclaw_connect_and_auth(app, &params.url, &params.auth).await?;
    let request_id = "2";
    openclaw_send_request(&mut socket, request_id, "commands.list", json!({})).await?;
    let response = openclaw_wait_for_response(&mut socket, request_id).await?;
    let _ = socket.close(None).await;
    Ok(response)
}

async fn openclaw_forward_agent_events(
    app: AppHandle,
    stream_id: String,
    event_name: String,
    run_id: String,
    mut socket: OpenClawSocket,
) {
    let mut transport_error: Option<String> = None;

    while let Some(message) = socket.next().await {
        let message = match message {
            Ok(message) => message,
            Err(err) => {
                transport_error = Some(format!("openclaw websocket read failed: {err}"));
                break;
            }
        };

        match message {
            Message::Text(text) => {
                let frame: Value = match serde_json::from_str(&text) {
                    Ok(frame) => frame,
                    Err(err) => {
                        transport_error = Some(format!("openclaw frame parse failed: {err}"));
                        break;
                    }
                };

                match frame.get("type").and_then(Value::as_str) {
                    Some("event") => {
                        let event_frame: OpenClawEventFrame = match serde_json::from_value(frame) {
                            Ok(frame) => frame,
                            Err(err) => {
                                transport_error =
                                    Some(format!("openclaw event decode failed: {err}"));
                                break;
                            }
                        };

                        if event_frame.event != "agent" && event_frame.event != "session.tool" {
                            continue;
                        }

                        let Some(event_data) = event_frame.payload else {
                            continue;
                        };
                        let matches_run = event_data
                            .get("runId")
                            .and_then(Value::as_str)
                            .or_else(|| event_data.get("invocationId").and_then(Value::as_str))
                            .map(|value| value == run_id)
                            .unwrap_or(false);
                        if !matches_run {
                            continue;
                        }

                        let is_done = event_data
                            .get("type")
                            .and_then(Value::as_str)
                            .map(|value| value == "done")
                            .unwrap_or(false);

                        let _ = app.emit(&event_name, event_data);
                        if is_done {
                            break;
                        }
                    }
                    Some("res") => {
                        // Late responses are ignored after the initial agent.accepted response.
                    }
                    _ => {}
                }
            }
            Message::Ping(payload) => {
                if let Err(err) = socket.send(Message::Pong(payload)).await {
                    transport_error = Some(format!("openclaw websocket pong failed: {err}"));
                    break;
                }
            }
            Message::Close(frame) => {
                let reason = frame
                    .map(|frame| frame.reason.to_string())
                    .unwrap_or_else(|| "connection closed".to_string());
                transport_error = Some(format!("openclaw websocket closed: {reason}"));
                break;
            }
            _ => {}
        }
    }

    if let Some(message) = transport_error {
        let _ = app.emit(
            &event_name,
            openclaw_transport_error_event(&run_id, &message),
        );
    }

    let _ = socket.close(None).await;
    if let Ok(mut streams) = app.state::<AppState>().openclaw_streams.lock() {
        streams.remove(&stream_id);
    }
}

fn extract_tool_list(raw_tools: Value) -> Vec<McpToolInfo> {
    let mut output = Vec::new();
    let tools = raw_tools.as_array().cloned().unwrap_or_default();

    for tool in tools {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let input_schema = tool
            .get("inputSchema")
            .or_else(|| tool.get("input_schema"))
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));

        output.push(McpToolInfo {
            name,
            description,
            input_schema,
        });
    }

    output
}

fn build_http_transport_config(
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> CommandResult<StreamableHttpClientTransportConfig> {
    let mut config = StreamableHttpClientTransportConfig::with_uri(url.to_string());
    let mut custom_headers = HashMap::<HeaderName, HeaderValue>::new();
    let mut bearer_token: Option<String> = None;

    if let Some(headers) = headers {
        for (name, value) in headers {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|err| format!("invalid MCP HTTP header name `{name}`: {err}"))?;

            // rmcp has dedicated bearer auth support. Keep it normalized to avoid duplicate auth headers.
            if bearer_token.is_none() && header_name.as_str().eq_ignore_ascii_case("authorization")
            {
                let token = value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
                    .map(str::trim)
                    .filter(|token| !token.is_empty())
                    .map(std::string::ToString::to_string);
                if let Some(token) = token {
                    bearer_token = Some(token);
                    continue;
                }
            }

            let header_value = HeaderValue::from_str(value)
                .map_err(|err| format!("invalid MCP HTTP header value for `{name}`: {err}"))?;
            custom_headers.insert(header_name, header_value);
        }
    }

    if let Some(token) = bearer_token {
        config = config.auth_header(token);
    }
    if !custom_headers.is_empty() {
        config = config.custom_headers(custom_headers);
    }

    Ok(config)
}

#[cfg(not(target_os = "android"))]
async fn run_stdio_list_tools(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    let McpTransportConfig::Stdio { command, args, env } = config else {
        return Err("invalid stdio config".to_string());
    };

    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(envs) = env {
        cmd.envs(envs);
    }

    let transport =
        TokioChildProcess::new(cmd).map_err(|err| format!("stdio transport init failed: {err}"))?;
    let client = ()
        .serve(transport)
        .await
        .map_err(|err| format!("mcp stdio connect failed: {err}"))?;

    let tools = client
        .list_all_tools()
        .await
        .map_err(|err| format!("mcp stdio list tools failed: {err}"));

    let _ = client.cancel().await;

    let tools = tools?;
    let raw = serde_json::to_value(tools)
        .map_err(|err| format!("serialize stdio tools failed: {err}"))?;
    Ok(extract_tool_list(raw))
}

async fn run_http_list_tools(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    let McpTransportConfig::Http { url, headers } = config else {
        return Err("invalid http config".to_string());
    };

    let client_info = ClientInfo {
        meta: None,
        protocol_version: Default::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
            name: "dango".to_string(),
            title: None,
            version: "0.1.0".to_string(),
            description: None,
            website_url: None,
            icons: None,
        },
    };

    let transport_config = build_http_transport_config(url, headers)?;
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    let client = client_info
        .serve(transport)
        .await
        .map_err(|err| format!("mcp http connect failed: {err}"))?;

    let tools = client
        .list_all_tools()
        .await
        .map_err(|err| format!("mcp http list tools failed: {err}"));

    let _ = client.cancel().await;

    let tools = tools?;
    let raw =
        serde_json::to_value(tools).map_err(|err| format!("serialize http tools failed: {err}"))?;
    Ok(extract_tool_list(raw))
}

async fn list_tools_for_config(config: &McpTransportConfig) -> CommandResult<Vec<McpToolInfo>> {
    match config {
        #[cfg(not(target_os = "android"))]
        McpTransportConfig::Stdio { .. } => run_stdio_list_tools(config).await,
        #[cfg(target_os = "android")]
        McpTransportConfig::Stdio { .. } => Err(
            "MCP stdio transport is not supported on Android. Use HTTP transport instead."
                .to_string(),
        ),
        McpTransportConfig::Http { .. } => run_http_list_tools(config).await,
    }
}

#[cfg(not(target_os = "android"))]
async fn run_stdio_call_tool(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    let McpTransportConfig::Stdio { command, args, env } = config else {
        return Err("invalid stdio config".to_string());
    };

    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(envs) = env {
        cmd.envs(envs);
    }

    let transport =
        TokioChildProcess::new(cmd).map_err(|err| format!("stdio transport init failed: {err}"))?;
    let client = ()
        .serve(transport)
        .await
        .map_err(|err| format!("mcp stdio connect failed: {err}"))?;

    let response = client
        .call_tool(CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments: arguments.as_object().cloned(),
            task: None,
        })
        .await
        .map_err(|err| format!("mcp stdio call tool failed: {err}"));

    let _ = client.cancel().await;

    let response = response?;
    serde_json::to_value(response)
        .map_err(|err| format!("serialize stdio call tool response failed: {err}"))
}

async fn run_http_call_tool(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    let McpTransportConfig::Http { url, headers } = config else {
        return Err("invalid http config".to_string());
    };

    let client_info = ClientInfo {
        meta: None,
        protocol_version: Default::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
            name: "dango".to_string(),
            title: None,
            version: "0.1.0".to_string(),
            description: None,
            website_url: None,
            icons: None,
        },
    };

    let transport_config = build_http_transport_config(url, headers)?;
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    let client = client_info
        .serve(transport)
        .await
        .map_err(|err| format!("mcp http connect failed: {err}"))?;

    let response = client
        .call_tool(CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments: arguments.as_object().cloned(),
            task: None,
        })
        .await
        .map_err(|err| format!("mcp http call tool failed: {err}"));

    let _ = client.cancel().await;

    let response = response?;
    serde_json::to_value(response)
        .map_err(|err| format!("serialize http call tool response failed: {err}"))
}

async fn call_tool_for_config(
    config: &McpTransportConfig,
    tool_name: &str,
    arguments: Value,
) -> CommandResult<Value> {
    match config {
        #[cfg(not(target_os = "android"))]
        McpTransportConfig::Stdio { .. } => run_stdio_call_tool(config, tool_name, arguments).await,
        #[cfg(target_os = "android")]
        McpTransportConfig::Stdio { .. } => Err(
            "MCP stdio transport is not supported on Android. Use HTTP transport instead."
                .to_string(),
        ),
        McpTransportConfig::Http { .. } => run_http_call_tool(config, tool_name, arguments).await,
    }
}

/// HTML shown after Google redirects to the local OAuth callback.
fn oauth_callback_success_html() -> &'static str {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed in — Dango</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f1419; color:#e7e9ea; }
    .card { max-width: 28rem; padding: 2rem; border-radius: 12px; background:#1a2332; text-align:center; line-height:1.5; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { margin: 0; color:#8b98a5; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign-in complete</h1>
    <p>You can close this tab and return to Dango.</p>
  </div>
</body>
</html>"#
}

fn oauth_callback_error_html(message: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Sign-in failed</title>
<style>body{{font-family:system-ui,sans-serif;padding:2rem;background:#0f1419;color:#e7e9ea}} .err{{color:#f4212e}}</style>
</head><body><h1 class="err">Sign-in failed</h1><p>{}</p><p>Return to Dango and try again.</p></body></html>"#,
        message.replace('<', "&lt;").replace('>', "&gt;")
    )
}

/// Parse first request line path+query from a raw HTTP request buffer.
fn extract_http_request_target(request: &str) -> Option<String> {
    let first_line = request.lines().next()?.trim();
    // GET /oauth-callback?code=... HTTP/1.1
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    if method != "GET" && method != "HEAD" {
        return None;
    }
    parts.next().map(|s| s.to_string())
}

fn is_oauth_result_path(path_and_query: &str) -> bool {
    path_and_query.contains("code=") || path_and_query.contains("error=")
}

#[cfg(not(target_os = "android"))]
async fn read_http_request_head(
    stream: &mut tokio::net::TcpStream,
) -> Result<String, String> {
    let mut buf = vec![0u8; 8192];
    let mut collected = Vec::new();
    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|err| format!("read oauth request failed: {err}"))?;
        if n == 0 {
            break;
        }
        collected.extend_from_slice(&buf[..n]);
        if collected.windows(4).any(|w| w == b"\r\n\r\n") || collected.len() > 64 * 1024 {
            break;
        }
    }
    String::from_utf8(collected).map_err(|err| format!("invalid oauth request encoding: {err}"))
}

#[cfg(not(target_os = "android"))]
async fn write_http_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    body: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|err| format!("write oauth response failed: {err}"))?;
    let _ = stream.shutdown().await;
    Ok(())
}

/// Bind 127.0.0.1:port and wait for Google's OAuth redirect (one shot).
#[cfg(not(target_os = "android"))]
async fn wait_for_local_oauth_callback(
    port: u16,
    timeout: Duration,
    mut cancel: oneshot::Receiver<()>,
) -> CommandResult<String> {
    let addr = format!("127.0.0.1:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|err| format!("Could not bind OAuth callback on {addr}: {err}. Close other apps using port {port} or paste the redirect URL manually."))?;

    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        let accept_fut = listener.accept();
        tokio::pin!(accept_fut);

        let accepted = tokio::select! {
            biased;
            _ = &mut cancel => {
                return Err("OAuth callback cancelled".to_string());
            }
            _ = tokio::time::sleep_until(deadline) => {
                return Err("OAuth timed out waiting for browser redirect. Try again.".to_string());
            }
            result = &mut accept_fut => result,
        };

        let (mut stream, _) =
            accepted.map_err(|err| format!("accept oauth connection failed: {err}"))?;

        let request = match read_http_request_head(&mut stream).await {
            Ok(r) => r,
            Err(_) => continue,
        };

        let Some(target) = extract_http_request_target(&request) else {
            let _ = write_http_response(&mut stream, "405 Method Not Allowed", "Method not allowed").await;
            continue;
        };

        // Ignore favicon / noise; keep listening for the real callback
        if !is_oauth_result_path(&target) {
            let _ = write_http_response(&mut stream, "204 No Content", "").await;
            continue;
        }

        let full_url = if target.starts_with("http://") || target.starts_with("https://") {
            target
        } else {
            format!("http://localhost:{port}{target}")
        };

        if full_url.contains("error=") {
            let msg = full_url
                .split("error_description=")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .map(|s| urlencoding_decode(s))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Access denied or error from Google".to_string());
            let _ = write_http_response(&mut stream, "400 Bad Request", &oauth_callback_error_html(&msg)).await;
            return Err(msg);
        }

        let _ = write_http_response(&mut stream, "200 OK", oauth_callback_success_html()).await;
        return Ok(full_url);
    }
}

/// Minimal query-value decode for error_description (space as + or %20).
fn urlencoding_decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &input[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v as char);
                    i += 3;
                } else {
                    out.push('%');
                    i += 1;
                }
            }
            c => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    out
}

fn register_oauth_cancel(state: &AppState) -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    if let Ok(mut guard) = state.oauth_cancel.lock() {
        if let Some(prev) = guard.take() {
            let _ = prev.send(());
        }
        *guard = Some(tx);
    }
    rx
}

fn clear_oauth_cancel(state: &AppState) {
    if let Ok(mut guard) = state.oauth_cancel.lock() {
        *guard = None;
    }
}

fn cancel_oauth_callback(state: &AppState) {
    if let Ok(mut guard) = state.oauth_cancel.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

#[tauri::command]
async fn ipc_invoke(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> CommandResult<Value> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    if let Some(result) = desktop_shell::handle_ipc(&app, &channel, &args).await {
        return result;
    }

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        let browser = app.state::<browser_manager::BrowserManager>();
        if let Some(result) = browser.handle(&app, &channel, &args).await {
            return result;
        }
        let computer = app.state::<computer_manager::ComputerManager>();
        if let Some(result) = computer.handle(&app, &channel, &args).await {
            return result;
        }
    }

    if let Some(result) = kb::handle(&app, &state.kb, &state.store, &channel, &args) {
        return result;
    }

    if let Some(result) = workspace::handle(&app, &window, &state.workspace, &channel, &args) {
        return result;
    }

    match channel.as_str() {
        "getStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            Ok(store.get(&key).cloned().unwrap_or(Value::Null))
        }
        "setStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            let data_json = get_arg_string(&args, 1)?;
            let value = serde_json::from_str::<Value>(&data_json).unwrap_or(Value::Null);
            {
                let mut store = state
                    .store
                    .lock()
                    .map_err(|_| "store lock poisoned".to_string())?;
                store.insert(key, value);
                save_store_to_disk(&app, "store.json", &store);
            }
            Ok(Value::Null)
        }
        "delStoreValue" => {
            let key = get_arg_string(&args, 0)?;
            {
                let mut store = state
                    .store
                    .lock()
                    .map_err(|_| "store lock poisoned".to_string())?;
                store.remove(&key);
                save_store_to_disk(&app, "store.json", &store);
            }
            Ok(Value::Null)
        }
        "getAllStoreValues" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let json_str = serde_json::to_string(&*store)
                .map_err(|err| format!("serialize store failed: {err}"))?;
            Ok(Value::String(json_str))
        }
        "setAllStoreValues" => {
            let data_json = get_arg_string(&args, 0)?;
            let data = serde_json::from_str::<Value>(&data_json)
                .map_err(|err| format!("invalid json: {err}"))?;
            if let Some(map) = data.as_object() {
                let mut store = state
                    .store
                    .lock()
                    .map_err(|_| "store lock poisoned".to_string())?;
                for (key, value) in map {
                    store.insert(key.to_string(), value.clone());
                }
                save_store_to_disk(&app, "store.json", &store);
            }
            Ok(Value::Null)
        }
        "getAllStoreKeys" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            Ok(Value::Array(
                store.keys().map(|k| Value::String(k.to_string())).collect(),
            ))
        }
        "getStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            let blobs = state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?;
            Ok(blobs
                .get(&key)
                .cloned()
                .map(Value::String)
                .unwrap_or(Value::Null))
        }
        "setStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            let value = get_arg_string(&args, 1)?;
            {
                let mut blobs = state
                    .blobs
                    .lock()
                    .map_err(|_| "blob store lock poisoned".to_string())?;
                blobs.insert(key, value);
                save_blobs_to_disk(&app, "blobs.json", &blobs);
            }
            Ok(Value::Null)
        }
        "delStoreBlob" => {
            let key = get_arg_string(&args, 0)?;
            {
                let mut blobs = state
                    .blobs
                    .lock()
                    .map_err(|_| "blob store lock poisoned".to_string())?;
                blobs.remove(&key);
                save_blobs_to_disk(&app, "blobs.json", &blobs);
            }
            Ok(Value::Null)
        }
        "listStoreBlobKeys" => {
            let blobs = state
                .blobs
                .lock()
                .map_err(|_| "blob store lock poisoned".to_string())?;
            Ok(Value::Array(
                blobs.keys().map(|k| Value::String(k.to_string())).collect(),
            ))
        }
        "getVersion" => Ok(Value::String(app.package_info().version.to_string())),
        "getPlatform" => Ok(Value::String(map_platform())),
        "getArch" => Ok(Value::String(map_arch())),
        "getHostname" => {
            #[cfg(not(target_os = "android"))]
            {
                let hostname = hostname::get()
                    .ok()
                    .and_then(|value| value.to_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| "unknown".to_string());
                Ok(Value::String(hostname))
            }
            #[cfg(target_os = "android")]
            {
                Ok(Value::String("android-device".to_string()))
            }
        }
        "getDeviceName" => {
            #[cfg(not(target_os = "android"))]
            {
                let hostname = hostname::get()
                    .ok()
                    .and_then(|value| value.to_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| "unknown".to_string());
                Ok(Value::String(hostname))
            }
            #[cfg(target_os = "android")]
            {
                Ok(Value::String("android-device".to_string()))
            }
        }
        "getLocale" => {
            let locale = get_locale().unwrap_or_else(|| "en-US".to_string());
            Ok(Value::String(locale))
        }
        "openLink" => {
            let url = get_arg_string(&args, 0)?;
            // System preference / settings deep links often fail via webbrowser crate.
            // Prefer OS openers: macOS `open`, Windows `cmd start`, then plugin/webbrowser.
            #[cfg(target_os = "macos")]
            {
                let status = std::process::Command::new("/usr/bin/open")
                    .arg(&url)
                    .status()
                    .map_err(|err| format!("open link failed: {err}"))?;
                if !status.success() {
                    // Fall back for normal http(s)
                    webbrowser::open(&url).map_err(|err| format!("open link failed: {err}"))?;
                }
            }
            #[cfg(target_os = "windows")]
            {
                let status = std::process::Command::new("cmd")
                    .args(["/C", "start", "", &url])
                    .status();
                match status {
                    Ok(s) if s.success() => {}
                    _ => {
                        webbrowser::open(&url).map_err(|err| format!("open link failed: {err}"))?;
                    }
                }
            }
            #[cfg(all(not(target_os = "android"), not(target_os = "macos"), not(target_os = "windows")))]
            {
                use tauri_plugin_opener::OpenerExt;
                if let Err(err) = app.opener().open_url(&url, None::<&str>) {
                    webbrowser::open(&url).map_err(|e| format!("open link failed: {err}; {e}"))?;
                }
            }
            #[cfg(target_os = "android")]
            {
                use tauri_plugin_opener::OpenerExt;
                app.opener()
                    .open_url(&url, None::<&str>)
                    .map_err(|err| format!("open link failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        // Desktop PKCE: bind 127.0.0.1:port and wait for Google redirect (auto sign-in).
        // args[0] optional: { port?: number, timeoutMs?: number }
        "oauth:waitForLocalCallback" => {
            #[cfg(target_os = "android")]
            {
                return Err(
                    "Local OAuth callback is only available on desktop. Paste the redirect URL instead."
                        .to_string(),
                );
            }
            #[cfg(not(target_os = "android"))]
            {
                let opts = args.first().cloned().unwrap_or(Value::Object(Default::default()));
                let port = opts
                    .get("port")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(51121) as u16;
                let timeout_ms = opts
                    .get("timeoutMs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(5 * 60 * 1000);
                let cancel_rx = register_oauth_cancel(&*state);
                let result = wait_for_local_oauth_callback(
                    port,
                    Duration::from_millis(timeout_ms),
                    cancel_rx,
                )
                .await;
                clear_oauth_cancel(&*state);
                let full_url = result?;
                Ok(json!({ "redirectUrl": full_url }))
            }
        }
        "oauth:cancelLocalCallback" => {
            cancel_oauth_callback(&*state);
            Ok(Value::Null)
        }
        // Integrations secret vault (desktop OS keychain). args[0] = { service, account, secret? }
        "secrets:set" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let opts = get_arg(&args, 0)?;
                let service = opts
                    .get("service")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:set missing service".to_string())?;
                let account = opts
                    .get("account")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:set missing account".to_string())?;
                let secret = opts
                    .get("secret")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:set missing secret".to_string())?;
                let entry = keyring::Entry::new(service, account)
                    .map_err(|err| format!("keyring entry failed: {err}"))?;
                entry
                    .set_password(secret)
                    .map_err(|err| format!("keyring set failed: {err}"))?;
                Ok(Value::Null)
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("OS keychain secrets are only available on desktop".to_string())
            }
        }
        "secrets:get" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let opts = get_arg(&args, 0)?;
                let service = opts
                    .get("service")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:get missing service".to_string())?;
                let account = opts
                    .get("account")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:get missing account".to_string())?;
                let entry = keyring::Entry::new(service, account)
                    .map_err(|err| format!("keyring entry failed: {err}"))?;
                match entry.get_password() {
                    Ok(secret) => Ok(json!({ "secret": secret })),
                    Err(keyring::Error::NoEntry) => Ok(json!({ "secret": Value::Null })),
                    Err(err) => Err(format!("keyring get failed: {err}")),
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("OS keychain secrets are only available on desktop".to_string())
            }
        }
        "secrets:delete" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let opts = get_arg(&args, 0)?;
                let service = opts
                    .get("service")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:delete missing service".to_string())?;
                let account = opts
                    .get("account")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "secrets:delete missing account".to_string())?;
                let entry = keyring::Entry::new(service, account)
                    .map_err(|err| format!("keyring entry failed: {err}"))?;
                match entry.delete_credential() {
                    Ok(()) => Ok(Value::Null),
                    Err(keyring::Error::NoEntry) => Ok(Value::Null),
                    Err(err) => Err(format!("keyring delete failed: {err}")),
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("OS keychain secrets are only available on desktop".to_string())
            }
        }
        "http:request" => {
            let request = serde_json::from_value::<HttpRequestPayload>(get_arg(&args, 0)?.clone())
                .map_err(|err| format!("invalid http request payload: {err}"))?;
            http_request(&request).await
        }
        "ensureShortcutConfig" => Ok(Value::Null), // desktop handled above via desktop_shell
        "shouldUseDarkColors" => {
            let theme = window
                .theme()
                .map_err(|err| format!("get window theme failed: {err}"))?;
            Ok(Value::Bool(matches!(theme, tauri::Theme::Dark)))
        }
        "ensureProxy" => Ok(Value::Null),
        "relaunch" => {
            #[cfg(not(target_os = "android"))]
            {
                app.restart();
            }
            // Android: relaunch is a no-op. Migrations that set needRelaunch=true
            // will complete without error; the user can manually restart the app.
            #[allow(unreachable_code)]
            Ok(Value::Null)
        }
        "analysticTrackingEvent" => Ok(Value::Null),
        "getConfig" => {
            let mut store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let config = store
                .entry("configs".to_string())
                .or_insert_with(default_config)
                .clone();
            Ok(config)
        }
        "getSettings" => {
            let store = state
                .store
                .lock()
                .map_err(|_| "store lock poisoned".to_string())?;
            let settings = store
                .get("settings")
                .cloned()
                .unwrap_or_else(default_settings);
            Ok(settings)
        }
        "shouldShowAboutDialogWhenStartUp" => Ok(Value::Bool(false)),
        "appLog" => {
            if let Ok(data) = get_arg_string(&args, 0) {
                println!("APP_LOG: {data}");
            }
            Ok(Value::Null)
        }
        "exportLogs" => Ok(Value::String(String::new())),
        "clearLogs" => Ok(Value::Null),
        "ensureAutoLaunch" => Ok(Value::Null),
        "pickImportedArchive" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let picked = tauri::async_runtime::spawn_blocking(|| {
                    rfd::FileDialog::new()
                        .add_filter("ZIP archive", &["zip"])
                        .pick_file()
                })
                .await
                .map_err(|err| format!("archive picker failed: {err}"))?;
                Ok(match picked {
                    Some(path) => Value::String(path.to_string_lossy().into_owned()),
                    None => Value::Null,
                })
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("imported archives are desktop-only".into())
            }
        }
        "inspectImportedArchive" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let path = get_arg_string(&args, 0)?;
                let result = imported_archive::inspect_arg_path(&path)?;
                Ok(result)
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("imported archives are desktop-only".into())
            }
        }
        "parseFileLocally" => {
            let data_json = get_arg_string(&args, 0)?;
            let data = serde_json::from_str::<Value>(&data_json)
                .map_err(|err| format!("invalid json: {err}"))?;
            let file_path = data
                .get("filePath")
                .and_then(Value::as_str)
                .ok_or_else(|| "filePath is required".to_string())?;

            match std::fs::read_to_string(file_path) {
                Ok(text) => Ok(Value::String(
                    json!({
                      "text": text,
                      "isSupported": true
                    })
                    .to_string(),
                )),
                Err(_) => Ok(Value::String(json!({ "isSupported": false }).to_string())),
            }
        }
        "parseUrl" => Ok(Value::String(json!({ "key": "", "title": "" }).to_string())),
        "isFullscreen" => {
            #[cfg(not(target_os = "android"))]
            {
                Ok(Value::Bool(window.is_fullscreen().map_err(|err| {
                    format!("fullscreen check failed: {err}")
                })?))
            }
            #[cfg(target_os = "android")]
            {
                Ok(Value::Bool(false))
            }
        }
        "setFullscreen" => {
            #[cfg(not(target_os = "android"))]
            {
                let enabled = get_arg_bool(&args, 0)?;
                window
                    .set_fullscreen(enabled)
                    .map_err(|err| format!("set fullscreen failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        "install-update" => Ok(Value::Null),
        "switch-theme" => Ok(Value::Null),
        "window:minimize" => {
            #[cfg(not(target_os = "android"))]
            {
                window
                    .minimize()
                    .map_err(|err| format!("window minimize failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        "window:maximize" => {
            #[cfg(not(target_os = "android"))]
            {
                window
                    .maximize()
                    .map_err(|err| format!("window maximize failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        "window:unmaximize" => {
            #[cfg(not(target_os = "android"))]
            {
                window
                    .unmaximize()
                    .map_err(|err| format!("window unmaximize failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        "window:close" => {
            #[cfg(not(target_os = "android"))]
            {
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                {
                    if desktop_shell::keep_in_tray_enabled(&app) {
                        let _ = window.hide();
                        if window.label() == "main" {
                            let _ = app.emit("shell:hidden-to-tray", json!({}));
                        }
                        return Ok(Value::Null);
                    }
                }
                window
                    .close()
                    .map_err(|err| format!("window close failed: {err}"))?;
            }
            Ok(Value::Null)
        }
        "window:is-maximized" => {
            #[cfg(not(target_os = "android"))]
            {
                Ok(Value::Bool(window.is_maximized().map_err(|err| {
                    format!("window maximize state check failed: {err}")
                })?))
            }
            #[cfg(target_os = "android")]
            {
                Ok(Value::Bool(false))
            }
        }

        "openclaw:test-connection" => {
            let params =
                serde_json::from_value::<OpenClawGatewayRequest>(get_arg(&args, 0)?.clone())
                    .map_err(|err| format!("invalid OpenClaw request: {err}"))?;
            openclaw_test_connection(&app, &params).await
        }
        "openclaw:list-agents" => {
            let params =
                serde_json::from_value::<OpenClawGatewayRequest>(get_arg(&args, 0)?.clone())
                    .map_err(|err| format!("invalid OpenClaw request: {err}"))?;
            openclaw_list_agents(&app, &params).await
        }
        "openclaw:list-sessions" => {
            let params =
                serde_json::from_value::<OpenClawGatewayRequest>(get_arg(&args, 0)?.clone())
                    .map_err(|err| format!("invalid OpenClaw request: {err}"))?;
            openclaw_list_sessions(&app, &params).await
        }
        "openclaw:list-commands" => {
            let params =
                serde_json::from_value::<OpenClawGatewayRequest>(get_arg(&args, 0)?.clone())
                    .map_err(|err| format!("invalid OpenClaw request: {err}"))?;
            openclaw_list_commands(&app, &params).await
        }
        "openclaw:invoke-agent" => {
            let params =
                serde_json::from_value::<OpenClawInvokeRequest>(get_arg(&args, 0)?.clone())
                    .map_err(|err| format!("invalid OpenClaw invoke request: {err}"))?;

            let (mut socket, _) =
                openclaw_connect_and_auth(&app, &params.url, &params.auth).await?;
            let mut request_params = serde_json::Map::new();
            request_params.insert(
                "agentId".to_string(),
                Value::String(params.agent_id.clone()),
            );
            request_params.insert("message".to_string(), Value::String(params.message.clone()));
            request_params.insert(
                "idempotencyKey".to_string(),
                Value::String(Uuid::new_v4().to_string()),
            );
            if let Some(session_id) = params.session_id.clone().filter(|value| !value.is_empty()) {
                request_params.insert("sessionId".to_string(), Value::String(session_id));
            }
            if let Some(session_key) = params.session_key.clone().filter(|value| !value.is_empty())
            {
                request_params.insert("sessionKey".to_string(), Value::String(session_key));
            }
            if let Some(extra_system_prompt) = params
                .extra_system_prompt
                .clone()
                .filter(|value| !value.is_empty())
            {
                request_params.insert(
                    "extraSystemPrompt".to_string(),
                    Value::String(extra_system_prompt),
                );
            }
            let request_id = "2";
            openclaw_send_request(
                &mut socket,
                request_id,
                "agent",
                Value::Object(request_params),
            )
            .await?;
            let response = openclaw_wait_for_response(&mut socket, request_id).await?;
            let run_id = response
                .get("runId")
                .or_else(|| response.get("invocationId"))
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "OpenClaw agent invocation did not return runId".to_string())?
                .to_string();

            let event_name = format!("openclaw:stream:{}", params.stream_id);
            let stream_id = params.stream_id.clone();

            if let Some(handle) = state
                .openclaw_streams
                .lock()
                .map_err(|_| "openclaw stream lock poisoned".to_string())?
                .remove(&stream_id)
            {
                handle.abort();
            }

            let app_handle = app.clone();
            let task = tokio::spawn(openclaw_forward_agent_events(
                app_handle,
                stream_id.clone(),
                event_name,
                run_id.clone(),
                socket,
            ));

            state
                .openclaw_streams
                .lock()
                .map_err(|_| "openclaw stream lock poisoned".to_string())?
                .insert(stream_id, task);

            serde_json::to_value(OpenClawInvokeAccepted {
                invocation_id: run_id.clone(),
                run_id,
            })
            .map_err(|err| format!("serialize OpenClaw invoke response failed: {err}"))
        }
        "openclaw:cancel-invoke" | "openclaw:close-stream" => {
            let stream_id = get_arg_string(&args, 0)?;
            if let Some(handle) = state
                .openclaw_streams
                .lock()
                .map_err(|_| "openclaw stream lock poisoned".to_string())?
                .remove(&stream_id)
            {
                handle.abort();
            }
            Ok(Value::Null)
        }

        // mcp:stdio-transport:* channels are the legacy Electron/preload IPC route.
        // In the Tauri runtime, MCP runs natively in Rust via the mcp:server:* commands
        // below. The renderer's createTauriClient() should always be used when
        // isTauriRuntime() is true, so these channels should never be called.
        "mcp:stdio-transport:create"
        | "mcp:stdio-transport:start"
        | "mcp:stdio-transport:send"
        | "mcp:stdio-transport:close" => Err(format!(
            "IPC channel '{channel}' is not supported in the Tauri runtime. \
             Use mcp:server:create / mcp:server:start / mcp:server:call-tool instead."
        )),

        // MCP backend commands for Tauri renderer runtime
        "mcp:server:create" => {
            let config_value = get_arg(&args, 0)?.clone();
            let transport = serde_json::from_value::<McpTransportConfig>(config_value)
                .map_err(|err| format!("invalid MCP transport config: {err}"))?;
            let id = format!(
                "mcp-{}",
                state.next_mcp_id.fetch_add(1, Ordering::Relaxed) + 1
            );
            let server_state = McpServerState {
                id: id.clone(),
                transport,
                connected: false,
                last_error: None,
            };
            state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?
                .insert(id.clone(), server_state);
            Ok(Value::String(id))
        }
        "mcp:server:start" => {
            let server_id = get_arg_string(&args, 0)?;
            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            match list_tools_for_config(&transport).await {
                Ok(_) => {
                    let mut servers = state
                        .mcp_servers
                        .lock()
                        .map_err(|_| "mcp server lock poisoned".to_string())?;
                    if let Some(server) = servers.get_mut(&server_id) {
                        server.connected = true;
                        server.last_error = None;
                    }
                    Ok(Value::Null)
                }
                Err(err) => {
                    let mut servers = state
                        .mcp_servers
                        .lock()
                        .map_err(|_| "mcp server lock poisoned".to_string())?;
                    if let Some(server) = servers.get_mut(&server_id) {
                        server.connected = false;
                        server.last_error = Some(err.clone());
                    }
                    Err(err)
                }
            }
        }
        "mcp:server:list-tools" => {
            let server_id = get_arg_string(&args, 0)?;
            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            let tools = list_tools_for_config(&transport).await?;
            serde_json::to_value(tools).map_err(|err| format!("serialize MCP tools failed: {err}"))
        }
        "mcp:server:call-tool" => {
            let server_id = get_arg_string(&args, 0)?;
            let tool_name = get_arg_string(&args, 1)?;
            let arguments = get_arg(&args, 2).cloned().unwrap_or_else(|_| json!({}));

            let transport = {
                let servers = state
                    .mcp_servers
                    .lock()
                    .map_err(|_| "mcp server lock poisoned".to_string())?;
                let entry = servers
                    .get(&server_id)
                    .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
                entry.transport.clone()
            };

            call_tool_for_config(&transport, &tool_name, arguments).await
        }
        "mcp:server:close" => {
            let server_id = get_arg_string(&args, 0)?;
            state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?
                .remove(&server_id);
            Ok(Value::Null)
        }
        "mcp:server:list" => {
            let servers = state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?;
            let list: Vec<Value> = servers
                .values()
                .map(|entry| {
                    json!({
                      "id": entry.id,
                      "connected": entry.connected,
                      "lastError": entry.last_error
                    })
                })
                .collect();
            Ok(Value::Array(list))
        }
        "mcp:server:status" => {
            let server_id = get_arg_string(&args, 0)?;
            let servers = state
                .mcp_servers
                .lock()
                .map_err(|_| "mcp server lock poisoned".to_string())?;
            let entry = servers
                .get(&server_id)
                .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
            Ok(json!({
              "id": entry.id,
              "connected": entry.connected,
              "lastError": entry.last_error
            }))
        }

        "parser:test-mineru" => Ok(json!({
          "success": false,
          "error": "MinerU parser is not configured in Tauri runtime yet"
        })),
        "parser:parse-file-with-mineru" => Ok(json!({
          "success": false,
          "error": "MinerU parser is not configured in Tauri runtime yet"
        })),
        "parser:cancel-mineru-parse" => Ok(json!({ "success": true })),
        "execute_command" => Err(
            "execute_command is unavailable. Generic project shell is disabled; use narrow native brokers.".to_string(),
        ),
        "fs:read-file" | "fs:write-file" | "fs:delete-file" => Err(format!(
            "'{channel}' is unavailable. Privileged file access requires a native project capability."
        )),

        // Discover Agent Skills (SKILL.md) from Claude/Codex/Cursor/agents/grok folders
        "skills:scan" => {
            #[cfg(target_os = "android")]
            {
                Err("'skills:scan' is not available on Android".to_string())
            }
            #[cfg(not(target_os = "android"))]
            {
                let roots = get_arg(&args, 0)?
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let mut root_reports = Vec::new();
                let mut skills = Vec::new();
                const MAX_SKILLS: usize = 500;

                for root_val in roots {
                    let Some(root_raw) = root_val.as_str() else {
                        continue;
                    };
                    if !is_allowed_global_agent_root(root_raw) {
                        continue;
                    }
                    let root_path = expand_skill_root_path(root_raw);
                    let origin = skill_origin_from_path(&root_path);
                    let path = PathBuf::from(&root_path);
                    let exists = path.is_dir();
                    root_reports.push(json!({
                        "origin": origin,
                        "path": root_path,
                        "exists": exists,
                    }));
                    if !exists {
                        continue;
                    }

                    let Ok(entries) = fs::read_dir(&path) else {
                        continue;
                    };

                    for entry in entries.flatten() {
                        if skills.len() >= MAX_SKILLS {
                            break;
                        }
                        let entry_path = entry.path();
                        // Skip hidden / system dirs
                        let folder_name = entry
                            .file_name()
                            .to_string_lossy()
                            .to_string();
                        if folder_name.starts_with('.') {
                            continue;
                        }
                        if !entry_path.is_dir() {
                            // Allow flat SKILL.md at root of skills dir (rare)
                            if entry_path.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
                                if let Ok(content) = fs::read_to_string(&entry_path) {
                                    skills.push(json!({
                                        "origin": origin,
                                        "rootDir": root_path,
                                        "folderName": path.file_name().and_then(|n| n.to_str()).unwrap_or("skill"),
                                        "skillPath": entry_path.to_string_lossy(),
                                        "content": content,
                                    }));
                                }
                            }
                            continue;
                        }

                        let skill_md = entry_path.join("SKILL.md");
                        if skill_md.is_file() {
                            if let Ok(content) = fs::read_to_string(&skill_md) {
                                skills.push(json!({
                                    "origin": origin,
                                    "rootDir": root_path,
                                    "folderName": folder_name,
                                    "skillPath": skill_md.to_string_lossy(),
                                    "content": content,
                                }));
                            }
                        }
                    }
                }

                Ok(json!({
                    "roots": root_reports,
                    "skills": skills,
                }))
            }
        }

        // Read agent hook config files (Claude settings.json / Cursor hooks.json)
        "hooks:read-configs" => {
            #[cfg(target_os = "android")]
            {
                Err("'hooks:read-configs' is not available on Android".to_string())
            }
            #[cfg(not(target_os = "android"))]
            {
                let paths = get_arg(&args, 0)?
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let mut files = Vec::new();
                for path_val in paths {
                    let Some(path_raw) = path_val.as_str() else {
                        continue;
                    };
                    if !is_allowed_global_agent_root(path_raw) {
                        continue;
                    }
                    let path_str = expand_skill_root_path(path_raw);
                    let pb = PathBuf::from(&path_str);
                    if pb.is_file() {
                        match fs::read_to_string(&pb) {
                            Ok(content) => {
                                files.push(json!({
                                    "path": path_str,
                                    "content": content,
                                    "exists": true,
                                }));
                            }
                            Err(_) => {
                                files.push(json!({
                                    "path": path_str,
                                    "content": "",
                                    "exists": false,
                                }));
                            }
                        }
                    } else {
                        files.push(json!({
                            "path": path_str,
                            "content": "",
                            "exists": false,
                        }));
                    }
                }
                Ok(json!({ "files": files }))
            }
        }

        "hooks:run-shell" => Err(
            "hooks:run-shell is unavailable. Project shell hooks are disabled; generic renderer shell is not a workspace sandbox.".to_string(),
        ),

        // Discover slash commands: flat `name.md` or folder with body/COMMAND.md/SKILL.md
        "commands:scan" => {
            #[cfg(target_os = "android")]
            {
                Err("'commands:scan' is not available on Android".to_string())
            }
            #[cfg(not(target_os = "android"))]
            {
                let roots = get_arg(&args, 0)?
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let mut root_reports = Vec::new();
                let mut skills = Vec::new();
                const MAX_COMMANDS: usize = 500;

                for root_val in roots {
                    let Some(root_raw) = root_val.as_str() else {
                        continue;
                    };
                    if !is_allowed_global_agent_root(root_raw) {
                        continue;
                    }
                    let root_path = expand_skill_root_path(root_raw);
                    let origin = command_origin_from_path(&root_path);
                    let path = PathBuf::from(&root_path);
                    let exists = path.is_dir();
                    root_reports.push(json!({
                        "origin": origin,
                        "path": root_path,
                        "exists": exists,
                    }));
                    if !exists {
                        continue;
                    }

                    let Ok(entries) = fs::read_dir(&path) else {
                        continue;
                    };

                    for entry in entries.flatten() {
                        if skills.len() >= MAX_COMMANDS {
                            break;
                        }
                        let entry_path = entry.path();
                        let file_name = entry
                            .file_name()
                            .to_string_lossy()
                            .to_string();
                        if file_name.starts_with('.') {
                            continue;
                        }

                        // Flat: review.md
                        if entry_path.is_file() {
                            let is_md = file_name.to_lowercase().ends_with(".md");
                            if !is_md {
                                continue;
                            }
                            if let Ok(content) = fs::read_to_string(&entry_path) {
                                let base = file_name.trim_end_matches(".md").trim_end_matches(".MD");
                                skills.push(json!({
                                    "origin": origin,
                                    "rootDir": root_path,
                                    "folderName": base,
                                    "skillPath": entry_path.to_string_lossy(),
                                    "content": content,
                                }));
                            }
                            continue;
                        }

                        // Folder: prefer COMMAND.md, then SKILL.md, then README.md
                        if entry_path.is_dir() {
                            for candidate in ["COMMAND.md", "SKILL.md", "command.md", "README.md"] {
                                let md = entry_path.join(candidate);
                                if md.is_file() {
                                    if let Ok(content) = fs::read_to_string(&md) {
                                        skills.push(json!({
                                            "origin": origin,
                                            "rootDir": root_path,
                                            "folderName": file_name,
                                            "skillPath": md.to_string_lossy(),
                                            "content": content,
                                        }));
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }

                Ok(json!({
                    "roots": root_reports,
                    "skills": skills,
                }))
            }
        }

        _ => Err(format!("unknown ipc channel: {channel}")),
    }
}

#[cfg(not(target_os = "android"))]
fn expand_skill_root_path(path: &str) -> String {
    // Global user roots only (`~/...`). Project-relative paths are scanned via workspace capabilities.
    expand_user_path(path)
}

#[cfg(not(target_os = "android"))]
fn is_allowed_global_agent_root(raw: &str) -> bool {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    crate::workspace::is_native_known_global_root(raw, &home)
}

#[cfg(not(target_os = "android"))]
fn skill_origin_from_path(path: &str) -> &'static str {
    let lower = path.replace('\\', "/").to_lowercase();
    if lower.contains("/.claude/skills") {
        "claude"
    } else if lower.contains("/.codex/skills") {
        "codex"
    } else if lower.contains("/.cursor/skills") {
        "cursor"
    } else if lower.contains("/.agents/skills") {
        "agents"
    } else if lower.contains("/.grok/skills") {
        "grok"
    } else if lower.contains("/.gemini/skills") {
        "gemini"
    } else if lower.contains("/opencode/skills") {
        "opencode"
    } else if lower.ends_with("/skills") || lower.contains("/skills") {
        "project"
    } else {
        "unknown"
    }
}

#[cfg(not(target_os = "android"))]
fn command_origin_from_path(path: &str) -> &'static str {
    let lower = path.replace('\\', "/").to_lowercase();
    if lower.contains("/.claude/commands") {
        "claude"
    } else if lower.contains("/.codex/commands") {
        "codex"
    } else if lower.contains("/.cursor/commands") {
        "cursor"
    } else if lower.contains("/.agents/commands") {
        "agents"
    } else if lower.contains("/.grok/commands") {
        "grok"
    } else if lower.contains("/.gemini/commands") {
        "gemini"
    } else if lower.ends_with("/commands") || lower.contains("/commands") {
        "project"
    } else {
        "unknown"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(target_os = "android"))]
    {
        let _ = fix_path_env::fix();
    }

    // Move data left under the old Chaeboxi identifier before any window
    // (and so any webview storage) is created.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    legacy_rename::migrate();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .manage(desktop_shell::ShellState::default())
            .manage(browser_manager::BrowserManager::default())
            .manage(computer_manager::ComputerManager::default());
    }

    builder
        .manage(AppState {
            next_mcp_id: AtomicU64::new(0),
            ..Default::default()
        })
        .setup(|app| {
            let handle = app.handle();
            let store = load_store_from_disk(handle, "store.json");
            let blobs = load_blobs_from_disk(handle, "blobs.json");

            let state: State<AppState> = app.state();
            *state.store.lock().unwrap() = store.clone();
            *state.blobs.lock().unwrap() = blobs;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            if let Err(err) = state.kb.open_desktop(handle) {
                eprintln!("[kb] failed to open sqlite store: {err}");
            }
            workspace::open_desktop(handle, &state.workspace);

            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                if let Err(err) = desktop_shell::setup_tray(handle) {
                    eprintln!("[shell] tray setup failed: {err}");
                }
                desktop_shell::seed_from_store(handle, &store);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("window-show", json!({}));
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                {
                    if desktop_shell::keep_in_tray_enabled(window.app_handle()) {
                        api.prevent_close();
                        let _ = window.hide();
                        if window.label() == "main" {
                            let _ = window.app_handle().emit("shell:hidden-to-tray", json!({}));
                        }
                        return;
                    }
                    // App quitting: best-effort kill browser hosts (async fire-and-forget).
                    if window.label() == "main" {
                        let app = window.app_handle().clone();
                        let state: State<AppState> = window.app_handle().state();
                        state.workspace.revoke_window("main");
                        tauri::async_runtime::spawn(async move {
                            let browser = app.state::<browser_manager::BrowserManager>();
                            browser.stop_all().await;
                        });
                    } else {
                        let state: State<AppState> = window.app_handle().state();
                        state.workspace.revoke_window(window.label());
                    }
                }
                let _ = api;
            }
            WindowEvent::Focused(true) => {
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                {
                    // Only one chat window at a time (Dock / hotkey / tray)
                    let label = window.label().to_string();
                    let app = window.app_handle().clone();
                    if label == "main" {
                        desktop_shell::hide_quick(&app);
                    } else if label == "quick" {
                        desktop_shell::hide_main(&app);
                    }
                }
                let _ = window.emit("window:focused", json!({}));
            }
            WindowEvent::ThemeChanged(_) => {
                let _ = window.emit("system-theme-updated", json!({}));
            }
            WindowEvent::ScaleFactorChanged { .. } => {}
            WindowEvent::Resized(_) => {}
            _ => {
                #[cfg(not(target_os = "android"))]
                {
                    if let Ok(is_maximized) = window.is_maximized() {
                        let _ = window.emit("window:maximized-changed", is_maximized);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![ipc_invoke])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application")
}

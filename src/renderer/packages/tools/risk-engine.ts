import { ToolRiskTier } from '@shared/types/mcp'

/**
 * Semantic risk classification for tool invocations.
 *
 * Instead of relying on a single regex against the tool name + description,
 * this engine evaluates three independent signals and returns the highest
 * tier detected:
 *
 *   1. **Command intent** — what the tool *does* (execute, delete, read …)
 *   2. **Path sensitivity** — whether targeted paths touch system-critical locations
 *   3. **Argument patterns** — dangerous flags, glob expansions, credential references
 */

// ---------------------------------------------------------------------------
// 1. Command-intent vocabularies (ordered most → least dangerous)
// ---------------------------------------------------------------------------

const CRITICAL_INTENT_PATTERNS = [
  // System-level / irreversible operations
  /(?:^|[\s_-])(sudo|su|chmod|chown|mkfs|format|fdisk|mount|umount)(?:$|[\s_-])/,
  // Credential / secret access
  /(?:^|[\s_-])(secret|credential|password|token|api[_-]?key|private[_-]?key)(?:$|[\s_-])/,
  // Environment mutation
  /(?:^|[\s_-])(set[_-]?env|putenv|export[_-]?env|env[_-]?var)(?:$|[\s_-])/,
  // Process / service lifecycle / app launch
  /(?:^|[\s_-])(kill|pkill|shutdown|reboot|restart[_-]?service|systemctl|launchctl|open[_-]?app|launch[_-]?app)(?:$|[\s_-])/,
  // Computer use actuation (full user-equivalent control)
  /\bcomputer_(click|type|key|scroll|mouse_move|open_app|open_uri|ax_press)\b/,
]

const HIGH_INTENT_PATTERNS = [
  // Generic execution / shell
  /(?:^|[\s_-])(exec|execute|command|shell|terminal|bash|sh|zsh|powershell|cmd)(?:$|[\s_-])/,
  // Scripting runtimes invoked as tools
  /(?:^|[\s_-])(run[_-]?script|python|node|ruby|perl)(?:$|[\s_-])/,
  // Destructive file operations
  /(?:^|[\s_-])(delete|remove|rmdir|unlink|truncate|overwrite)(?:$|[\s_-])/,
  // Mutation verbs
  /(?:^|[\s_-])(write|save|create|update|edit|modify|patch|put|post)(?:$|[\s_-])/,
  // Package / dependency management
  /(?:^|[\s_-])(install|uninstall|npm|pip|brew|apt|yum)(?:$|[\s_-])/,
  // Browser act (click/type/scroll/navigate can submit forms or change origin)
  /\bbrowser_(click|type|scroll|navigate)\b/,
  /\bcomputer_focus_search\b/,
]

const MEDIUM_INTENT_PATTERNS = [
  // Network access
  /(?:^|[\s_-])(fetch|http|request|download|upload|curl|wget|browse|open[_-]?url)(?:$|[\s_-])/,
  // File-system traversal (read-only but sensitive)
  /(?:^|[\s_-])(file|filesystem|directory|folder|read[_-]?file|readdir|stat|glob)(?:$|[\s_-])/,
  // Database operations
  /(?:^|[\s_-])(database|sql|query[_-]?db|mongo|redis|insert|drop[_-]?table)(?:$|[\s_-])/,
  // Browser secondary + screen observe (may show secrets)
  /\bbrowser_(tabs|screenshot)\b/,
  /\bcomputer_screenshot\b/,
  /\bcomputer_wait\b/,
]

const LOW_INTENT_PATTERNS = [
  /(?:^|[\s_-])(search|query|find|lookup|list|get|inspect|read|describe|show|view|count|check|status|info|help|version)(?:$|[\s_-])/,
  /\bbrowser_snapshot\b/,
]

// ---------------------------------------------------------------------------
// 2. Path-sensitivity patterns
// ---------------------------------------------------------------------------

const CRITICAL_PATH_PATTERNS = [
  // Unix system paths
  /\/etc\/(passwd|shadow|sudoers|ssh)/,
  // SSH keys
  /\.ssh\/(id_|authorized_keys|known_hosts)/,
  // Root-level system dirs anywhere in a value (`cat /proc/kcore`, `of=/dev/sda`), except harmless devices
  /(?:^|[\s"'=:<>(`])\/(?:boot|proc|sys)\//,
  /(?:^|[\s"'=:<>(`])\/dev\/(?!(?:null|stdout|stderr|stdin|tty)\b|fd\/)/,
]

const HIGH_PATH_PATTERNS = [
  // Home-directory dotfiles with secrets
  /\.(env|env\.local|env\.prod|npmrc|netrc|aws\/credentials|gitconfig)/,
  // Generic config dirs
  /\/etc\//,
  // OS keychain / credential stores
  /(keychain|credential[_-]?store|gnome-keyring|kwallet)/,
]

const MEDIUM_PATH_PATTERNS = [
  // Temporary dirs (may still leak data)
  /\/(tmp|temp|var\/log)\//,
  // Node modules — large blast radius
  /node_modules/,
]

// ---------------------------------------------------------------------------
// 3. Argument patterns (inspected when args are provided)
// ---------------------------------------------------------------------------

const CRITICAL_ARG_PATTERNS = [
  // Force / recursive destructive flags
  // NOTE: we avoid \b before - because JSON.stringify produces strings like
  // '{"command":"rm -rf /"}' where the hyphen is preceded by a word char.
  /-rf/,
  /--force/,
  /--no-preserve-root/,
  // rm with a recursive and a force flag, in any order or form (-fr, -r -f, -rfv, --recursive --force)
  /\brm\s+(?=(?:[^;&|]*\s)?-(?:[a-z]*r[a-z]*|-recursive)\b)(?=(?:[^;&|]*\s)?-(?:[a-z]*f[a-z]*|-force)\b)/,
  // Recursive rm of the home directory or root, even without -f (rm -r ~/, rm -r "$HOME", rm -r /*)
  /\brm\s+(?=(?:[^;&|]*\s)?-(?:[a-z]*r[a-z]*|-recursive)\b)[^;&|]*\s["']?(?:~|\$home|\$\{home\}|\/)\/?\*?["']?(?=[\s;&|]|$)/,
  // find that deletes what it finds
  /\bfind\s[^;&|]*\s-(?:delete|exec(?:dir)?\s+rm)\b/,
  // Disk formatting / raw writes to a device
  /\bmkfs\b/,
  /\bdd\s[^;&|]*\bof=\/dev\//,
  // Runs as root
  /\bsudo\b/,
  // Pipe to shell (json: {"command":"curl ... | bash"})
  /\|\s*(sh|bash|zsh|eval)/,
  // Inline eval
  /\beval\s*\(/,
]

const HIGH_ARG_PATTERNS = [
  // Recursive flag on its own (-r, -R, -rt, --recursive); text is lowercased
  /(?:^|[\s"'])-(?:[a-z]*r[a-z]*|-recursive)(?=[\s"']|$)/,
  // Wildcard glob that could be dangerous
  /[*?]\s/,
  // Redirect / append to file
  />{1,2}\s*\//,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function testPatterns(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function flattenArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}

const MAX_ARG_DEPTH = 8

/**
 * The texts the path and argument patterns run on, lowercased: the flattened args (as before), every string value
 * (so JSON quoting does not hide `"/"` or the end of a command) and each string array joined by spaces
 * (`["rm", "-r", "/"]`).
 */
function argTexts(args: unknown): string[] {
  const texts = new Set<string>()
  const flat = flattenArgs(args)
  if (flat) texts.add(flat.toLowerCase())
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_ARG_DEPTH || value == null) return
    if (typeof value === 'string') {
      if (value) texts.add(value.toLowerCase())
      return
    }
    if (typeof value !== 'object') return
    const items = Array.isArray(value) ? value : Object.values(value)
    if (Array.isArray(value)) {
      const joined = value.filter((v): v is string => typeof v === 'string').join(' ')
      if (joined) texts.add(joined.toLowerCase())
    }
    for (const item of items) walk(item, depth + 1)
  }
  walk(args, 0)
  return [...texts]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RiskClassification = {
  tier: ToolRiskTier
  signals: RiskSignal[]
}

export type RiskSignal = {
  source: 'intent' | 'path' | 'args'
  tier: ToolRiskTier
  matched: string
}

/**
 * Classify the risk tier of a tool invocation by analysing its name,
 * description, and (optionally) the concrete arguments it will receive.
 *
 * Returns the **highest** tier detected across all three signal sources
 * plus a list of the individual signals that contributed.
 */
/**
 * Built-in read-only tools that only call public HTTP APIs / local storage.
 * Force LOW so they don't trip MEDIUM network-intent patterns (fetch/url).
 */
const BUILTIN_LOW_RISK_TOOLS = new Set([
  'web_search',
  'parse_link',
  'read_video_url',
  'read_video',
  'query_knowledge_base',
  'get_files_meta',
  'list_files',
  'list_tasks',
  'memory_lookup',
  'memory_recall',
  'memory_list',
  'memory_reflect',
  'computer_ax_query',
  'computer_frontmost',
])

export function classifyToolRisk(toolName: string, description?: string, args?: unknown): RiskClassification {
  const baseName = toolName.split(/[:/]|__/).at(-1) || toolName
  if (BUILTIN_LOW_RISK_TOOLS.has(baseName) || BUILTIN_LOW_RISK_TOOLS.has(toolName)) {
    return {
      tier: ToolRiskTier.LOW,
      signals: [{ source: 'intent', tier: ToolRiskTier.LOW, matched: baseName }],
    }
  }

  const signals: RiskSignal[] = []

  const intentText = `${toolName} ${description ?? ''}`.toLowerCase()
  classifyIntent(intentText, signals)

  const texts = argTexts(args)
  if (texts.length > 0) {
    classifyPaths(texts, signals)
    classifyArgs(texts, signals)
  }

  // Also check paths that might appear in the description
  classifyPaths([intentText], signals)

  const tier =
    signals.length > 0
      ? signals.reduce<ToolRiskTier>((max, s) => (tierRank(s.tier) > tierRank(max) ? s.tier : max), ToolRiskTier.LOW)
      : ToolRiskTier.MEDIUM // unknown tools default to MEDIUM

  return { tier, signals }
}

/**
 * Drop-in replacement for the legacy `getToolRiskTier()` function.
 * Returns just the tier enum value.
 */
export function getToolRiskTier(toolName: string, description?: string, args?: unknown): ToolRiskTier {
  return classifyToolRisk(toolName, description, args).tier
}

// ---------------------------------------------------------------------------
// Internal classifiers
// ---------------------------------------------------------------------------

function classifyIntent(text: string, signals: RiskSignal[]): void {
  if (testPatterns(text, CRITICAL_INTENT_PATTERNS)) {
    signals.push({
      source: 'intent',
      tier: ToolRiskTier.CRITICAL,
      matched: extractMatch(text, CRITICAL_INTENT_PATTERNS),
    })
  }
  if (testPatterns(text, HIGH_INTENT_PATTERNS)) {
    signals.push({ source: 'intent', tier: ToolRiskTier.HIGH, matched: extractMatch(text, HIGH_INTENT_PATTERNS) })
  }
  if (testPatterns(text, MEDIUM_INTENT_PATTERNS)) {
    signals.push({ source: 'intent', tier: ToolRiskTier.MEDIUM, matched: extractMatch(text, MEDIUM_INTENT_PATTERNS) })
  }
  if (testPatterns(text, LOW_INTENT_PATTERNS)) {
    signals.push({ source: 'intent', tier: ToolRiskTier.LOW, matched: extractMatch(text, LOW_INTENT_PATTERNS) })
  }
}

function classifyPaths(texts: string[], signals: RiskSignal[]): void {
  pushFirstMatch(texts, CRITICAL_PATH_PATTERNS, 'path', ToolRiskTier.CRITICAL, signals)
  pushFirstMatch(texts, HIGH_PATH_PATTERNS, 'path', ToolRiskTier.HIGH, signals)
  pushFirstMatch(texts, MEDIUM_PATH_PATTERNS, 'path', ToolRiskTier.MEDIUM, signals)
}

function classifyArgs(texts: string[], signals: RiskSignal[]): void {
  pushFirstMatch(texts, CRITICAL_ARG_PATTERNS, 'args', ToolRiskTier.CRITICAL, signals)
  pushFirstMatch(texts, HIGH_ARG_PATTERNS, 'args', ToolRiskTier.HIGH, signals)
}

/** One signal per tier: the first text any of the patterns matches. */
function pushFirstMatch(
  texts: string[],
  patterns: RegExp[],
  source: RiskSignal['source'],
  tier: ToolRiskTier,
  signals: RiskSignal[]
): void {
  const text = texts.find((t) => testPatterns(t, patterns))
  if (text !== undefined) signals.push({ source, tier, matched: extractMatch(text, patterns) })
}

function extractMatch(text: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) return m[0]
  }
  return ''
}

function tierRank(tier: ToolRiskTier): number {
  switch (tier) {
    case ToolRiskTier.LOW:
      return 0
    case ToolRiskTier.MEDIUM:
      return 1
    case ToolRiskTier.HIGH:
      return 2
    case ToolRiskTier.CRITICAL:
      return 3
  }
}

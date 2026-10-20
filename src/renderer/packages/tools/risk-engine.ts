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

// Shell fragments for the recursive-command patterns below (text is lowercased first).
/** Somewhere in this command (not past ; & |), a recursive flag: -r, -R, -rfv, --recursive. */
const HAS_RECURSIVE_FLAG = String.raw`(?=(?:[^;&|]*\s)?-(?:[a-z]*r[a-z]*|-recursive)\b)`
/** Somewhere in this command, a force flag: -f, -rf, --force. */
const HAS_FORCE_FLAG = String.raw`(?=(?:[^;&|]*\s)?-(?:[a-z]*f[a-z]*|-force)\b)`
/** Where a whole argument ends: space, a shell separator, `)` or a backtick (`$(rm -r ~)`), or the end. */
const ARG_END = String.raw`(?=[\s;&|)\x60]|$)`
/** One path segment. */
const SEGMENT = String.raw`[^/\s;&|"'()\x60]+`
/** First-level home folders that are only caches or scratch space: deleting them is not CRITICAL. */
const DISPOSABLE_HOME_FOLDER = String.raw`(?:\.cache|\.npm|\.pnpm-store|\.yarn|\.bun|\.gradle|\.m2|tmp|temp|\.tmp)(?=[/"']|${ARG_END})`
/** Home, or a first-level folder in it: ~ ~/ ~// ~bob "${HOME}"/ ${HOME:?}/ ~/.* $HOME/.. ~/Documents ~/.ssh */
const HOME_TARGET = String.raw`["']?(?:~[\w.-]*|\$home|\$\{home(?::[^}]*)?\})["']?(?:\/+(?:(?!${DISPOSABLE_HOME_FOLDER})${SEGMENT})?\/?\*?)?["']?${ARG_END}`
/** A whole argument that means home, root, the parent or everything here: home targets, / /* .. ../* * .* ./* */
const BROAD_TARGET = String.raw`(?:${HOME_TARGET}|["']?(?:\.\.\/?\*?|\/\*?|\*|\.\*|\.\/\*)["']?${ARG_END})`
/** Root, a top-level system directory or one folder in it: / /etc /usr/ /var/lib /Users/me /home/* */
const SYSTEM_ROOT_TARGET = String.raw`["']?\/(?:(?:etc|usr|bin|sbin|lib|lib64|var|boot|sys|proc|dev|root|home|opt|system|library|applications|users)(?:\/${SEGMENT})?\/?)?\*?["']?${ARG_END}`

/** Spawn-style args: the command field and the args-array field that go together. */
const SPAWN_COMMAND_KEYS = ['command', 'cmd', 'program', 'executable', 'bin']
const SPAWN_ARGS_KEYS = ['args', 'argv', 'arguments']

const CRITICAL_ARG_PATTERNS = [
  // Force / recursive destructive flags
  // NOTE: we avoid \b before - because JSON.stringify produces strings like
  // '{"command":"rm -rf /"}' where the hyphen is preceded by a word char.
  /-rf/,
  /--force/,
  /--no-preserve-root/,
  // rm with a recursive and a force flag, in any order or form (-fr, -r -f, -rfv, --recursive --force)
  new RegExp(`\\brm\\s+${HAS_RECURSIVE_FLAG}${HAS_FORCE_FLAG}`),
  // Recursive rm, chmod or chown of home (or a first-level folder in it), root, a system directory, the parent or
  // everything here, even without -f (rm -r ~/, rm -r ~/Documents, rm -r /var/lib, rm -r .., chmod -R 777 /)
  new RegExp(`\\b(?:rm|chmod|chown)\\s+${HAS_RECURSIVE_FLAG}[^;&|]*\\s(?:${BROAD_TARGET}|${SYSTEM_ROOT_TARGET})`),
  // chmod / chown of root or a system directory (chmod 777 /, chown root /usr/)
  new RegExp(`\\b(?:chmod|chown)\\s+[^;&|]*\\s${SYSTEM_ROOT_TARGET}`),
  // find that deletes or shreds what it finds (-delete, -exec rm, -exec /bin/rm, -exec shred)
  /\bfind\s[^;&|]*\s-(?:delete|exec(?:dir)?\s+(?:\S*\/)?(?:rm|shred))\b/,
  /\bshred\b/,
  // rsync that deletes extra files in home or a first-level home folder
  new RegExp(`\\brsync\\s(?=[^;&|]*\\s--delete)[^;&|]*\\s${HOME_TARGET}`),
  // Recursive delete from code: shutil.rmtree / fs.rmSync / rimraf of / or ~
  /\b(?:shutil\.rmtree|rmsync|rimraf)\b\s*\(?\s*(?:[\w.]+\(\s*)?["']?(?:\/|~|\$home)\/?["']?(?=[\s,);&|`]|$)/,
  // Force push (-f, like --force above)
  /\bgit\s+push\b[^;&|]*\s-[a-z]*f[a-z]*\b/,
  // Disk formatting / raw writes to a device
  /\bmkfs\b/,
  /\bdiskutil\s+(?:erase\w*|zerodisk|secureerase|partitiondisk|reformat)\b/,
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

function stringItems(list: unknown[]): string[] {
  return list.filter((v): v is string => typeof v === 'string')
}

/**
 * The texts the path and argument patterns run on, lowercased: the flattened args (as before), every string value
 * (so JSON quoting does not hide `"/"` or the end of a command), each string array joined by spaces
 * (`["rm", "-r", "/"]`) and each spawn-style command with its args (`{ command: "rm", args: ["-r", "~"] }`).
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
    if (Array.isArray(value)) {
      const joined = stringItems(value).join(' ')
      if (joined) texts.add(joined.toLowerCase())
      for (const item of value) walk(item, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    // Spawn-style call: { command: 'rm', args: ['-r', '~'] } reads as `rm -r ~`. Only these key pairs are joined, so
    // unrelated fields ({ cmd: 'rm -r build', cwd: '/' }) never combine.
    for (const commandKey of SPAWN_COMMAND_KEYS) {
      const command = record[commandKey]
      if (typeof command !== 'string' || !command) continue
      for (const argsKey of SPAWN_ARGS_KEYS) {
        const list = record[argsKey]
        if (Array.isArray(list)) texts.add(`${command} ${stringItems(list).join(' ')}`.toLowerCase())
      }
    }
    for (const item of Object.values(record)) walk(item, depth + 1)
  }
  walk(args, 0)
  return [...texts]
}

// ---------------------------------------------------------------------------
// Read-only commands
// ---------------------------------------------------------------------------

/** Fields that carry code in another language: a call with one is never treated as a read-only shell command. */
const CODE_KEYS = ['script', 'code']
/** Anything that chains, substitutes, redirects or continues a command: ; & | < > ` $( ${ and line breaks. */
const SHELL_META = /[;&|<>`\r\n]|\$\(|\$\{/
/** Programs that only read, whatever their (non-meta) arguments. */
const READ_ONLY_PROGRAMS = new Set([
  'ls',
  'll',
  'pwd',
  'whoami',
  'id',
  'uname',
  'uptime',
  'df',
  'du',
  'free',
  'ps',
  'which',
  'type',
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'less',
  'stat',
  'grep',
  'ag',
])
/** Arguments that make an otherwise read-only program write, run something else, or change state. */
const UNSAFE_ARGS: Record<string, (arg: string) => boolean> = {
  find: (arg) => /^-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(arg),
  rg: (arg) => arg === '--pre' || arg.startsWith('--pre='),
  tree: (arg) => arg === '-o' || arg.startsWith('-o'),
  file: (arg) => arg === '-C' || arg === '--compile',
  date: (arg) => arg === '-s' || arg.startsWith('--set') || /^-[a-z]*s/i.test(arg),
}
const HOSTNAME_FLAGS = new Set(['-f', '-s', '-i', '-I', '-d', '--fqdn', '--short'])
const GIT_ANY_ARGS = new Set(['status', 'log', 'diff', 'show', 'rev-parse'])
const GIT_BRANCH_FLAGS = new Set([
  '-a',
  '-r',
  '-v',
  '-vv',
  '-l',
  '--list',
  '--all',
  '--remotes',
  '--verbose',
  '--show-current',
])
const VERSION_FLAGS: Record<string, Set<string>> = {
  node: new Set(['-v', '--version']),
  npm: new Set(['-v', '--version']),
  python: new Set(['-V', '--version']),
  python3: new Set(['-V', '--version']),
}

function isReadOnlyGit(rest: string[]): boolean {
  const [sub, ...args] = rest
  if (!sub) return false
  if (GIT_ANY_ARGS.has(sub)) return !args.some((arg) => arg.startsWith('--output') || arg === '--ext-diff')
  if (sub === 'branch') return args.every((arg) => GIT_BRANCH_FLAGS.has(arg))
  if (sub === 'remote') return args.length === 0 || (args.length === 1 && args[0] === '-v')
  return false
}

/** One simple command (no chaining, substitution or redirects) whose program is on the read-only list. */
function isReadOnlyCommandText(text: string): boolean {
  if (SHELL_META.test(text)) return false
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const [program, ...rest] = tokens
  if (!program || tokens.includes('sudo')) return false
  if (READ_ONLY_PROGRAMS.has(program)) return true
  const unsafe = UNSAFE_ARGS[program]
  if (unsafe) return !rest.some(unsafe)
  if (program === 'hostname') return rest.every((arg) => HOSTNAME_FLAGS.has(arg))
  if (program === 'top') return rest.length === 3 && rest.join(' ') === '-b -n 1'
  if (program === 'env' || program === 'printenv') return rest.length === 0
  if (program === 'git') return isReadOnlyGit(rest)
  const versions = VERSION_FLAGS[program]
  if (versions) return rest.length === 1 && versions.has(rest[0])
  return false
}

/**
 * True only when the call runs a single simple command that just reads: `ls -la`, `df -h`, `git status`,
 * `cat README.md`, `{ command: 'ls', args: ['-la'] }`. Every command field (with its spawn-style args) must pass;
 * a call with no command, or with a `script`/`code` field, is not read-only. Pair with the risk tier: a read-only
 * program can still read something sensitive (`cat ~/.ssh/id_rsa` is CRITICAL).
 */
export function isReadOnlyCommand(args: unknown): boolean {
  if (typeof args === 'string') return isReadOnlyCommandText(args)
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  const record = args as Record<string, unknown>
  if (CODE_KEYS.some((key) => record[key] !== undefined)) return false
  const commands: string[] = []
  for (const commandKey of SPAWN_COMMAND_KEYS) {
    const command = record[commandKey]
    if (command === undefined) continue
    if (typeof command !== 'string') return false
    const lists = SPAWN_ARGS_KEYS.map((key) => record[key]).filter(Array.isArray)
    if (lists.length === 0) commands.push(command)
    for (const list of lists) {
      if (list.some((item) => typeof item !== 'string')) return false
      commands.push(`${command} ${list.join(' ')}`)
    }
  }
  return commands.length > 0 && commands.every(isReadOnlyCommandText)
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

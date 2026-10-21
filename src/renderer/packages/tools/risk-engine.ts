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
  // Reads on-screen text, which may show secrets
  /\bcomputer_ax_query\b/,
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

/** Fields that carry code in another language. */
const CODE_KEYS = ['script', 'code']
/** The only argument keys a read-only shell call may have; any other key (a decoy `cmdline`, a SQL `query`) asks. */
const READ_ONLY_ARG_KEYS = new Set([
  'command',
  'cmd',
  'args',
  'argv',
  'arguments',
  'cwd',
  'timeout',
  'timeoutMs',
  'timeout_ms',
  'reason',
  'explanation',
  'purpose',
  'description',
])
const READ_ONLY_COMMAND_KEYS = ['command', 'cmd']
/** Keys whose values are prose for the user, not part of the command. */
const PROSE_KEYS = new Set(['reason', 'explanation', 'purpose', 'description'])
/**
 * The only characters a read-only command may use. Everything else — quotes, backslashes, brackets, `$`, `~`, `*`,
 * `?`, `!`, `@`, `%`, `^` (cmd.exe), redirects, separators, line breaks and any non-ASCII — means the shell could read it differently
 * than we do, so the call asks.
 */
const SAFE_COMMAND_TEXT = /^[A-Za-z0-9 _\-.,/:=+]*$/
/** git's `--format=` / `--pretty=` values may use `%` placeholders (`--format=%h`); nothing else may (cmd.exe `%VAR%`). */
const GIT_FORMAT_FLAG = /^--(?:format|pretty)=/
/** Paths that hold credentials or keys; reading one always asks. */
const SECRET_PATH =
  /(?:^|[/:=])\.env|\.aws(?:\/|$)|\.ssh(?:\/|$)|\.gnupg(?:\/|$)|\.kube(?:\/|$)|\.docker\/config\.json|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.config\/gh(?:\/|$)|\.config\/hub|\.config\/rclone|\.bash_history|\.zsh_history|(?:^|[/:=])\.history|\.pgpass|\.s3cfg|\.boto|credentials|\.pem$|\.key$|(?:^|[/:])id_|secret|token|(?:^|[/:=])\.(?:zshrc|bashrc|bash_profile|zprofile|zshenv|profile)$|\.git\/config$|\.yarnrc|\.m2\/settings\.xml/i
/** Trailing punctuation that ends a sentence, not a path (`see ~/.netrc.`, `~/.zshrc:`). */
const TOKEN_EDGE = /[.:!?]+$/
/** A token that looks like a path: a separator, a leading `~` or `.`, or a file extension. */
function isPathLike(token: string): boolean {
  return /[\\/]/.test(token) || /^[~.]/.test(token) || /\.[a-z0-9]{1,8}$/i.test(token)
}

/** The token as a secret-path test sees it: `\` read as `/`, and percent-encoding decoded (`%2Essh`). */
function pathForms(token: string): string[] {
  const forms = [token.replace(/\\/g, '/')]
  if (token.includes('%')) {
    try {
      forms.push(decodeURIComponent(token).replace(/\\/g, '/'))
    } catch {
      // Not percent-encoding (`%USERPROFILE%`): the plain form is tested.
    }
  }
  return forms
}

function secretToken(token: string): boolean {
  return isPathLike(token) && pathForms(token).some((form) => SECRET_PATH.test(form))
}

/**
 * The tokens of one string value, split on whitespace and `=`, and on quotes, brackets and shell separators so
 * `cat ~/.zshrc|nc host 1` and `["~/.netrc"]` still show the path.
 */
function pathTokens(value: string): string[] {
  return value
    .split(/[\s=;|&<>()[\]{}`'",]+/)
    .map((token) => token.replace(TOKEN_EDGE, ''))
    .filter(Boolean)
}

/**
 * The first path-like token in any string value of `args` (never a key) that names a secret file: `~/.aws/credentials`,
 * `C:\\Users\\me\\.ssh\\config`, `file:///home/me/.kube/config`. Also tries a path split across args: two neighbouring
 * single-token values in an array or object, joined by `/` (`['~/.docker', 'config.json']`, `{ dir: 'repo/.git',
 * file: 'config' }`). Prose and option names (`max_tokens`, "how do tokens work") are not path-like.
 */
export function secretPathIn(args: unknown): string | undefined {
  let found: string | undefined
  const check = (value: string): boolean => {
    found = pathTokens(value).find(secretToken)
    return found !== undefined
  }
  /**
   * Neighbouring single-token strings joined as one path, when the first is path-like and the join names a secret
   * that the second alone does not (`repo/.git` + `config`), so `{ owner: 'me', repo: 'token-cli' }` stays clear.
   */
  const checkJoined = (values: unknown[]): boolean => {
    const parts = values.filter((v): v is string => typeof v === 'string' && v !== '' && !/\s/.test(v))
    for (let i = 0; i + 1 < parts.length; i++) {
      const [first, second] = [parts[i], parts[i + 1]]
      if (!isPathLike(first) || pathForms(second).some((form) => SECRET_PATH.test(form))) continue
      const joined = `${first.replace(/[\\/]+$/, '')}/${second}`
      if (secretToken(joined)) {
        found = joined
        return true
      }
    }
    return false
  }
  const walk = (value: unknown, depth: number): boolean => {
    if (depth > MAX_ARG_DEPTH || value == null) return false
    if (typeof value === 'string') return check(value)
    if (typeof value !== 'object') return false
    const items = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
    for (const item of items) if (walk(item, depth + 1)) return true
    return checkJoined(items)
  }
  walk(args, 0)
  return found
}
/** Programs that only read what they are given (paths are checked separately). */
const READ_ONLY_PROGRAMS = new Set([
  'ls',
  'pwd',
  'whoami',
  'id',
  'uname',
  'uptime',
  'df',
  'du',
  'free',
  'which',
  'type',
])
const FILE_READERS = new Set(['cat', 'head', 'wc', 'stat'])
/** Programs whose operands are paths; a read-only call to them may pass flags and numbers only. */
const OPERAND_FREE_PROGRAMS = new Set(['ls', 'du', ...FILE_READERS, 'tail', 'grep', 'find'])
const RECURSIVE_FLAG = /^-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)$|^--directories=recurse$|^-d$/
const FIND_UNSAFE = /^-(?:delete|exec\w*|ok\w*|fprint\w*|fls)$/
const TAIL_FOLLOW = /^-(?:[a-zA-Z]*[fF][a-zA-Z]*|-follow\b.*|-retry|-pid\b.*)$/
const GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'rev-parse'])
const GIT_UNSAFE =
  /^(?:-o|-c|-C|--output\b.*|--ext-diff|--textconv|--exec-path\b.*|--upload-pack\b.*|--git-dir\b.*|--work-tree\b.*|--no-index)$/
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

/** A path-like operand that stays inside the working folder and is not a secret. */
function isSafeOperand(token: string): boolean {
  // Each `=`-separated part too, so `--file=C:/x` is checked like `C:/x`.
  for (const part of token.split('=')) {
    // Absolute (`/etc`), UNC (`//server`), drive-letter (`C:`, `c:/`) and parent (`..`) paths leave the folder.
    if (part.startsWith('/') || /^[A-Za-z]:/.test(part) || part.startsWith('..') || part.includes('/..')) return false
  }
  return !SECRET_PATH.test(token)
}

function isReadOnlyGit(rest: string[]): boolean {
  const [sub, ...args] = rest
  if (!sub || !args.every((arg) => !GIT_UNSAFE.test(arg) && isSafeOperand(arg))) return false
  if (GIT_SUBCOMMANDS.has(sub)) return true
  if (sub === 'branch') return args.every((arg) => GIT_BRANCH_FLAGS.has(arg))
  if (sub === 'remote') return args.length === 0 || (args.length === 1 && args[0] === '-v')
  return false
}

/** One simple command, from safe characters only, whose program is on the read-only list. */
function isReadOnlyCommandText(text: string): boolean {
  const [program, ...rest] = text.trim().split(' ').filter(Boolean)
  const checked =
    program === 'git'
      ? text.replace(/\S+/g, (token) => (GIT_FORMAT_FLAG.test(token) ? token.replace(/%/g, '') : token))
      : text
  if (!SAFE_COMMAND_TEXT.test(checked)) return false
  if (!program) return false
  if (!rest.every(isSafeOperand)) return false
  // The working folder is unknown (it may be home), so these read no named path: flags and numbers only.
  if (OPERAND_FREE_PROGRAMS.has(program) && !rest.every((arg) => arg.startsWith('-') || /^\d+$/.test(arg))) {
    return false
  }
  if (READ_ONLY_PROGRAMS.has(program)) return program !== 'ls' || !rest.some((arg) => RECURSIVE_FLAG.test(arg))
  if (FILE_READERS.has(program)) return true
  if (program === 'tail') return !rest.some((arg) => TAIL_FOLLOW.test(arg))
  if (program === 'grep') return !rest.some((arg) => RECURSIVE_FLAG.test(arg))
  if (program === 'find') return !rest.some((arg) => FIND_UNSAFE.test(arg))
  // `ps e`/`ps eww` print other processes' environment: dash flags only, and none that add the environment.
  if (program === 'ps') return rest.every((arg) => arg.startsWith('-') && !/e{2}|w.*e|^-[a-zA-Z]*E/.test(arg))
  if (program === 'hostname') return rest.length === 0
  if (program === 'git') return isReadOnlyGit(rest)
  return false
}

/**
 * True only for a plain shell call that just reads inside the working folder: `ls -la`, `df -h`, `git status`,
 * `cat README.md`, `{ command: 'ls', args: ['-la'], cwd: '.' }`. Every argument key must be a known command key
 * (`command`, `cmd`, spawn-style `args`, `cwd`, a timeout or a reason); each command must be one simple command of
 * safe characters on the read-only list, reading no secret and nothing outside the folder; and the arguments alone
 * must classify at most MEDIUM. Fails safe: anything unusual asks.
 */
export function isReadOnlyCommand(args: unknown): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  const record = args as Record<string, unknown>
  if (!Object.keys(record).every((key) => READ_ONLY_ARG_KEYS.has(key))) return false
  const cwd = record.cwd
  if (cwd !== undefined && (typeof cwd !== 'string' || !SAFE_COMMAND_TEXT.test(cwd) || !isSafeOperand(cwd))) {
    return false
  }
  const commands: string[] = []
  for (const commandKey of READ_ONLY_COMMAND_KEYS) {
    const command = record[commandKey]
    if (command === undefined) continue
    if (typeof command !== 'string') return false
    const lists = SPAWN_ARGS_KEYS.map((key) => record[key]).filter((value) => value !== undefined)
    if (lists.length === 0) commands.push(command)
    for (const list of lists) {
      if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) return false
      commands.push(`${command} ${list.join(' ')}`)
    }
  }
  if (commands.length === 0 || !commands.every(isReadOnlyCommandText)) return false
  const commandArgs = Object.fromEntries(Object.entries(record).filter(([key]) => !PROSE_KEYS.has(key)))
  return tierRank(getArgsRiskTier(commandArgs)) <= tierRank(ToolRiskTier.MEDIUM)
}

/** The risk tier of a call's arguments alone, without the tool's name or description. */
export function getArgsRiskTier(args: unknown): ToolRiskTier {
  const signals: RiskSignal[] = []
  const texts = argTexts(args)
  classifyPaths(texts, signals)
  classifyArgs(texts, signals)
  pushSecretPath(args, signals)
  return signals.reduce<ToolRiskTier>((max, s) => (tierRank(s.tier) > tierRank(max) ? s.tier : max), ToolRiskTier.LOW)
}

/**
 * The command texts a call carries, in their original case: a bare string, each `command`/`cmd`/`program`/
 * `executable`/`bin` field (joined with its spawn-style `args`/`argv`/`arguments`, as the risk engine reads them),
 * `script` and `code` fields, and string arrays (`["rm", "-r", "~"]`), at any depth.
 */
export function commandTexts(args: unknown): string[] {
  const texts = new Set<string>()
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_ARG_DEPTH || value == null) return
    if (typeof value === 'string') {
      if (depth === 0 && value.trim()) texts.add(value)
      return
    }
    if (typeof value !== 'object') return
    if (Array.isArray(value)) {
      const joined = stringItems(value).join(' ')
      if (joined.trim()) texts.add(joined)
      for (const item of value) if (typeof item === 'object') walk(item, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    for (const commandKey of SPAWN_COMMAND_KEYS) {
      const command = record[commandKey]
      if (typeof command !== 'string' || !command.trim()) continue
      const lists = SPAWN_ARGS_KEYS.map((key) => record[key]).filter(Array.isArray)
      if (lists.length === 0) texts.add(command)
      for (const list of lists) texts.add(`${command} ${stringItems(list).join(' ')}`)
    }
    for (const key of CODE_KEYS) {
      const code = record[key]
      if (typeof code === 'string' && code.trim()) texts.add(code)
    }
    for (const [key, item] of Object.entries(record)) {
      if (typeof item === 'object' && !SPAWN_ARGS_KEYS.includes(key)) walk(item, depth + 1)
    }
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
 * Dango's own read-only tools that only call public HTTP APIs / local storage. They rate LOW so they don't trip
 * MEDIUM network-intent patterns (fetch/url), but only when the caller says the tool is a Dango built-in
 * (`opts.builtin`): a name alone never earns LOW, since an MCP server, plugin or skill can name a tool anything.
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
  'computer_frontmost',
])

export type ToolRiskOptions = {
  /** True only for tools from a Dango toolset (never MCP, plugin, skill or hook tools). */
  builtin?: boolean
}

export function classifyToolRisk(
  toolName: string,
  description?: string,
  args?: unknown,
  opts?: ToolRiskOptions
): RiskClassification {
  if (opts?.builtin === true && !toolName.startsWith('mcp__') && BUILTIN_LOW_RISK_TOOLS.has(toolName)) {
    // CRITICAL arguments (`/etc/shadow`, `rm -rf ~`) still count, even for a built-in.
    const argSignals: RiskSignal[] = []
    const texts = argTexts(args)
    if (texts.length > 0) {
      classifyPaths(texts, argSignals)
      classifyArgs(texts, argSignals)
    }
    const critical = argSignals.filter((s) => s.tier === ToolRiskTier.CRITICAL)
    if (critical.length > 0) {
      return { tier: ToolRiskTier.CRITICAL, signals: critical }
    }
    // A secret path (`~/.aws/credentials`) is at least HIGH, even for a built-in.
    const secretSignals: RiskSignal[] = []
    pushSecretPath(args, secretSignals)
    if (secretSignals.length > 0) return { tier: ToolRiskTier.HIGH, signals: secretSignals }
    return {
      tier: ToolRiskTier.LOW,
      signals: [{ source: 'intent', tier: ToolRiskTier.LOW, matched: toolName }],
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
  pushSecretPath(args, signals)

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
export function getToolRiskTier(
  toolName: string,
  description?: string,
  args?: unknown,
  opts?: ToolRiskOptions
): ToolRiskTier {
  return classifyToolRisk(toolName, description, args, opts).tier
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

/** A secret path in the args rates HIGH. */
function pushSecretPath(args: unknown, signals: RiskSignal[]): void {
  const matched = secretPathIn(args)
  if (matched !== undefined) signals.push({ source: 'path', tier: ToolRiskTier.HIGH, matched })
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

import { t } from 'i18next'
import { commandTexts } from '../tools/risk-engine'

/** Runs a downloaded script: `curl … | sh`, `wget -qO- … | sudo bash`, `bash <(curl …)`, `sh -c "$(curl …)"`. */
const DOWNLOAD_AND_RUN = [
  /\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash)\b/,
  /(?:\b(?:sh|bash|zsh|dash|source)|(?:^|\s)\.)\s+<\(\s*(?:curl|wget)\b/,
  /\b(?:sh|bash|zsh|dash)\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/,
]
/** The script of `bash -c "…"` / `sh -c '…'`, explained like a command of its own. */
const SHELL_DASH_C = /\b(?:ba|z|da)?sh\s+-c\s+(["'])(.*?)\1/g
/** Wrappers that run the command after them: `command rm`, `nohup rm`, `env X=1 rm`, `xargs -0 rm`. */
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'env', 'xargs'])
/** sudo options that take a value (`sudo -u bob rm`). */
const SUDO_VALUE_FLAGS = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U'])
/** Splits a command line into its simple commands: ; && || | & and line breaks. */
const SEGMENT_SEPARATOR = /&&|\|\||[;|&\n]/
const SYSTEM_ROOT =
  /^\/(?:etc|usr|bin|sbin|lib|lib64|var|boot|sys|proc|dev|root|home|opt|system|library|applications|users)\/?\*?$/i
const DISK_ERASE = /^(?:erase\w*|zerodisk|secureerase|partitiondisk|reformat)$/i

function unquote(token: string): string {
  return token.replace(/^["']+|["']+$/g, '')
}

/** The program a token names: `/bin/rm`, `\\rm` and `"rm"` all read as `rm`. */
function programOf(token: string | undefined): string {
  if (!token) return ''
  const bare = unquote(token).replace(/^\\+/, '')
  return bare.split('/').pop() ?? bare
}

/** Drops sudo (noting it) and wrappers in front of the real program; says whether xargs feeds it its operands. */
function unwrap(tokens: string[], lines: string[]): { tokens: string[]; viaXargs: boolean } {
  let rest = tokens
  let viaXargs = false
  for (;;) {
    const program = programOf(rest[0])
    if (program === 'sudo') {
      lines.push(t('Runs with administrator rights.'))
      rest = rest.slice(1)
      while (rest[0]?.startsWith('-')) rest = rest.slice(SUDO_VALUE_FLAGS.has(rest[0]) ? 2 : 1)
    } else if (WRAPPERS.has(program)) {
      if (program === 'xargs') viaXargs = true
      rest = rest.slice(1)
      while (rest[0] && (rest[0].startsWith('-') || /^\d+$/.test(rest[0]) || /^\w+=/.test(rest[0]))) {
        rest = rest.slice(1)
      }
    } else {
      return { tokens: rest, viaXargs }
    }
  }
}

/** A plain-words name for a broad target (home, whole disk, here, the parent), or undefined for anything else. */
function broadTarget(raw: string): string | undefined {
  const target = unquote(raw)
  if (/^(?:~|\$HOME|\$\{HOME\})\/*\*?$/.test(target)) return t('your home folder')
  if (/^\/+\*?$/.test(target)) return t('your whole disk')
  if (/^(?:\.\/?|\*|\.\/\*)$/.test(target)) return t('every file in the current folder')
  if (/^\.\.\/?\*?$/.test(target)) return t('the folder above this one')
  return undefined
}

function isRecursiveFlag(flag: string): boolean {
  return flag === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(flag)
}

function isForceFlag(flag: string): boolean {
  return flag === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(flag)
}

function explainSegment(segment: string, lines: string[]): void {
  const { tokens, viaXargs } = unwrap(segment.trim().split(/\s+/).filter(Boolean), lines)
  const program = programOf(tokens[0])
  const rest = tokens.slice(1)
  const flags = rest.filter((token) => token.startsWith('-'))
  const operands = rest.filter((token) => !token.startsWith('-'))

  if (program === 'rm' && flags.some(isRecursiveFlag)) {
    if (operands.length === 0 && viaXargs) lines.push(t('Deletes every file it is given and everything inside them.'))
    for (const operand of operands) {
      lines.push(
        t('Deletes {{target}} and everything inside it.', { target: broadTarget(operand) ?? unquote(operand) })
      )
    }
    if (flags.some(isForceFlag)) lines.push(t('Skips the confirmation prompts.'))
    return
  }
  if (program === 'find') {
    const deletes =
      rest.includes('-delete') ||
      rest.some(
        (token, i) => (token === '-exec' || token === '-execdir') && ['rm', 'shred'].includes(programOf(rest[i + 1]))
      )
    if (deletes) lines.push(t('Deletes every file that matches the search.'))
    return
  }
  const wipesDisk =
    (program === 'dd' && rest.some((token) => unquote(token).startsWith('of=/dev/'))) ||
    program.startsWith('mkfs') ||
    program === 'wipefs' ||
    (program === 'diskutil' && DISK_ERASE.test(rest[0] ?? '')) ||
    (program === 'shred' && operands.some((operand) => unquote(operand).startsWith('/dev/')))
  if (wipesDisk) {
    lines.push(t('Overwrites a whole disk. Everything on it is lost.'))
    return
  }
  if (program === 'shred') {
    for (const operand of operands) {
      lines.push(t("Overwrites {{target}} so it can't be recovered.", { target: unquote(operand) }))
    }
    return
  }
  if ((program === 'chmod' || program === 'chown') && flags.some(isRecursiveFlag)) {
    for (const operand of operands.slice(1)) {
      const target = broadTarget(operand) ?? (SYSTEM_ROOT.test(unquote(operand)) ? unquote(operand) : undefined)
      if (target) lines.push(t('Changes who can read or change every file under {{target}}.', { target }))
    }
    return
  }
  if (
    program === 'git' &&
    rest[0] === 'push' &&
    rest.some((token) => token.startsWith('--force') || /^-[a-z]*f[a-z]*$/.test(token) || token.startsWith('+'))
  ) {
    lines.push(t("Replaces the remote branch, which can discard other people's work."))
    return
  }
  if (program === 'rsync' && flags.some((flag) => flag.startsWith('--delete'))) {
    const destination = operands.at(-1)
    if (destination && /^["']?(?:~|\$HOME|\$\{HOME\})/.test(destination)) {
      const target = broadTarget(destination) ?? unquote(destination)
      lines.push(t("Deletes files in {{target}} that aren't in the source.", { target }))
    }
  }
}

/**
 * What a command call will do, in Dango's own plain words, for the permission sheet. Deterministic: built from the
 * command in the args (the risk engine's extraction, incl. spawn-style `{ command, args }`), so the model can't
 * word it. Sees through sudo, wrappers (`command`, `env`, `xargs`), `\\rm` and `sh -c "…"`. Recognises recursive deletes, deleting finds, disk wipes, broad recursive chmod/chown, sudo, force
 * pushes, rsync --delete into home and download-and-run pipes; anything else returns [].
 */
export function explainCommand(args: unknown): string[] {
  const lines: string[] = []
  const texts = commandTexts(args)
  for (let i = 0; i < texts.length && i < 16; i++) {
    const text = texts[i]
    if (DOWNLOAD_AND_RUN.some((pattern) => pattern.test(text))) {
      lines.push(t('Downloads a script and runs it straight away.'))
    }
    for (const match of text.matchAll(SHELL_DASH_C)) texts.push(match[2])
    for (const segment of text.split(SEGMENT_SEPARATOR)) explainSegment(segment, lines)
  }
  return [...new Set(lines)]
}

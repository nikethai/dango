import { t } from 'i18next'
import { commandTexts } from '../tools/risk-engine'

/** Pipes that run a downloaded script: `curl … | sh`, `wget -qO- … | sudo bash`. */
const DOWNLOAD_AND_RUN = /\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash)\b/
/** Splits a command line into its simple commands: ; && || | & and line breaks. */
const SEGMENT_SEPARATOR = /&&|\|\||[;|&\n]/
const SYSTEM_ROOT =
  /^\/(?:etc|usr|bin|sbin|lib|lib64|var|boot|sys|proc|dev|root|home|opt|system|library|applications|users)\/?\*?$/i
const DISK_ERASE = /^(?:erase\w*|zerodisk|secureerase|partitiondisk|reformat)$/i

function unquote(token: string): string {
  return token.replace(/^["']+|["']+$/g, '')
}

function programOf(token: string | undefined): string {
  return token ? (token.split('/').pop() ?? token) : ''
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
  let tokens = segment.trim().split(/\s+/).filter(Boolean)
  if (programOf(tokens[0]) === 'sudo') {
    lines.push(t('Runs with administrator rights.'))
    tokens = tokens.slice(1)
    while (tokens[0]?.startsWith('-')) tokens = tokens.slice(1)
  }
  const program = programOf(tokens[0])
  const rest = tokens.slice(1)
  const flags = rest.filter((token) => token.startsWith('-'))
  const operands = rest.filter((token) => !token.startsWith('-'))

  if (program === 'rm' && flags.some(isRecursiveFlag)) {
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
    rest.some((token) => token.startsWith('--force') || /^-[a-z]*f[a-z]*$/.test(token))
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
 * word it. Recognises recursive deletes, deleting finds, disk wipes, broad recursive chmod/chown, sudo, force
 * pushes, rsync --delete into home and download-and-run pipes; anything else returns [].
 */
export function explainCommand(args: unknown): string[] {
  const lines: string[] = []
  for (const text of commandTexts(args)) {
    if (DOWNLOAD_AND_RUN.test(text)) lines.push(t('Downloads a script and runs it straight away.'))
    for (const segment of text.split(SEGMENT_SEPARATOR)) explainSegment(segment, lines)
  }
  return [...new Set(lines)]
}

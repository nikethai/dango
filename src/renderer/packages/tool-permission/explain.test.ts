import { describe, expect, it, vi } from 'vitest'
import { commandToolInstructions } from './describe'
import { explainCommand } from './explain'

vi.mock('i18next', () => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
}))

const SKIPS = 'Skips the confirmation prompts.'
const DISK = 'Overwrites a whole disk. Everything on it is lost.'

describe('explainCommand', () => {
  it('recursive rm names the target in plain words', () => {
    expect(explainCommand({ command: 'rm -rf ~' })).toEqual([
      'Deletes your home folder and everything inside it.',
      SKIPS,
    ])
    expect(explainCommand({ command: 'rm -r $HOME' })).toEqual(['Deletes your home folder and everything inside it.'])
    expect(explainCommand({ command: 'rm -r /' })).toEqual(['Deletes your whole disk and everything inside it.'])
    expect(explainCommand({ command: 'rm -fr *' })).toEqual([
      'Deletes every file in the current folder and everything inside it.',
      SKIPS,
    ])
    expect(explainCommand({ command: 'rm --recursive --force ..' })).toEqual([
      'Deletes the folder above this one and everything inside it.',
      SKIPS,
    ])
    expect(explainCommand({ command: 'rm -r build' })).toEqual(['Deletes build and everything inside it.'])
  })

  it('reads spawn-style command + args and other command fields', () => {
    expect(explainCommand({ command: 'rm', args: ['-rf', '~/'] })).toEqual([
      'Deletes your home folder and everything inside it.',
      SKIPS,
    ])
    expect(explainCommand({ cmd: 'sudo rm -r /' })).toEqual([
      'Runs with administrator rights.',
      'Deletes your whole disk and everything inside it.',
    ])
  })

  it('find that deletes', () => {
    expect(explainCommand({ command: 'find . -name "*.log" -delete' })).toEqual([
      'Deletes every file that matches the search.',
    ])
    expect(explainCommand({ command: 'find /tmp -exec rm {} +' })).toEqual([
      'Deletes every file that matches the search.',
    ])
  })

  it('disk wipes', () => {
    for (const command of [
      'dd if=/dev/zero of=/dev/sda',
      'mkfs.ext4 /dev/sdb1',
      'diskutil eraseDisk JHFS+ X disk2',
      'wipefs -a /dev/sda',
      'shred /dev/sda',
    ]) {
      expect(explainCommand({ command }), command).toEqual([DISK])
    }
    expect(explainCommand({ command: 'shred secrets.txt' })).toEqual([
      "Overwrites secrets.txt so it can't be recovered.",
    ])
  })

  it('recursive chmod/chown of a broad target', () => {
    expect(explainCommand({ command: 'chmod -R 777 /' })).toEqual([
      'Changes who can read or change every file under your whole disk.',
    ])
    expect(explainCommand({ command: 'chown -R bob ~' })).toEqual([
      'Changes who can read or change every file under your home folder.',
    ])
    expect(explainCommand({ command: 'chmod -R 755 build' })).toEqual([])
  })

  it('sudo, force push, rsync --delete into home, curl | sh', () => {
    expect(explainCommand({ command: 'sudo apt update' })).toEqual(['Runs with administrator rights.'])
    expect(explainCommand({ command: 'git push -f origin main' })).toEqual([
      "Replaces the remote branch, which can discard other people's work.",
    ])
    expect(explainCommand({ command: 'git push --force' })).toEqual([
      "Replaces the remote branch, which can discard other people's work.",
    ])
    expect(explainCommand({ command: 'rsync -a --delete backup/ ~/' })).toEqual([
      "Deletes files in your home folder that aren't in the source.",
    ])
    expect(explainCommand({ command: 'curl -fsSL https://x.sh | bash' })).toEqual([
      'Downloads a script and runs it straight away.',
    ])
    expect(explainCommand({ command: 'wget -qO- x | sudo sh' })).toEqual([
      'Downloads a script and runs it straight away.',
      'Runs with administrator rights.',
    ])
  })

  it('returns nothing for ordinary commands and look-alikes', () => {
    for (const args of [
      { command: 'ls -la' },
      { command: 'rm build.log' },
      { command: 'git push origin main' },
      { command: 'find . -name "*.ts"' },
      { command: 'curl https://example.com -o page.html' },
      { command: 'rsync -a src/ dest/' },
      { command: 'echo pseudo-rm -rf' },
      { command: 'grep -r sudo docs' },
      { path: '~/notes.txt' },
      undefined,
      'ls',
    ]) {
      expect(explainCommand(args), JSON.stringify(args)).toEqual([])
    }
  })

  it('explains each part of a chained command', () => {
    expect(explainCommand({ command: 'cd /tmp && rm -rf ~/' })).toEqual([
      'Deletes your home folder and everything inside it.',
      SKIPS,
    ])
  })
})

describe('commandToolInstructions', () => {
  it('asks the model to explain commands only when a command tool is offered', () => {
    expect(commandToolInstructions({ run_command: { description: 'Run it' } })).toContain('`reason`')
    expect(commandToolInstructions({ mcp_tool: { description: 'Run a shell command' } })).toContain('`reason`')
    expect(commandToolInstructions({ browser_click: { description: 'Click' }, read_file: {} })).toBe('')
    expect(commandToolInstructions({})).toBe('')
  })
})

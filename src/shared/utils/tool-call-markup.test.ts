import { describe, expect, it } from 'vitest'
import { hasToolCallMarkup, hideToolCallMarkup } from './tool-call-markup'

describe('hideToolCallMarkup', () => {
  it('hides a tool call written as text and keeps the rest of the answer', () => {
    const text = 'Let me check.\n<tool_call>\n{"name": "Bash", "arguments": {"command": "ls ~"}}\n</tool_call>\nDone.'
    expect(hideToolCallMarkup(text)).toBe('Let me check.\n\nDone.')
    expect(hasToolCallMarkup(text)).toBe(true)
  })

  it('hides function_calls and invoke blocks, and namespaced tags', () => {
    const invoke =
      'Sure.\n<function_calls>\n<invoke name="Bash">\n<parameter name="command">ls /tmp</parameter>\n</invoke>\n</function_calls>'
    expect(hideToolCallMarkup(invoke)).toBe('Sure.')
    expect(hideToolCallMarkup('<invoke name="read">x</invoke> after')).toBe('after')
    expect(hideToolCallMarkup('A <minimax:tool_call>{"name":"x"}</minimax:tool_call> B')).toBe('A  B')
  })

  it('hides a tool call cut off mid-stream', () => {
    expect(hideToolCallMarkup('Checking now.\n<tool_call>\n{"name": "Ba')).toBe('Checking now.')
  })

  it('leaves tags inside code fences and inline code alone', () => {
    const fenced = 'The format is:\n```xml\n<tool_call>{"name":"x"}</tool_call>\n```'
    expect(hideToolCallMarkup(fenced)).toBe(fenced)
    expect(hasToolCallMarkup(fenced)).toBe(false)
    const inline = 'Wrap it in `<tool_call>` tags.'
    expect(hideToolCallMarkup(inline)).toBe(inline)
  })

  it('leaves ordinary answers unchanged', () => {
    const text = 'Use a <div> here, and call invoke() later.'
    expect(hideToolCallMarkup(text)).toBe(text)
    expect(hasToolCallMarkup(text)).toBe(false)
  })
})

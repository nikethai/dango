/**
 * Some models write a tool call into the answer as text (`<tool_call>…`, `<function_calls><invoke …>`) instead of
 * calling the tool, for example when tool use is off. That markup is never answer text: it is hidden, and nothing runs.
 */

/** Code fences (closed or cut off) and inline code: tags inside them are shown as written. */
const CODE_SPANS = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/
/** A tool-call block, namespaced or not, up to its closing tag or, when cut off mid-stream, the end of the text. */
const TOOL_CALL_BLOCK = /<((?:[\w-]+:)?(?:function_calls|tool_calls?|invoke))\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi

function stripOutsideCode(text: string): { text: string; hidden: boolean } {
  let hidden = false
  const parts = text.split(CODE_SPANS).map((part, i) => {
    // split with one capture group: odd indexes are the code spans.
    if (i % 2 === 1) return part
    return part.replace(TOOL_CALL_BLOCK, () => {
      hidden = true
      return ''
    })
  })
  if (!hidden) return { text, hidden }
  return {
    text: parts
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    hidden,
  }
}

/** The answer without tool-call markup written as text; unchanged when there is none. */
export function hideToolCallMarkup(text: string): string {
  return stripOutsideCode(text).text
}

/** Whether the answer holds tool-call markup written as text (outside code). */
export function hasToolCallMarkup(text: string): boolean {
  return stripOutsideCode(text).hidden
}

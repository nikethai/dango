// @vitest-environment jsdom
import { htmlToText } from './gmail-normalize'

describe('htmlToText with DOMParser', () => {
  it('decodes entities, keeps line breaks and drops quotes and styles', () => {
    expect(typeof DOMParser).toBe('function')
    const text = htmlToText(
      '<style>p{color:red}</style><p>Chào anh,</p><p>Ngày ra mắt &amp; giá?<br>Cảm ơn</p><div class="gmail_quote">Old</div>'
    )
    expect(text).toBe('Chào anh,\nNgày ra mắt & giá?\nCảm ơn')
  })
})

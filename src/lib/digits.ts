export const englishDigits = (value: string | number) => String(value).replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) - (digit < '۰' ? 0x0660 : 0x06f0)))

/** Normalize display text only, including saved audit messages and portalled UI. */
export function normalizeDisplayedDigits(root: HTMLElement) {
  const normalize = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement
      if (!parent || parent.closest('script, style, textarea, [contenteditable]')) return
      const text = node.nodeValue ?? ''
      const formatted = englishDigits(text)
      if (text !== formatted) node.nodeValue = formatted
      return
    }
    if (!(node instanceof Element) || node.matches('script, style, textarea, [contenteditable]')) return
    for (const child of node.childNodes) normalize(child)
  }
  normalize(root)
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') normalize(record.target)
      else for (const node of record.addedNodes) normalize(node)
    }
  })
  observer.observe(root, { subtree: true, childList: true, characterData: true })
}

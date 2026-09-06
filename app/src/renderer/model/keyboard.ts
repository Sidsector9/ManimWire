// Single-letter shortcuts must not fire while the user is typing. Mirrors the check
// in @xyflow/system's isInputDOMNode, which the React package does not re-export.

const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

/** Whether a key event came from somewhere text is being entered. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING_TAGS.has(target.tagName) || target.hasAttribute('contenteditable')
}

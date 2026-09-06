// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isTyping } from './keyboard'

describe('isTyping', () => {
  const element = (html: string): HTMLElement => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild as HTMLElement
  }

  it('is true for the places text is entered', () => {
    expect(isTyping(element('<input />'))).toBe(true)
    expect(isTyping(element('<textarea></textarea>'))).toBe(true)
    expect(isTyping(element('<select></select>'))).toBe(true)
    expect(isTyping(element('<div contenteditable="true"></div>'))).toBe(true)
  })

  it('is false for the canvas, a button, and a missing target', () => {
    expect(isTyping(element('<div class="graph"></div>'))).toBe(false)
    expect(isTyping(element('<button>Play</button>'))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixInput, NumberInput, NumberListInput } from './inputs'

describe('number editors', () => {
  afterEach(cleanup)

  it('keeps a half-typed number as draft text and commits only finite values', () => {
    const onChange = vi.fn()
    render(<NumberInput value={2} onChange={onChange} />)
    const input = screen.getByDisplayValue('2')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-' } })
    expect(onChange).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('-')
    fireEvent.change(input, { target: { value: '-3' } })
    expect(onChange).toHaveBeenLastCalledWith(-3)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('commits a number list on Enter or blur, never while typing', () => {
    const onChange = vi.fn()
    render(<NumberListInput value={[-3, 3, 1]} onChange={onChange} />)
    const input = screen.getByDisplayValue('-3, 3, 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.change(input, { target: { value: '4, 8' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith([4, 8])
    fireEvent.change(input, { target: { value: '4, x' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('matrix editor', () => {
  afterEach(cleanup)

  it('reads and writes rows separated by semicolons', () => {
    const onChange = vi.fn()
    render(<MatrixInput value={[[1, 1], [0, 1]]} onChange={onChange} />)
    const input = screen.getByDisplayValue('1, 1; 0, 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '2, 0; 0, 2' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith([[2, 0], [0, 2]])
  })

  it('refuses rows of different lengths and anything that is not a number', () => {
    const onChange = vi.fn()
    render(<MatrixInput value={[[1, 1], [0, 1]]} onChange={onChange} />)
    const input = screen.getByDisplayValue('1, 1; 0, 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1, 1; 0' } })
    fireEvent.blur(input)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1, x; 0, 1' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    // Emptying the field clears the value, as the other editors do.
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

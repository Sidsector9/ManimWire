// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ColorPicker } from './editors'

vi.mock('../store/catalogue', () => ({
  selectColors: vi.fn(),
  useCatalogueStore: () => [{ name: 'RED', hex: '#ff0000' }, { name: 'BLUE', hex: '#0000ff' }, { name: 'BLUE_A', hex: '#abcdef' }]
}))
afterEach(cleanup)

it('filters color names case insensitively and selects the first match with Enter', () => {
  const onChange = vi.fn()
  render(<ColorPicker value="RED" placeholder="" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button'))
  const search = screen.getByRole('combobox')
  fireEvent.change(search, { target: { value: 'blue' } })
  expect(screen.queryByRole('option', { name: 'RED' })).toBeNull()
  expect(screen.getByRole('option', { name: 'BLUE_A' })).toBeTruthy()
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onChange).toHaveBeenLastCalledWith('BLUE')
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('accepts custom hex colors and can restore the default', () => {
  const onChange = vi.fn()
  render(<ColorPicker value="RED" placeholder="None" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '#aabbcc' } })
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(onChange).toHaveBeenLastCalledWith('#AABBCC')
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('option', { name: 'Default (None)' }))
  expect(onChange).toHaveBeenLastCalledWith(undefined)
})

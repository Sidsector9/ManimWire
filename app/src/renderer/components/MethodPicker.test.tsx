// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MethodPicker } from './MethodPicker'

afterEach(cleanup)
const methods = ['set_fill', 'set_stroke', 'shift']

it('searches readable method names and returns the exact method identifier', () => {
  const onSelect = vi.fn()
  render(<MethodPicker methods={methods} onSelect={onSelect} />)
  const trigger = screen.getByRole('button')
  fireEvent.click(trigger)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SET FILL' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(onSelect).toHaveBeenCalledWith('set_fill')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('handles empty results, keyboard navigation, dismissal, and reopening', () => {
  const onSelect = vi.fn()
  render(<MethodPicker methods={methods} onSelect={onSelect} />)
  fireEvent.click(screen.getByRole('button'))
  const search = screen.getByRole('combobox')
  fireEvent.change(search, { target: { value: 'missing' } })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onSelect).not.toHaveBeenCalled()
  expect(search.hasAttribute('aria-activedescendant')).toBe(false)
  expect(screen.getByRole('status').textContent).toBe('No matching methods.')
  fireEvent.change(search, { target: { value: 'set' } })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onSelect).toHaveBeenCalledWith('set_stroke')
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getAllByRole('option')).toHaveLength(3)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(onSelect).toHaveBeenCalledTimes(1)
})

it('supports mouse selection and closing outside the popover', () => {
  const onSelect = vi.fn()
  render(<MethodPicker methods={methods} onSelect={onSelect} />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('option', { name: 'shift' }))
  expect(onSelect).toHaveBeenCalledWith('shift')
  fireEvent.click(screen.getByRole('button'))
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('combobox')).toBeNull()
})

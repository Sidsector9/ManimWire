// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { FrameResult } from '../../shared/engine'
import { RawFrame } from './RawFrame'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('rejects old graphs and coalesces transfers without starving playback', async () => {
  const pending: Array<(value: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))))
  const putImageData = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  })
  const frame: FrameResult = { path: '/old', stream: 'old-graph', format: 'rgba', width: 1, height: 1, time: 0, bounds: [] }
  const onExpired = vi.fn()
  const view = render(<RawFrame frame={frame} onExpired={onExpired} />)
  view.rerender(<RawFrame frame={{ ...frame, stream: 'new-graph', path: '/new' }} onExpired={onExpired} />)
  expect(pending).toHaveLength(1)
  await act(async () => pending[0]!(new Response(new Uint8Array([0, 0, 255, 255]))))
  expect(putImageData).not.toHaveBeenCalled()
  await act(async () => pending[1]!(new Response(new Uint8Array([255, 0, 0, 255]))))
  expect(putImageData).toHaveBeenCalledTimes(1)
  expect(Array.from(putImageData.mock.calls[0]![0].data)).toEqual([255, 0, 0, 255])
  expect(view.getByRole('img').dataset['frame']).toBe('/new')
  expect(onExpired).not.toHaveBeenCalled()
  for (const path of ['/three', '/four', '/five']) {
    view.rerender(<RawFrame frame={{ ...frame, stream: 'new-graph', path }} onExpired={onExpired} />)
  }
  expect(pending).toHaveLength(3)
  await act(async () => pending[2]!(new Response(new Uint8Array([0, 255, 0, 255]))))
  expect(view.getByRole('img').dataset['frame']).toBe('/three')
  expect(pending).toHaveLength(4)
  await act(async () => pending[3]!(new Response(new Uint8Array([255, 255, 0, 255]))))
  expect(view.getByRole('img').dataset['frame']).toBe('/five')
})

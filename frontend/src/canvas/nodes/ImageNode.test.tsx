import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { ImageNode } from '@/canvas/nodes/ImageNode'
import type { AppNode, ImageData } from '@/canvas/types'
import { ImagesContext, Uploads, type ImagesHost } from '@/canvas/uploads'

const nodeTypes = { image: ImageNode }

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // xyflow reads the zoom off a matrix once a node is measured; jsdom has none.
  window.DOMMatrixReadOnly ??= class {
    m22 = 1
  } as unknown as typeof DOMMatrixReadOnly
})

function show(data: ImageData, host: Partial<ImagesHost> = {}) {
  const node: AppNode = {
    id: 'pic',
    type: 'image',
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    data,
  }
  const value: ImagesHost = { source: { boardId: 'b1' }, uploads: null, ...host }
  const { container } = render(
    <ReactFlowProvider>
      <ImagesContext.Provider value={value}>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow
            nodes={[node]}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          />
        </div>
      </ImagesContext.Provider>
    </ReactFlowProvider>,
  )
  return container
}

const PICTURE = { w: 3840, h: 2880, color: '#c82828' }

test('a stored picture loads the copy its size on screen needs and shows once loaded', () => {
  const container = show({ ...PICTURE, file: 'f'.repeat(32) })
  const img = container.querySelector('img')!
  expect(img.getAttribute('src')).toBe(`/api/boards/b1/files/${'f'.repeat(32)}?w=512`)
  expect(img.className).toContain('opacity-0')
  fireEvent.load(img)
  expect(container.querySelector('img')!.className).not.toContain('opacity-0')
})

test('a guest reads pictures through the public link', () => {
  const container = show({ ...PICTURE, file: 'a'.repeat(32) }, { source: { token: 'tok' } })
  expect(container.querySelector('img')?.getAttribute('src')).toMatch(
    /^\/api\/public\/tok\/files\//,
  )
})

test('others see the picture uploading in its own colour and size', () => {
  const container = show({ ...PICTURE, since: new Date().toISOString() })
  expect(screen.getByText('Uploading…')).toBeTruthy()
  expect(container.querySelector('img')).toBeNull()
})

test('a failed upload says why and retries', async () => {
  URL.createObjectURL = () => 'blob:1'
  URL.revokeObjectURL = vi.fn()
  const send = vi.fn().mockRejectedValueOnce(new Error('No room for more pictures'))
  const uploads = new Uploads(send, vi.fn())
  uploads.add('pic', new Blob(['x']), PICTURE)
  show(PICTURE, { uploads })
  expect(await screen.findByText('No room for more pictures')).toBeTruthy()
  send.mockResolvedValue('f'.repeat(32))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(send).toHaveBeenCalledTimes(2)
})

test('a GIF plays when it is large on screen and shows a still copy when small', () => {
  const big = show({ w: 400, h: 300, color: '#000000', moving: true, file: 'b'.repeat(32) })
  expect(big.querySelector('img')?.getAttribute('src')).toMatch(/\?move=1$/)
})

test('a small GIF shows a still copy', () => {
  const node: AppNode = {
    id: 'pic',
    type: 'image',
    position: { x: 0, y: 0 },
    width: 100,
    height: 75,
    data: { w: 400, h: 300, color: '#000000', moving: true, file: 'c'.repeat(32) },
  }
  const { container } = render(
    <ReactFlowProvider>
      <ImagesContext.Provider value={{ source: { boardId: 'b1' }, uploads: null }}>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow
            nodes={[node]}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          />
        </div>
      </ImagesContext.Provider>
    </ReactFlowProvider>,
  )
  expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\?w=512$/)
})

test('an upload that never finished offers to pick the file again', () => {
  const again = vi.fn()
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  show({ ...PICTURE, since }, { again })
  expect(screen.queryByText('Uploading…')).toBeNull()
  expect(screen.getByText('Upload did not finish')).toBeTruthy()
  const picked = new File(['png'], 'shot.png', { type: 'image/png' })
  fireEvent.change(screen.getByTestId('image-picker'), { target: { files: [picked] } })
  expect(again).toHaveBeenCalledWith('pic', picked)
})

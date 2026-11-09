import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { FileSource } from '@/api/files'
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
  HTMLImageElement.prototype.decode ??= () => Promise.resolve()
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

test('a stored picture loads the copy its size on screen needs and shows once loaded', async () => {
  const container = show({ ...PICTURE, file: 'f'.repeat(32) })
  const img = container.querySelector('img')!
  expect(img.getAttribute('src')).toBe(`/api/boards/b1/files/${'f'.repeat(32)}?w=512`)
  expect(img.className).toContain('opacity-0')
  fireEvent.load(img)
  await waitFor(() => expect(container.querySelector('img')!.className).not.toContain('opacity-0'))
})

test('a loaded copy shows only once it is decoded, so the picture does not blink', async () => {
  const container = show({ ...PICTURE, file: 'd'.repeat(32) })
  const img = container.querySelector('img')!
  let decoded = () => {}
  img.decode = () => new Promise<void>((resolve) => (decoded = resolve))
  fireEvent.load(img)
  await Promise.resolve()
  expect(img.className).toContain('opacity-0')
  await act(async () => decoded())
  expect(img.className).not.toContain('opacity-0')
})

test('the local copy of a pasted picture stays on screen until the stored one is decoded', async () => {
  URL.createObjectURL = () => 'blob:local'
  URL.revokeObjectURL = vi.fn()
  const uploads = new Uploads(() => new Promise(() => {}), vi.fn())
  uploads.add('pic', new Blob(['x']), PICTURE)
  const container = show({ ...PICTURE, file: 'e'.repeat(32) }, { uploads })
  const visible = () =>
    [...container.querySelectorAll('img')]
      .filter((img) => !img.className.includes('opacity-0'))
      .map((img) => img.getAttribute('src'))
  const stored = container.querySelector<HTMLImageElement>('img[src^="/api/"]')!
  let decoded = () => {}
  stored.decode = () => new Promise<void>((resolve) => (decoded = resolve))
  expect(visible()).toEqual(['blob:local'])
  fireEvent.load(stored)
  await Promise.resolve()
  expect(visible()).toEqual(['blob:local'])
  await act(async () => decoded())
  expect(visible()).toEqual([stored.getAttribute('src')])
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
    width: 60,
    height: 45,
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

test('a built-in sticker is drawn by its code, for a guest through the link', () => {
  const node: AppNode = {
    id: 'sticker',
    type: 'image',
    position: { x: 0, y: 0 },
    width: 160,
    height: 160,
    data: { w: 256, h: 256, color: '#f5c542', moving: true, sticker: '1f525' },
  }
  const shown = (source: FileSource) => {
    const { container, unmount } = render(
      <ReactFlowProvider>
        <ImagesContext.Provider value={{ source, uploads: null }}>
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
    const src = container.querySelector('img')?.getAttribute('src')
    const uploading = container.textContent?.includes('Uploading')
    unmount()
    return { src, uploading }
  }
  expect(shown({ boardId: 'b1' })).toEqual({
    src: '/api/stickers/1f525/picture?w=256&move=1',
    uploading: false,
  })
  expect(shown({ token: 't1' }).src).toBe('/api/public/t1/stickers/1f525/picture?w=256&move=1')
})

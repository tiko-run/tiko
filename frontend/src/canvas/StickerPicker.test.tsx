import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { StickerPicker } from '@/canvas/StickerPicker'

const STICKERS = [
  { code: '1f600', name: 'smile', tags: [], category: 'Smileys and emotions' },
  { code: '1f525', name: 'fire', tags: ['lit'], category: 'Smileys and emotions' },
  { code: '1f40c', name: 'snail', tags: [], category: 'Animals and nature' },
]
const LOGO = {
  id: 'p1',
  name: 'Logo',
  file: { id: 'f1', width: 400, height: 300, color: '#3b82f6', moving: false },
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function serve(pack: unknown[] = []) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const body =
      url === '/api/stickers'
        ? { stickers: STICKERS }
        : url === '/api/stickers/pack' && !init?.method
          ? { stickers: pack }
          : null
    return Promise.resolve(new Response(body ? JSON.stringify(body) : null, { status: 200 }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function renderPicker(onPick = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StickerPicker open onOpenChange={vi.fn()} onPick={onPick} />
    </QueryClientProvider>,
  )
  return onPick
}

test('opens on smileys, shows a section and finds a sticker by a tag', async () => {
  serve()
  renderPicker()
  expect(await screen.findByRole('button', { name: 'fire' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'snail' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Animals and nature' }))
  expect(screen.getByRole('button', { name: 'snail' })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search stickers' }), {
    target: { value: 'LIT' },
  })
  expect(screen.getByRole('button', { name: 'fire' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'smile' })).toBeNull()
  expect(screen.queryByRole('tablist')).toBeNull()
})

test('a picked sticker goes on the board and to the recent ones', async () => {
  serve()
  const onPick = renderPicker()
  fireEvent.click(await screen.findByRole('button', { name: 'fire' }))
  expect(onPick).toHaveBeenCalledWith({ code: '1f525' })
  fireEvent.click(screen.getByRole('tab', { name: 'Recent' }))
  expect(screen.getByRole('button', { name: 'fire' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'smile' })).toBeNull()
})

test('the workspace tab tells how to fill an empty pack', async () => {
  serve()
  renderPicker()
  fireEvent.click(await screen.findByRole('tab', { name: 'Workspace' }))
  expect(await screen.findByText(/Save to stickers/)).toBeTruthy()
})

test('a sticker of the pack is picked or removed', async () => {
  const fetch = serve([LOGO])
  const onPick = renderPicker()
  fireEvent.click(await screen.findByRole('tab', { name: 'Workspace' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Logo' }))
  expect(onPick).toHaveBeenCalledWith({ pack: LOGO })
  fireEvent.click(screen.getByRole('button', { name: "Remove Logo from the workspace's stickers" }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/stickers/pack/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

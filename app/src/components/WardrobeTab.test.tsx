import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WardrobeTab from './WardrobeTab'

vi.mock('./WardrobeDiary', () => ({ default: () => null }))

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WardrobeTab 现有衣橱展示与添加表单', () => {
  it('显示上装、下装及品类，选择下装时只改表单不提前 POST', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/wardrobe/items')
      expect(init?.method ?? 'GET').toBe('GET')
      return Promise.resolve(
        jsonResponse({
          items: [
            { id: 1, name: '测试白衬衫', category: 'top', color: '白色', price: 129 },
            { id: 2, name: '测试牛仔裤', category: 'bottom', color: '蓝色' },
          ],
          count: 2,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WardrobeTab />)

    expect(await screen.findByText('测试白衬衫')).toBeTruthy()
    expect(screen.getByText('测试牛仔裤')).toBeTruthy()
    expect(
      within(screen.getByText('测试白衬衫').closest('.glass-card')!).getByText('上装'),
    ).toBeTruthy()
    expect(
      within(screen.getByText('测试牛仔裤').closest('.glass-card')!).getByText('下装'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '+ 添加衣物' }))
    const categorySelect = within(
      screen.getByText('添加衣物').closest('.glass-card')!,
    ).getAllByRole('combobox')[0]
    fireEvent.change(categorySelect, { target: { value: 'bottom' } })

    expect((categorySelect as HTMLSelectElement).value).toBe('bottom')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('同源衣物图片只作为图片渲染，外部 URL 不显示为文本也不请求', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            items: [
              { id: 1, name: '拍照衬衫', category: 'top', image_url: '/uploads/shirt.png' },
              {
                id: 2,
                name: '外链衣物',
                category: 'top',
                image_url: 'https://outside.test/shirt.png',
              },
            ],
            count: 2,
          }),
        ),
      ),
    )
    render(<WardrobeTab />)

    const image = await screen.findByRole('img', { name: '拍照衬衫' })
    expect(image.getAttribute('src')).toBe('/uploads/shirt.png')
    expect(image.parentElement?.textContent).not.toContain('/uploads/shirt.png')
    expect(image.parentElement?.textContent).not.toContain('https://outside.test/shirt.png')
    expect(screen.queryByRole('img', { name: '外链衣物' })).toBeNull()
  })
})

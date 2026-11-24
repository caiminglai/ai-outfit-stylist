import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessoryTab from '../components/AccessoryTab'
import CosmeticTab from '../components/CosmeticTab'
import InventoryCard from '../components/InventoryCard'
import WardrobeTab from '../components/WardrobeTab'
import type { InventoryProduct } from '../types'

type CabinetCase = {
  name: string
  endpoint: string
  emptyText: string
  addButton: string
  item: { id: number; name: string; category: string }
  latestItem: { id: number; name: string; category: string }
  Component: () => React.JSX.Element
}

const CABINETS: CabinetCase[] = [
  {
    name: '衣橱',
    endpoint: '/api/wardrobe/items',
    emptyText: '暂无衣物，点击上方按钮添加',
    addButton: '+ 添加衣物',
    item: { id: 1, name: '测试风衣', category: 'outerwear' },
    latestItem: { id: 4, name: '重试期间添加的新长裤', category: 'bottom' },
    Component: () => <WardrobeTab />,
  },
  {
    name: '配饰柜',
    endpoint: '/api/accessory/items',
    emptyText: '暂无配饰，点击上方按钮添加',
    addButton: '+ 添加配饰',
    item: { id: 2, name: '测试耳饰', category: 'earring' },
    latestItem: { id: 5, name: '重试期间添加的新耳饰', category: 'earring' },
    Component: () => <AccessoryTab />,
  },
  {
    name: '化妆品柜',
    endpoint: '/api/cosmetic/items',
    emptyText: '暂无化妆品，点击上方按钮添加',
    addButton: '+ 添加化妆品',
    item: { id: 3, name: '测试口红', category: 'lipstick' },
    latestItem: { id: 6, name: '重试期间添加的新口红', category: 'lipstick' },
    Component: () => <CosmeticTab />,
  },
]

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubCabinetFetch(endpoint: string, respond: () => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === endpoint) return respond()
    if (url === '/api/wardrobe/outfits') {
      return Promise.resolve(jsonResponse({ outfits: [], occasions: [], weather_levels: [] }))
    }
    return Promise.reject(new Error(`测试里没有准备 ${url} 的响应`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type DeferredResponse = {
  promise: Promise<Response>
  resolve: (response: Response) => void
  reject: (reason: unknown) => void
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function addItemThroughForm(
  addButton: string,
  item: { id: number; name: string; category: string },
) {
  fireEvent.click(screen.getByRole('button', { name: addButton }))
  fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: item.name } })
  // 衣橱默认上装要求选版型；统一改成参数中的合法品类，避免把表单校验混进竞态测试。
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: item.category } })
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('style_ai_session', 'sess_cabinet_test')
  localStorage.setItem('style_ai_session_ts', String(Date.now()))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe.each(CABINETS.map((cabinet) => [cabinet.name, cabinet] as const))(
  '%s列表四态',
  (_name, { endpoint, emptyText, addButton, item, latestItem, Component }) => {
    it('请求未完成时显示加载态，成功后空列表才显示暂无数据', async () => {
      let finishRequest: ((response: Response) => void) | undefined
      stubCabinetFetch(
        endpoint,
        () =>
          new Promise<Response>((resolve) => {
            finishRequest = resolve
          }),
      )

      render(<Component />)
      expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
      expect(screen.queryByText(emptyText)).toBeNull()
      expect(screen.queryByText('加载失败')).toBeNull()

      finishRequest?.(jsonResponse({ items: [], count: 0 }))
      expect(await screen.findByText(emptyText)).toBeTruthy()
      expect(screen.queryByText('加载失败')).toBeNull()
    })

    it('API reject 显示加载失败而非空态，点击重试重新请求并恢复列表', async () => {
      let attempts = 0
      const fetchMock = stubCabinetFetch(endpoint, () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('测试网络断开'))
          : Promise.resolve(jsonResponse({ items: [item], count: 1 }))
      })

      render(<Component />)
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('加载失败')
      expect(screen.queryByText(emptyText)).toBeNull()

      fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
      expect(await screen.findByText(item.name)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(emptyText)).toBeNull()
      expect(fetchMock.mock.calls.filter(([input]) => String(input) === endpoint)).toHaveLength(2)
    })

    it('重试与新增刷新并发时，后完成的旧重试不得覆盖最新列表', async () => {
      const listRequests: DeferredResponse[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === endpoint) {
            if (init?.method === 'POST') return Promise.resolve(jsonResponse(item))
            const request = deferredResponse()
            listRequests.push(request)
            return request.promise
          }
          if (url === '/api/wardrobe/outfits') {
            return Promise.resolve(jsonResponse({ outfits: [], occasions: [], weather_levels: [] }))
          }
          return Promise.reject(new Error(`测试里没有准备 ${url} 的响应`))
        }),
      )

      render(<Component />)
      await act(async () => {
        listRequests[0].reject(new Error('首次加载失败'))
      })
      fireEvent.click(
        within(await screen.findByRole('alert')).getByRole('button', { name: '重试' }),
      )
      await addItemThroughForm(addButton, latestItem)
      await waitFor(() => expect(listRequests).toHaveLength(3))
      expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()

      // 新增后的第三次刷新先返回，它必须成为唯一可信的列表代次。
      await act(async () => {
        listRequests[2].resolve(jsonResponse({ items: [latestItem], count: 1 }))
      })
      expect(await screen.findByText(latestItem.name)).toBeTruthy()

      // 重试请求随后返回旧快照，不能把刚添加的物品重新抹掉。
      await act(async () => {
        listRequests[1].resolve(jsonResponse({ items: [item], count: 1 }))
      })
      expect(screen.getByText(latestItem.name)).toBeTruthy()
      expect(screen.queryByText(item.name)).toBeNull()
    })

    it('最新列表仍 pending 时，旧重试失败不得提前结束加载或显示错误', async () => {
      const listRequests: DeferredResponse[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === endpoint) {
            if (init?.method === 'POST') return Promise.resolve(jsonResponse(item))
            const request = deferredResponse()
            listRequests.push(request)
            return request.promise
          }
          if (url === '/api/wardrobe/outfits') {
            return Promise.resolve(jsonResponse({ outfits: [], occasions: [], weather_levels: [] }))
          }
          return Promise.reject(new Error(`测试里没有准备 ${url} 的响应`))
        }),
      )

      render(<Component />)
      await act(async () => {
        listRequests[0].reject(new Error('首次加载失败'))
      })
      fireEvent.click(
        within(await screen.findByRole('alert')).getByRole('button', { name: '重试' }),
      )
      await addItemThroughForm(addButton, latestItem)
      await waitFor(() => expect(listRequests).toHaveLength(3))

      // 旧重试先失败：catch/finally 都不能影响仍挂起的第三次刷新。
      await act(async () => {
        listRequests[1].reject(new Error('旧重试失败'))
      })
      expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()

      await act(async () => {
        listRequests[2].resolve(jsonResponse({ items: [latestItem], count: 1 }))
      })
      expect(await screen.findByText(latestItem.name)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  },
)

describe('InventoryCard 图片入口', () => {
  const product: InventoryProduct = {
    id: 10,
    category_code: 'top',
    category_name: '上装',
    name: '测试库存商品',
    stock: 1,
  }

  it('同源相对路径经过 helper 后正常显示', () => {
    render(<InventoryCard product={{ ...product, image_url: '/uploads/item.jpg' }} />)
    expect(screen.getByRole('img', { name: product.name }).getAttribute('src')).toBe(
      '/uploads/item.jpg',
    )
  })

  it('反斜杠外部地址不渲染 img，也不伪装成有图', () => {
    render(<InventoryCard product={{ ...product, image_url: '/\\evil.example/x.png' }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('📦')).toBeTruthy()
  })
})

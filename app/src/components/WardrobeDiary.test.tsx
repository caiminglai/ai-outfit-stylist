import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WardrobeOutfit } from '../types'
import type { OutfitListResult } from '../api'

const api = vi.hoisted(() => ({
  listWardrobeOutfits: vi.fn(),
  createWardrobeOutfit: vi.fn(),
  updateWardrobeOutfit: vi.fn(),
  deleteWardrobeOutfit: vi.fn(),
  getWeatherProfile: vi.fn(),
}))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }))
vi.mock('../api', () => api)
vi.mock('../utils/toastOnce', () => ({ toast }))

import WardrobeDiary from './WardrobeDiary'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function outfit(name: string, rating: number): WardrobeOutfit {
  return {
    id: 1,
    name,
    item_ids: [10],
    rating,
    items: [],
    score: 80,
    color_score: 80,
    occasion_score: 80,
    reason: '测试搭配',
  }
}

function response(name: string, rating: number, occasion = '通勤'): OutfitListResult {
  return {
    outfits: [outfit(name, rating)],
    count: 1,
    occasions: [occasion],
    weather_levels: ['冷'],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.updateWardrobeOutfit.mockResolvedValue(outfit('saved', 2))
})
afterEach(() => cleanup())

async function favorite() {
  fireEvent.click(screen.getAllByRole('button', { name: '设为常用' })[0])
  await act(async () => {})
}

describe('WardrobeDiary 重载竞态', () => {
  it('新重载先返回时，旧重载不能覆盖行、场合词表或结束最新加载', async () => {
    const initial = deferred<OutfitListResult>()
    const older = deferred<OutfitListResult>()
    const newest = deferred<OutfitListResult>()
    api.listWardrobeOutfits
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newest.promise)
    render(<WardrobeDiary items={[{ id: 10, name: '衬衫', category: 'top' }]} />)
    await act(async () => initial.resolve(response('初始', 1)))

    await favorite()
    await favorite()
    expect(api.listWardrobeOutfits).toHaveBeenCalledTimes(3)

    await act(async () => newest.resolve(response('最新', 3, '约会')))
    expect(screen.getByText('最新')).toBeTruthy()
    await act(async () => older.resolve(response('过期', 2, '旧场合')))
    expect(screen.getByText('最新')).toBeTruthy()
    expect(screen.queryByText('过期')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ 记一笔' }))
    expect(screen.getByRole('option', { name: '约会' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '旧场合' })).toBeNull()
  })

  it('旧重载失败不显示过期错误，也不影响新结果', async () => {
    const initial = deferred<OutfitListResult>()
    const older = deferred<OutfitListResult>()
    const newest = deferred<OutfitListResult>()
    api.listWardrobeOutfits
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newest.promise)
    render(<WardrobeDiary items={[]} />)
    await act(async () => initial.resolve(response('初始', 1)))
    await favorite()
    await favorite()

    await act(async () => newest.resolve(response('最新', 3)))
    await act(async () => older.reject(new Error('过期请求失败')))
    expect(screen.getByText('最新')).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

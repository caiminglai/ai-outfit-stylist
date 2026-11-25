import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TryonResult } from '../../types'

const api = vi.hoisted(() => ({ directTryon: vi.fn() }))
vi.mock('../../api', () => api)

import TryonCard from './TryonCard'

const result: TryonResult = {
  result_url: '/result.png',
  category: 'top',
  person_image: '/person.png',
  garment_image: '/garment.png',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function inputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
}

async function chooseImages() {
  const [person, garment] = inputs()
  fireEvent.change(person, {
    target: { files: [new File(['person'], 'person.png', { type: 'image/png' })] },
  })
  fireEvent.change(garment, {
    target: { files: [new File(['garment'], 'garment.png', { type: 'image/png' })] },
  })
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('TryonCard 请求与输入一致性', () => {
  it('上传前说明私有保存、外部调用条件与删除保留', () => {
    render(<TryonCard />)
    const notice = screen.getByText(/人物与衣服图片会私有保存/)
    expect(notice.textContent).toContain('仅部署启用外部试穿时')
    expect(notice.textContent).toContain('支付凭证、已付费报告及其复读依据保留')
    expect(notice.textContent).toContain('清理失败可重试')
  })

  it('生成期间锁定两张照片和类别输入', async () => {
    api.directTryon.mockReturnValue(deferred<TryonResult>().promise)
    render(<TryonCard />)
    await chooseImages()
    fireEvent.click(screen.getByRole('button', { name: '✨ 生成试穿效果' }))

    expect(inputs().every((input) => input.disabled)).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('输入被强制改变时作废旧响应，不展示与当前输入不一致的结果', async () => {
    const request = deferred<TryonResult>()
    api.directTryon.mockReturnValue(request.promise)
    render(<TryonCard />)
    await chooseImages()
    fireEvent.click(screen.getByRole('button', { name: '✨ 生成试穿效果' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dress' } })

    await act(async () => request.resolve(result))
    expect(screen.queryByRole('img', { name: '虚拟试穿结果' })).toBeNull()
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false)
    expect(
      (screen.getByRole('button', { name: '✨ 生成试穿效果' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('旧请求迟到完成时不能覆盖后发请求的结果', async () => {
    const oldRequest = deferred<TryonResult>()
    const newRequest = deferred<TryonResult>()
    api.directTryon.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    render(<TryonCard />)
    await chooseImages()
    const generate = screen.getByRole('button', { name: '✨ 生成试穿效果' })
    fireEvent.click(generate)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dress' } })
    fireEvent.click(generate)

    const newResult = { ...result, result_url: '/new-result.png', category: 'dress' }
    await act(async () => newRequest.resolve(newResult))
    expect(screen.getByRole('img', { name: '虚拟试穿结果' }).getAttribute('src')).toBe(
      '/new-result.png',
    )

    await act(async () => oldRequest.resolve(result))
    expect(screen.getByRole('img', { name: '虚拟试穿结果' }).getAttribute('src')).toBe(
      '/new-result.png',
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('组件卸载后迟到响应不再更新结果', async () => {
    const request = deferred<TryonResult>()
    api.directTryon.mockReturnValue(request.promise)
    const { unmount } = render(<TryonCard />)
    await chooseImages()
    fireEvent.click(screen.getByRole('button', { name: '✨ 生成试穿效果' }))
    unmount()

    await act(async () => request.resolve(result))
    expect(screen.queryByRole('img', { name: '虚拟试穿结果' })).toBeNull()
  })

  it('已有结果在输入改变后立即撤销，下一次生成使用新输入', async () => {
    api.directTryon.mockResolvedValue(result)
    render(<TryonCard />)
    await chooseImages()
    fireEvent.click(screen.getByRole('button', { name: '✨ 生成试穿效果' }))
    expect(await screen.findByRole('img', { name: '虚拟试穿结果' })).toBeTruthy()

    fireEvent.change(inputs()[0], {
      target: { files: [new File(['new'], 'new.png', { type: 'image/png' })] },
    })
    expect(screen.queryByRole('img', { name: '虚拟试穿结果' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '✨ 生成试穿效果' }))
    await screen.findByRole('img', { name: '虚拟试穿结果' })
    expect(api.directTryon.mock.calls[1][0].name).toBe('new.png')
  })
})

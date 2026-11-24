import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  ACCOUNT_CHANGE_EVENT: 'style-ai-account-change',
  deleteProfileArchive: vi.fn(),
  getAccount: vi.fn(),
  getProfileArchive: vi.fn(),
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  registerAccount: vi.fn(),
}))

vi.mock('../../api', () => api)
vi.mock('../../utils/toastOnce', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

import { AccountEntry } from './AccountEntry'
import { toast } from '../../utils/toastOnce'

beforeEach(() => {
  vi.clearAllMocks()
  api.getAccount.mockReturnValue({ phone: '13800138000', sessionId: 'acct_test' })
  api.getProfileArchive.mockResolvedValue({ fields: [], tags: [] })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AccountEntry 认证失效', () => {
  it('收到受保护请求的 401 事件后退出旧账号并打开重新登录面板', () => {
    render(<AccountEntry />)
    expect(screen.getByRole('button', { name: /已登录/ })).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: null, reason: 'unauthorized' },
        }),
      )
    })

    expect(screen.queryByRole('button', { name: /已登录/ })).toBeNull()
    expect(screen.getByPlaceholderText('手机号')).toBeTruthy()
    expect(toast).toHaveBeenCalledWith('登录已过期,请重新登录')
  })
})

describe('AccountEntry 账号档案隔离', () => {
  it('A 账号切到 B 账号时清空旧档案并读取 B 的档案', async () => {
    api.getProfileArchive
      .mockResolvedValueOnce({
        fields: [{ key: 'height', label: '身高', value: 'A 档案' }],
        tags: [],
      })
      .mockResolvedValueOnce({
        fields: [{ key: 'height', label: '身高', value: 'B 档案' }],
        tags: [],
      })
    render(<AccountEntry />)
    fireEvent.click(screen.getByRole('button', { name: /已登录/ }))
    expect(await screen.findByText('A 档案')).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: {
            account: { phone: '13900139000', sessionId: 'acct_BBBBBBBB' },
            reason: 'login',
          },
        }),
      )
    })

    expect(await screen.findByText('B 档案')).toBeTruthy()
    expect(screen.queryByText('A 档案')).toBeNull()
    expect(api.getProfileArchive).toHaveBeenCalledTimes(2)
  })

  it('A 账号的迟到档案响应不能覆盖已经切换到的 B 账号', async () => {
    let finishOld!: (value: {
      fields: Array<{ key: string; label: string; value: string }>
      tags: []
    }) => void
    api.getProfileArchive
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockResolvedValueOnce({
        fields: [{ key: 'height', label: '身高', value: 'B 档案' }],
        tags: [],
      })
    render(<AccountEntry />)
    fireEvent.click(screen.getByRole('button', { name: /已登录/ }))
    expect(api.getProfileArchive).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: {
            account: { phone: '13900139000', sessionId: 'acct_BBBBBBBB' },
            reason: 'login',
          },
        }),
      )
    })
    expect(await screen.findByText('B 档案')).toBeTruthy()

    await act(async () => {
      finishOld({ fields: [{ key: 'height', label: '身高', value: 'A 档案' }], tags: [] })
      await Promise.resolve()
    })
    expect(screen.getByText('B 档案')).toBeTruthy()
    expect(screen.queryByText('A 档案')).toBeNull()
  })
})

describe('AccountEntry 删除档案', () => {
  it('DELETE 还在等待时先通知上层取消草稿，成功后才清内存', async () => {
    let finishDelete:
      | ((value: {
          body: number
          face: number
          draft: number
          tags: number
          feedback: number
          logs: number
          records: number
          tryon: number
          photos: number
          files: number
          files_failed: number
        }) => void)
      | undefined
    api.deleteProfileArchive.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDelete = resolve
        }),
    )
    const onArchiveDeleteStart = vi.fn()
    const onArchiveCleared = vi.fn()
    render(
      <AccountEntry
        onArchiveDeleteStart={onArchiveDeleteStart}
        onArchiveCleared={onArchiveCleared}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /已登录/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除我的形象档案与记录' }))

    expect(api.deleteProfileArchive).toHaveBeenCalledTimes(1)
    expect(onArchiveDeleteStart).toHaveBeenCalledTimes(1)
    expect(onArchiveDeleteStart.mock.invocationCallOrder[0]).toBeLessThan(
      api.deleteProfileArchive.mock.invocationCallOrder[0],
    )
    expect(onArchiveCleared).not.toHaveBeenCalled()

    await act(async () => {
      finishDelete?.({
        body: 1,
        face: 0,
        draft: 1,
        tags: 0,
        feedback: 0,
        logs: 0,
        records: 0,
        tryon: 0,
        photos: 0,
        files: 0,
        files_failed: 0,
      })
      await Promise.resolve()
    })
    expect(onArchiveCleared).toHaveBeenCalledTimes(1)
  })
})

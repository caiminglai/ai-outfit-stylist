import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  ACCOUNT_CHANGE_EVENT: 'style-ai-account-change',
  claimPaidReport: vi.fn(),
  getAccount: vi.fn(),
  getPaymentEntitlement: vi.fn(),
}))

vi.mock('../api', () => api)
vi.mock('../utils/toastOnce', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./RecommendationReport', () => ({ default: () => <div>报告正文</div> }))

import PaidReports from './PaidReports'

function paymentInfo(left: number) {
  return {
    id: null,
    channel: null,
    amount: null,
    proof_url: null,
    status: null,
    admin_note: null,
    created_at: null,
    approved_at: null,
    entitlement: {
      granted: left,
      used: 0,
      left,
      paid_orders: 0,
      paid_amount: 0,
      pending_orders: 0,
      pending_amount: 0,
      closed_orders: 0,
      proof_approved: 0,
      proof_amount: 0,
      reports: [],
      claimable: [],
    },
    orders: [],
  }
}

function emitAccount(account: { phone: string; sessionId: string } | null) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
        detail: { account, reason: account ? 'login' : 'manual' },
      }),
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getAccount.mockReturnValue({ phone: '13800138000', sessionId: 'acct_AAAAAAAA' })
})

afterEach(() => cleanup())

describe('PaidReports 账号身份', () => {
  it('账号变化后清空旧身份读数并重新拉取，不把游客提示留在旧快照里', async () => {
    let finishGuest!: (value: ReturnType<typeof paymentInfo>) => void
    api.getPaymentEntitlement.mockResolvedValueOnce(paymentInfo(1)).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishGuest = resolve
        }),
    )

    render(<PaidReports onClose={() => {}} />)
    expect(await screen.findByText(/还能领 1 份/)).toBeTruthy()

    emitAccount(null)
    expect(screen.queryByText(/还能领 1 份/)).toBeNull()
    expect(screen.getByText('读取中…')).toBeTruthy()
    expect(api.getPaymentEntitlement).toHaveBeenCalledTimes(2)

    await act(async () => {
      finishGuest(paymentInfo(0))
      await Promise.resolve()
    })
    expect(await screen.findByText(/这份报告跟着当前浏览器/)).toBeTruthy()
  })

  it('旧账号的迟到读数不能覆盖新账号已经返回的数据', async () => {
    let finishOld!: (value: ReturnType<typeof paymentInfo>) => void
    let finishNew!: (value: ReturnType<typeof paymentInfo>) => void
    api.getPaymentEntitlement
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve
          }),
      )

    render(<PaidReports onClose={() => {}} />)
    emitAccount({ phone: '13900139000', sessionId: 'acct_BBBBBBBB' })

    await act(async () => {
      finishNew(paymentInfo(2))
      await Promise.resolve()
    })
    expect(await screen.findByText(/还能领 2 份/)).toBeTruthy()

    await act(async () => {
      finishOld(paymentInfo(9))
      await Promise.resolve()
    })
    expect(screen.getByText(/还能领 2 份/)).toBeTruthy()
    expect(screen.queryByText(/还能领 9 份/)).toBeNull()
  })
})

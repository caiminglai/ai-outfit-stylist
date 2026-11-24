import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerProfile, EngineRecommendation } from '../types'
import RecommendationReport from './RecommendationReport'

const api = vi.hoisted(() => ({
  deleteItemFeedback: vi.fn(),
  deleteRuleFeedback: vi.fn(),
  getItemFeedback: vi.fn(),
  postItemFeedback: vi.fn(),
  postRuleFeedback: vi.fn(),
}))

vi.mock('../api', () => api)

const recommendation: EngineRecommendation = {
  穿搭: [
    {
      group_id: 101,
      group_name: '测试穿搭规则',
      priority: 80,
      score: 88,
      建议: '选择合身剪裁',
      explanation: {
        命中条件: ['性别为女', '场景为通勤'],
        匹配分: 88,
        优先级: 80,
        规则说明: '测试规则说明',
      },
    },
  ],
  妆容: [],
  发型: [],
  配饰: [],
  姿势: [],
}

const profile: CustomerProfile = {
  gender: '女',
  skin_tone: '暖皮',
  face_shape: '圆脸',
}

function renderReport(overrides: Partial<React.ComponentProps<typeof RecommendationReport>> = {}) {
  return render(
    <RecommendationReport
      recommendation={recommendation}
      profile={profile}
      mode="personal"
      {...overrides}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RecommendationReport 现有报告展示', () => {
  it('解释默认收起，点击展开命中条件，再点收起，且不写推荐或反馈请求', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderReport()

    expect(screen.queryByText('性别为女')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /💡 为什么推荐这个\?/ }))
    expect(screen.getByText('性别为女')).toBeTruthy()
    expect(screen.getByText('场景为通勤')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /💡 为什么推荐这个\?/ }))
    expect(screen.queryByText('性别为女')).toBeNull()

    expect(api.postRuleFeedback).not.toHaveBeenCalled()
    expect(api.postItemFeedback).not.toHaveBeenCalled()
    expect(api.deleteRuleFeedback).not.toHaveBeenCalled()
    expect(api.deleteItemFeedback).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('保留量到维度、缺测、隐私空值与色彩和肤色卡片条件', () => {
    const { rerender } = renderReport()

    expect(screen.getByText(/本次量到 3／10 维/).textContent).toContain(
      '（缺：肤色深浅、体型、体型细节、场景、场合、偏好风格、季节）',
    )
    expect(screen.queryByText(/🔒/)).toBeNull()
    expect(screen.queryByText('色彩季型')).toBeNull()
    expect(screen.queryByText('肤色五维（HBN）')).toBeNull()

    rerender(
      <RecommendationReport
        recommendation={recommendation}
        profile={{
          ...profile,
          season_type: {
            season: '春季',
            season_name: '暖春型',
            warmth: 'warm',
            depth: 'light',
            traits: '明快柔和',
            palette: [{ name: '珊瑚粉', hex: '#ff8888' }],
            avoid: [{ name: '冷灰色', hex: '#888888' }],
            confidence: 0.8,
            basis: '冷暖与深浅',
          },
          skin_five_dimensions: {
            black: 20,
            white: 70,
            yellow: 40,
            red: 30,
            cyan: 10,
            primary: '白',
          },
        }}
        mode="personal"
        privacyNotice="测试隐私声明"
      />,
    )

    expect(screen.getByText('色彩季型')).toBeTruthy()
    expect(screen.getByText('暖春型')).toBeTruthy()
    expect(screen.getByText('肤色五维（HBN）')).toBeTruthy()
    expect(screen.getByText('基于色相角与明度的五维倾向近似，非医学色度测量')).toBeTruthy()
    expect(screen.getByText('🔒 测试隐私声明')).toBeTruthy()
  })

  it('门店免费报告不展示算法分析，带付费回执时才展示', () => {
    const withAnalysis: EngineRecommendation = {
      ...recommendation,
      algorithm_analysis: { sections: [], metrics: [] },
    }
    const analysisHeading = '📐 身体数据与风格分析'
    const { rerender } = renderReport({ recommendation: withAnalysis, mode: 'store' })
    expect(screen.queryByText(analysisHeading)).toBeNull()

    rerender(
      <RecommendationReport
        recommendation={{
          ...withAnalysis,
          paid_report: {
            out_trade_no: 'TEST-RECEIPT',
            amount_fen: 1,
            channel: 'manual',
            paid_at: null,
            granted_at: '2026-11-24T00:00:00Z',
            report_no: 1,
            basis_log_id: 1,
            basis_input_at: null,
            mode: 'store',
            sections: ['B'],
          },
        }}
        profile={profile}
        mode="store"
      />,
    )
    expect(screen.getByText(analysisHeading)).toBeTruthy()
  })
})

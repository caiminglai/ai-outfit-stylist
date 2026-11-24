/**
 * 衣橱缺口／购物建议的规范化（11-03 拆分轮跟着 WardrobeTab.tsx 搬出来的那段）
 *
 * 为什么测：后端给这两个接口的形状换过一代（旧 gaps 用 category/reason，新用 type/message），
 * 前端这一层是唯一把两代形状捏成一个的地方。搬文件时最容易改坏的就是"缺字段兜什么值"，
 * 这里把兜底逐条钉住：兜错一次界面上就是一片 undefined 或英文码。
 */
import { describe, it, expect } from 'vitest'
import { normalizeGapResult, normalizeSuggestions, WARDROBE_GAP_TYPE_LABELS } from './normalize'

describe('normalizeGapResult', () => {
  it('新格式（type/message/suggestions）逐字段读进来', () => {
    const r = normalizeGapResult({
      gaps: [
        {
          type: 'season_gap',
          message: '夏天缺薄外套',
          priority: 'high',
          suggestions: ['亚麻衬衫'],
        },
      ],
      stats: { total: 12, by_category: { 上衣: 5 } },
    })
    expect(r?.gaps[0].type).toBe('season_gap')
    expect(r?.gaps[0].message).toBe('夏天缺薄外套')
    expect(r?.gaps[0].priority).toBe('high')
    expect(r?.gaps[0].suggestions).toEqual(['亚麻衬衫'])
    expect(r?.stats.total).toBe(12)
    expect(r?.stats.by_category['上衣']).toBe(5)
  })

  it('旧格式（category/reason）映射到同一形状，priority 缺省补 medium', () => {
    const r = normalizeGapResult({ gaps: [{ category: 'category_top', reason: '上衣只有 1 件' }] })
    expect(r?.gaps[0].type).toBe('category_top')
    expect(r?.gaps[0].message).toBe('上衣只有 1 件')
    expect(r?.gaps[0].priority).toBe('medium')
    expect(r?.gaps[0].suggestions).toEqual([])
  })

  it('stats 整个没给时补零与空表，不让界面读到 undefined', () => {
    const r = normalizeGapResult({ gaps: [] })
    expect(r?.stats).toEqual({ total: 0, by_category: {}, by_season: {}, by_style: {} })
  })

  it('null／非对象一律回 null（接口失败时前端走"没结果"这一支）', () => {
    expect(normalizeGapResult(null)).toBeNull()
    expect(normalizeGapResult('x' as unknown as Record<string, unknown>)).toBeNull()
  })

  it('季节与色彩这两类后端只给 type 不给 label，中文兜底名必须在表里', () => {
    expect(WARDROBE_GAP_TYPE_LABELS.season_gap).toBe('季节缺口')
    expect(WARDROBE_GAP_TYPE_LABELS.color_diversity).toBe('色彩多样性')
  })
})

describe('normalizeSuggestions', () => {
  it('非数组（后端报错返回对象）回空表，不抛', () => {
    expect(normalizeSuggestions(null)).toEqual([])
    expect(normalizeSuggestions({ name: 'x' })).toEqual([])
  })

  it('没有 name 时用 label 兜，两个都没就写「未知商品」', () => {
    expect(normalizeSuggestions([{ label: '白色T恤' }])[0].name).toBe('白色T恤')
    expect(normalizeSuggestions([{}])[0].name).toBe('未知商品')
  })
})

/**
 * 跨柜场合匹配面板
 * 包含 MatchResultCard / FullLookCard 组件和场合推荐的整体渲染
 */

import type { CrossCabinetRecommendation, CabinetMatchResult, FullLook } from '../types'
import TipList from './ui/TipList'

// ============================================================
// 数据规范化 —— 兼容后端旧格式返回
// ============================================================

/** 将旧格式（outfit/makeup/accessory 扁平数组）转为新格式 */
function normalizeData(raw: Record<string, unknown>): CrossCabinetRecommendation {
  // 如果已经是新格式（有 outfit_advice 字段），直接用
  if (raw.outfit_advice && raw.cosmetic_advice && raw.accessory_advice) {
    return raw as unknown as CrossCabinetRecommendation
  }

  // 旧格式兼容：outfit/makeup/accessory 是扁平数组
  const toAdvice = (items: unknown, style?: string): CabinetMatchResult => {
    const arr = Array.isArray(items) ? items : []
    return {
      style: style || '',
      matched: arr.map((item) => {
        const obj = item as Record<string, unknown>
        return { name: (obj.name as string) || '未命名', score: obj.score as number | undefined }
      }),
      missing: [],
      suggestion: arr.length > 0 ? '已匹配以下单品' : '暂无匹配单品',
    }
  }

  return {
    occasion: (raw.occasion as string) || '日常',
    occasion_style: (raw.occasion_style as string) || '',
    outfit_advice: toAdvice(raw.outfit, raw.occasion_style as string),
    cosmetic_advice: toAdvice(raw.makeup),
    accessory_advice: toAdvice(raw.accessory),
    cross_tips: Array.isArray(raw.cross_tips) ? (raw.cross_tips as string[]) : [],
    summary: {
      wardrobe_count: (raw.summary as Record<string, number>)?.wardrobe_count ?? 0,
      cosmetic_count: (raw.summary as Record<string, number>)?.cosmetic_count ?? 0,
      accessory_count: (raw.summary as Record<string, number>)?.accessory_count ?? 0,
    },
  }
}

// ============================================================
// 匹配结果卡片
// ============================================================

/** 匹配项 */
interface MatchedItem {
  name: string
  score?: number
  reasons?: string[]
}

/** 匹配结果卡片 props */
interface MatchResultCardProps {
  /** 图标 */
  icon: string
  /** 标题 */
  title: string
  /** 风格标签 */
  style?: string
  /** 已匹配项列表 */
  matched: MatchedItem[]
  /** 缺失项列表 */
  missing: string[]
  /** 建议文本 */
  suggestion: string
}

/** 匹配结果卡片：展示已匹配/缺失/建议 */
export function MatchResultCard({
  icon,
  title,
  style,
  matched,
  missing,
  suggestion,
}: MatchResultCardProps) {
  return (
    <div className="glass-card p-3 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span
          className="section-title"
          style={{ marginBottom: 0, borderLeft: 'none', paddingLeft: 0 }}
        >
          {title}
        </span>
        {style && (
          <span
            className="pill-tag"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            {style}
          </span>
        )}
      </div>

      {/* 已匹配 */}
      {matched.length > 0 && (
        <div className="mb-2">
          <span style={{ color: 'var(--good)', fontSize: 11, fontWeight: 600 }}>
            已匹配 ({matched.length})
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {matched.map((m, i) => (
              // 🔴 10-22 X6（依据/22 §七 闸门）：「得分依据」原来只有 hover 才出字，
              // 触屏读不到 ⇒ 药丸本身改成点一下摊开（⛔ 依据内容一个字不删，只是换个取法）
              <details key={i} className="inline-block">
                <summary
                  className="pill-tag"
                  style={{
                    color: 'var(--good)',
                    borderColor: 'var(--good)',
                    cursor: 'pointer',
                    listStyle: 'none',
                  }}
                  title={m.reasons?.length ? `得分依据：${m.reasons.join('、')}` : undefined}
                >
                  {m.name}
                  {m.score != null && (
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>{m.score}%</span>
                  )}
                </summary>
                {!!m.reasons?.length && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginTop: 2,
                      maxWidth: '320px',
                      lineHeight: 1.5,
                    }}
                  >
                    得分依据：{m.reasons.join('、')}
                  </div>
                )}
              </details>
            ))}
          </div>
          {!!matched[0]?.reasons?.length && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {matched[0].name} 排第一：{matched[0].reasons!.join('、')}
            </div>
          )}
        </div>
      )}

      {/* 缺失 */}
      {missing.length > 0 && (
        <div className="mb-2">
          <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 600 }}>
            缺失 ({missing.length})
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {missing.map((m, i) => (
              <span
                key={i}
                className="pill-tag"
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 建议 */}
      {suggestion && (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>建议：</span>
          {suggestion}
        </div>
      )}
    </div>
  )
}

// ============================================================
// 完整一套卡片
// ============================================================

/** 完整一套卡片 props */
interface FullLookCardProps {
  /** 三柜拼出来的一套 */
  look: FullLook
}

/** 今天这身：衣服 + 妆容 + 配饰拼成一套，缺哪一类直接点名 */
function FullLookCard({ look }: FullLookCardProps) {
  return (
    <div className="glass-card p-3 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: 16 }}>🧩</span>
        <span
          className="section-title"
          style={{ marginBottom: 0, borderLeft: 'none', paddingLeft: 0 }}
        >
          今天这身
        </span>
        <span
          className="pill-tag"
          style={{
            color: look.complete ? 'var(--good)' : 'var(--warning)',
            borderColor: look.complete ? 'var(--good)' : 'var(--warning)',
          }}
        >
          {look.pieces.length} 件 · {look.complete ? '已凑齐' : '还没凑齐'}
        </span>
      </div>

      {look.pieces.length > 0 && (
        <div className="flex flex-col gap-2">
          {look.pieces.map((p, i) => (
            <div key={i}>
              <div className="flex items-center gap-2" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', minWidth: 48 }}>{p.slot}</span>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {!!p.category && (
                  <span className="pill-tag" style={{ color: 'var(--muted)' }}>
                    {p.category}
                  </span>
                )}
                {p.score != null && (
                  <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 600 }}>
                    {p.score}%
                  </span>
                )}
              </div>
              {!!p.why?.length && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, paddingLeft: 56 }}>
                  {p.why.join('、')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {look.missing_parts.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          style={{ marginTop: look.pieces.length > 0 ? 8 : 0 }}
        >
          {look.missing_parts.map((m, i) => (
            <span
              key={i}
              className="pill-tag"
              style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
            >
              缺 {m}
            </span>
          ))}
        </div>
      )}

      {look.note && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
          {look.note}
        </div>
      )}
    </div>
  )
}

// ============================================================
// 场合推荐面板
// ============================================================

/** 场合推荐面板 props */
interface CrossCabinetMatchProps {
  /** 跨柜推荐数据 */
  crossData: CrossCabinetRecommendation
}

/** 场合推荐面板：三柜搭配卡片 + 跨柜建议 + 底部统计 */
export default function CrossCabinetMatch({ crossData }: CrossCabinetMatchProps) {
  // 规范化数据，兼容旧格式
  const data = normalizeData(crossData as unknown as Record<string, unknown>)

  const outfit = data.outfit_advice ?? { style: '', matched: [], missing: [], suggestion: '' }
  const cosmetic = data.cosmetic_advice ?? { style: '', matched: [], missing: [], suggestion: '' }
  const accessory = data.accessory_advice ?? { style: '', matched: [], missing: [], suggestion: '' }
  const summary = data.summary ?? { wardrobe_count: 0, cosmetic_count: 0, accessory_count: 0 }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* 场合标题 */}
      <div className="flex items-center gap-2">
        <span className="section-title" style={{ marginBottom: 0 }}>
          🎯
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>
          {data.occasion}
        </span>
        {data.occasion_style && (
          <span
            className="pill-tag"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            {data.occasion_style}
          </span>
        )}
      </div>

      {/* 今天这身：三柜拼成的一套，先给结论再给各柜明细 */}
      {data.full_look && <FullLookCard look={data.full_look} />}

      {/* 档案沿用说明：这些项这次没填，是从长期档案里拿的 */}
      {!!data.archive?.used_fields?.length && (
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          本次沿用了你档案里的：{data.archive.used_fields.join('、')}
        </div>
      )}

      {/* 衣橱搭配 */}
      <MatchResultCard
        icon="👗"
        title="衣橱搭配"
        style={outfit.style}
        matched={outfit.matched ?? []}
        missing={outfit.missing ?? []}
        suggestion={outfit.suggestion ?? ''}
      />

      {/* 妆容搭配 */}
      <MatchResultCard
        icon="💄"
        title="妆容搭配"
        style={cosmetic.style}
        matched={cosmetic.matched ?? []}
        missing={cosmetic.missing ?? []}
        suggestion={cosmetic.suggestion ?? ''}
      />

      {/* 配饰搭配 */}
      <MatchResultCard
        icon="💎"
        title="配饰搭配"
        style={accessory.style}
        matched={accessory.matched ?? []}
        missing={accessory.missing ?? []}
        suggestion={accessory.suggestion ?? ''}
      />

      {/* 跨柜协调建议 */}
      <TipList tips={data.cross_tips ?? []} title="💡 跨柜协调建议" />

      {/* 底部统计 */}
      <div className="glass-card p-3 flex items-center justify-around animate-fade-in">
        <div className="text-center">
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
            {summary.wardrobe_count}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>👗 衣橱</div>
        </div>
        <div className="text-center">
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-2)' }}>
            {summary.cosmetic_count}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>💄 化妆品</div>
        </div>
        <div className="text-center">
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>
            {summary.accessory_count}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>💎 配饰</div>
        </div>
      </div>
    </div>
  )
}

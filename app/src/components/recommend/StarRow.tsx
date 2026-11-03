// 11-03 大文件拆分轮：这一段从 RecommendationReport.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：RecommendationReport.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import type { StarKind } from './starLabels'
import { STAR_LABELS } from './starLabels'

/**
 * 一行五星。点同一颗最高的星＝取消这一把（送 null 清空，不是送 0——0 会被后端拦成 400）。
 * ⛔ 不用 <input type=range>：星级是离散的五档，滑条在手机上会给出"3.4 星"这种后端不收的值。
 */
export function StarRow({
  kind,
  value,
  busy,
  onPick,
}: {
  kind: StarKind
  value: number | null
  busy: boolean
  onPick: (v: number | null) => void
}) {
  const shown = value ?? 0
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
      <span>{STAR_LABELS[kind].label}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={busy}
          className="star-btn"
          title={
            n === shown ? `再点一下取消这${STAR_LABELS[kind].label}的星` : STAR_LABELS[kind].note
          }
          onClick={() => onPick(n === shown ? null : n)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0 1px',
            fontSize: '14px',
            lineHeight: 1,
            cursor: busy ? 'default' : 'pointer',
            color: n <= shown ? 'var(--accent)' : 'var(--line)',
          }}
        >
          {n <= shown ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}

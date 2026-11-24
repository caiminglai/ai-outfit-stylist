/**
 * 依据档位标签：这条建议是"哪一级的依据"撑起来的（组件本体）。
 *
 * 档位词表 `META`、归档函数 `pick`，以及给不能挂组件的地方用的 `evidenceLabel`／`isQuantifiable`，
 * 11-03 第 4 项起搬到同目录的 `evidenceMeta.ts`——`react-refresh/only-export-components` 不许
 * 一个组件文件同时导出常量与工具函数（原文 "Fast refresh only works when a file only exports
 * components"），拆的过程逐字未改，措辞红线那段说明也跟着过去了。
 *
 * 唯一实现处在后端 backend/services/evidenceLevels.js，这里只做展示；⛔ 在本文件里再加一份档位表。
 */

import { META, pick, type EvidenceLevel, type EvidenceMeta } from './evidenceMeta'

interface EvidenceTagProps {
  level: EvidenceLevel
  /** true 时把完整说明也显示出来（默认只做徽章 + title） */
  withNote?: boolean
}

export default function EvidenceTag({ level, withNote = false }: EvidenceTagProps) {
  const key = pick(level)
  const meta = META[key]
  if (withNote) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: '1.5' }}>
        <span style={{ color: meta.color }}>依据：{meta.short}</span>
        <span> —— {meta.note}</span>
      </div>
    )
  }
  return <ExpandableTag meta={meta} short={meta.short} />
}

/**
 * 默认那枚药丸：点一下把完整说明摊开（原来只有 `title=`，手机长按不弹、触屏压根读不到）。
 * 用原生 details/summary ⇒ 零依赖、零 JS 状态，键盘也能展开。
 */
function ExpandableTag({ meta, short }: { meta: EvidenceMeta; short: string }) {
  return (
    <details className="inline-block">
      <summary
        className="pill-tag"
        style={{
          color: meta.color,
          borderColor: meta.color,
          fontSize: '11px',
          cursor: 'pointer',
          listStyle: 'none',
        }}
        title={meta.note}
      >
        依据：{short}
      </summary>
      <div
        className="text-[11px]"
        style={{ color: 'var(--muted)', lineHeight: '1.5', maxWidth: '340px', marginTop: '4px' }}
      >
        {meta.note}
      </div>
    </details>
  )
}

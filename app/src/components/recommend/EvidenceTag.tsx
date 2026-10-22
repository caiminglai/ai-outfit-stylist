/**
 * 依据档位标签：这条建议是"哪一级的依据"撑起来的。
 *
 * 唯一实现处在后端 backend/services/evidenceLevels.js，这里只做展示；
 * 改档位定义要两边一起改（后端下发 /api/rules/schema 时也带同一份）。
 *
 * 措辞红线：只有 A/B 两档可以对顾客说"科学依据/可量化"；
 * C 是行业体系经验，D 是命理，展示时必须与 A/B 分开，不许混成"科学"。
 *
 * 🔴 10-22 第十四阶段·第一步 X6（`docs/依据/22` §七）：裸字母档（"依据 A · 国标/国际标准"）
 * 是内部术语，直接甩在顾客脸上读不出任何意思 ⇒ 对外只说这一级**凭什么**：
 * A＝有国标原文、B＝有实证文献、C＝行业内通行但无公开检验、D＝命理体系（⛔ 不是"我们手拍的"，
 * 那一档在本仓的语义是八字五行，写成手拍是错的 ⇒ 与规范 §七 那句映射的差异已记进 §十二 自我订正）。
 * 同时把只剩 hover 才看得到的完整说明改成**点一下也看得到**（触屏没有 hover）。
 * 数值与出处（GB/T 号、文献名）一个字没删，⛔ 为了干净删证据链。
 */

export type EvidenceLevel = 'A' | 'B' | 'C' | 'D' | null | undefined

interface EvidenceMeta {
  /** 徽章上的短标签 */
  short: string
  /** tooltip / 展开区的完整说明 */
  note: string
  /** 前景与边框色，走主题变量 */
  color: string
}

const META: Record<'A' | 'B' | 'C' | 'D' | 'none', EvidenceMeta> = {
  A: {
    short: '有国标原文',
    note: '现行国家或国际标准里能对上的量化口径：色差公式 GB/T 7921-2008、人体测量方法 GB/T 16160-2017。这些标准只给尺寸与测量口径，都不含"好不好看"的判据',
    color: 'var(--good)',
  },
  B: {
    short: '有实证文献',
    note: '有同行评议论文与可复算公式（如 Schloss & Palmer 色相相似-和谐回归、WHO 腰臀比阈值、CIEDE2000 色差）',
    color: 'var(--accent)',
  },
  C: {
    short: '行业通行·无公开检验',
    note: '商业体系或教材经验规则：四季·十二型色彩、Kibbe 风格型、场合着装、体型五分类。可当风格偏好，不是客观规律',
    color: 'var(--warning)',
  },
  D: {
    short: '命理体系',
    note: '八字五行喜用神推出来的颜色/材质，属另一套体系，与上面的量化依据不同源',
    color: 'var(--muted)',
  },
  none: {
    short: '没标依据等级',
    note: '这条没标依据档位，按行业体系（C）对待',
    color: 'var(--muted)',
  },
}

function pick(level: EvidenceLevel): keyof typeof META {
  if (level === 'A' || level === 'B' || level === 'C' || level === 'D') return level
  return 'none'
}

/**
 * 给不能挂组件的地方用（如 `TopSpecCard` 那行"依据档位：A"）：只回中文短标签。
 * 参数放宽到 `string`：`top_spec` 那边出账类型写的是 `tier: string`（`types/index.ts:209/396/444`），
 * 认不出的词由 `pick` 归到"没标依据等级"，⛔ 不许为此改后端出账的类型。
 * 内部代码里仍然按 A/B/C/D 传值，⛔ 不改后端出账的字母。
 */
export function evidenceLabel(level: EvidenceLevel | string): string {
  return META[pick(level as EvidenceLevel)].short
}

/** 只有 A/B 够称"有科学/量化依据"，其他档位不许用这两个词 */
export function isQuantifiable(level: EvidenceLevel): boolean {
  return level === 'A' || level === 'B'
}

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

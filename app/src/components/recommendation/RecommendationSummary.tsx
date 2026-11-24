import type { CustomerProfile } from '../../types'

export interface RecommendationSummaryProps {
  profile: CustomerProfile
  mode: 'store' | 'personal'
  privacyNotice?: string
}

/**
 * 摘要卡那排药丸读的就是这 10 个字段（10-22 第十四阶段·第一步 X5 起，它们同时是诚实读数
 * 「本次量到 N／M 维」的**分母来源**——M 恒等于这张表的长度，⛔ 不是新算的维度、⛔ 不是算法里的权重）。
 * label 只用于"缺哪几维"这句话，措辞抄自 `PersonalProfileForm` 各分区与字段标题；
 * ⛔ 不参与任何计算，也不与后端 `profileArchive.js` 的档案标签混用（那是另一张表、另一个口径）。
 */
const SUMMARY_FIELDS = [
  { key: 'gender', label: '性别' },
  { key: 'skin_tone', label: '肤色冷暖' },
  { key: 'skin_tone_detail', label: '肤色深浅' },
  { key: 'face_shape', label: '脸型' },
  { key: 'body_type', label: '体型' },
  { key: 'body_type_detail', label: '体型细节' },
  { key: 'scenario', label: '场景' },
  { key: 'occasion', label: '场合' },
  { key: 'preferred_style', label: '偏好风格' },
  { key: 'season', label: '季节' },
] as const

export function RecommendationSummary({
  profile,
  mode,
  privacyNotice,
}: RecommendationSummaryProps) {
  const filledDims = SUMMARY_FIELDS.filter((f) => Boolean(profile[f.key]))
  const missingDims = SUMMARY_FIELDS.filter((f) => !profile[f.key])

  return (
    <>
      {/* 顾客档案摘要 */}
      <div className="glass-card p-3" style={{ borderColor: 'var(--accent)' }}>
        <div
          className="flex items-center justify-between mb-2 pb-2"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            形象建议报告
          </h2>
          <span
            className="pill-tag"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            {mode === 'store' ? '🏪 门店推荐' : '📱 个人深度分析'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUMMARY_FIELDS.map(
            (f) =>
              profile[f.key] && (
                <span key={f.key} className="pill-tag">
                  {profile[f.key]}
                </span>
              ),
          )}
        </div>
        {/* 四大身材标准·部位级标签（椰子胸/沙漏腰/母贝臀/酒杯腿） */}
        {profile.body_highlights && profile.body_highlights.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              身材优势部位
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.body_highlights.map((h) => (
                <span
                  key={h}
                  className="pill-tag"
                  style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                  title={profile.body_highlights_details?.[h]?.label}
                >
                  ✨ {h}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* 🔴 10-22 第十四阶段·第一步 X5（`docs/依据/22` §六）：把"这次到底算到几维"当面说清。
            改前顾客只填性别就能拿到满 8 条，可报告里到处是「没量到 ⇒ 没计入」「六格只量到 2 格」
            这类缺席说明 ⇒ 感受是"我什么都没填它说我没填"。硬规矩 2 的引申是**缺测要明说、不是拦着不出分**，
            所以这里只补读数、⛔ 不加门槛、⛔ 不编默认值。 */}
        <div className="text-[11px] mt-2" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          本次量到 {filledDims.length}／{SUMMARY_FIELDS.length} 维
          {missingDims.length > 0 && `（缺：${missingDims.map((f) => f.label).join('、')}）`}
          {missingDims.length > 0 && '——缺的那几维不算分、也不用猜，下面的建议只按量到的这些出。'}
          {missingDims.length === 0 && '——这 10 维全量到了。'}
        </div>
        {/* 🔴 10-22 第十四阶段·第一步 X8（`docs/依据/22` §九）：这句以前只在接口返回里、屏幕上一个字都没露。
            原样显示后端给的那一行，⛔ 空值时不许渲染成"未知"或补一句承诺。 */}
        {privacyNotice && (
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            🔒 {privacyNotice}
          </div>
        )}
      </div>

      {/* 四季色彩季型卡（后端 seasonColor.getSeasonType 输出；冷暖+深浅两轴都拿到才出） */}
      {profile.season_type && (
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              色彩季型
            </h2>
            <span
              className="pill-tag"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              {profile.season_type.season_name}
            </span>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--text)' }}>
            {profile.season_type.traits}
          </p>
          <div className="mb-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              推荐配色
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.season_type.palette.map((c, i) => (
                <div key={i} className="flex items-center gap-1" title={c.name}>
                  <span
                    className="inline-block w-4 h-4 rounded-full border"
                    style={{ backgroundColor: c.hex || '#ccc', borderColor: 'var(--line)' }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mb-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              尽量避开
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.season_type.avoid.map((c, i) => (
                <div key={i} className="flex items-center gap-1" title={c.name}>
                  <span
                    className="inline-block w-4 h-4 rounded-full border"
                    style={{ backgroundColor: c.hex || '#ccc', borderColor: 'var(--line)' }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            判据：{profile.season_type.basis}
            {profile.season_type.confidence < 0.9 && '（部分维度来自档名兜底，仅供参考）'}
          </div>
        </div>
      )}

      {/* 五维肤色框架（借鉴 HBN 蓝皮书：黑/黄/红/白/青） */}
      {profile.skin_five_dimensions && (
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              肤色五维（HBN）
            </h2>
            <span
              className="pill-tag"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              主：{profile.skin_five_dimensions.primary}
            </span>
          </div>
          <div className="space-y-1.5">
            {(['black', 'white', 'yellow', 'red', 'cyan'] as const).map((dim) => {
              const labels: Record<string, string> = {
                black: '黑',
                white: '白',
                yellow: '黄',
                red: '红',
                cyan: '青',
              }
              const val = profile.skin_five_dimensions![dim]
              return (
                <div key={dim} className="flex items-center gap-2">
                  <span className="text-xs w-8" style={{ color: 'var(--muted)' }}>
                    {labels[dim]}
                  </span>
                  <div className="flex-1 h-2 rounded" style={{ backgroundColor: 'var(--bg-soft)' }}>
                    <div
                      className="h-2 rounded"
                      style={{ width: `${val}%`, backgroundColor: 'var(--accent)' }}
                    />
                  </div>
                  <span className="text-xs w-8 text-right" style={{ color: 'var(--muted)' }}>
                    {val}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
            基于色相角与明度的五维倾向近似，非医学色度测量
          </div>
        </div>
      )}
    </>
  )
}

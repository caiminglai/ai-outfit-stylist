/**
 * 上衣处方卡：只按这个人的身材与肤色说"上衣该选成什么样"
 * ============================================================
 * 数据来自后端 services/topFromBody.js（随 /recommend 一起返回的 top_spec 键）。
 * 这一张卡刻意不读衣橱、不做缺口分析、不给购物建议——它只回答"该穿成什么样"。
 *
 * 10-09 定案的三层顺序（口径见 docs/依据/09-合身层输入输出规范.md）：
 *   第 0 层 合身（尺寸：号型 + 四道部位判据）→ 第 1 层 修形（显不显瘦那一类）→ 第 2 层 颜色。
 * ⚠️ 第 0 层与第 1 层的结论允许互相反对（"你该买 88A"和"松量往这收"是两件事），
 *    这里分两段显示，不做成同一个分数、也不做加权平均。
 * 合身层缺身高/净胸围时后端只发 blocking + measure_guide，前端必须把这一段显示出来，
 * 不许显示空白判据，也不许写"建议咨询专业人士"。
 */
import type { TopSpec, TopSpecAxis, TopSpecFit, TopSpecFitCheck } from '../../types'
// 10-22 第十四阶段·第一步 X6：档位一律说成"凭什么"（有国标原文／有实证文献／…），
// ⛔ 再把内部字母档 A/B/C/D 直接印给顾客。真身映射仍在这一份里（evidenceLevels.js 出字母）。
import { evidenceLabel } from './evidenceMeta'

/** 方向标记：松量那一轴给的是区间，不谈加减 */
function sideChip(axis: TopSpecAxis): string {
  if (axis.side === 'window') return '区间'
  if (axis.side === 0) return '不推拉'
  return axis.side > 0 ? '往这加' : '往这收'
}

const muted: React.CSSProperties = { fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 }
const rowLabel: React.CSSProperties = { fontSize: '13px' }

/**
 * 后端那批字符串是给 Markdown 文字报告写的（`**加粗**`、`` `表名` ``），
 * 卡片是纯文本渲染 ⇒ 显示前去掉这些符号，不然顾客看到的就是星号。
 * 只动呈现，不动一个字的口径。
 */
function plain(s?: string | null): string {
  if (!s) return ''
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1')
}

/**
 * 色片上的文字取黑还是白。
 * 之前只认 '#ffffff' 和 '#F5EFE0' 两个写死值判深色字,而 colorMetrics 的调色板里
 * 米白 #F2EDE3、雪粉 #F6D7DA、鹅黄 #F5E1A4、浅灰 #D3D6D8…一片浅色都漏判 ⇒ 白字压白底,
 * 上衣颜色那一行等于看不见。改成按感知亮度现算,浅底一律深色字。
 */
function chipTextColor(hex?: string): string {
  const h = (hex || '').trim().replace('#', '')
  if (h.length !== 6 && h.length !== 3) return '#fff'
  const full =
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return '#fff'
  // ITU-R BT.601 感知亮度,0~255;>150 视作浅底
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.6 ? '#333' : '#fff'
}

/** 目标值里的数组写成 90~95，单值直接跟单位 */
function targetText(target: TopSpecFitCheck['target']): string {
  if (!target) return ''
  return Object.entries(target)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('~') : v}`)
    .join('、')
}

function FitCheckRow({ c }: { c: TopSpecFitCheck }) {
  const ok = c.verdict === '可给目标值'
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={rowLabel}>{c.name_cn}</strong>
        <span
          className="badge"
          style={{
            fontSize: '11px',
            background: ok ? 'rgba(120,200,140,0.18)' : 'rgba(255,255,255,0.08)',
            color: ok ? 'var(--green, #58b368)' : 'var(--muted)',
          }}
          title={`依据：${evidenceLabel(c.tier)}`}
        >
          {c.verdict}
        </span>
        {ok && targetText(c.target) ? (
          <span style={{ fontSize: '13px' }}>{targetText(c.target)}</span>
        ) : null}
      </div>
      <div style={{ ...muted, marginLeft: '8px' }}>{plain(c.why)}</div>
      {c.missing_input && (
        <div style={{ ...muted, marginLeft: '8px', color: 'var(--orange, #d98b2b)' }}>
          要判这一道还缺：{plain(c.missing_input)}
        </div>
      )}
      <div style={{ ...muted, marginLeft: '8px' }}>依据：{evidenceLabel(c.tier)}</div>
    </div>
  )
}

function FitBlock({ fit }: { fit: TopSpecFit }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 6px' }}>
        第 0 层 · 合身（尺寸）
      </div>

      {fit.present ? (
        <>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '15px' }}>{fit.size_label}</strong>
            {fit.size?.体型中文 ? (
              <span className="badge badge-accent" style={{ fontSize: '11px' }}>
                {fit.size.体型}型 · {fit.size.体型中文}
              </span>
            ) : null}
            {fit.size_scope === 'near' ? (
              // 🔴 10-22 X6（依据/22 §七 闸门）：原来这句只有 `title=`，手机触屏压根读不到
              // 后端那条 note（号型超出哪个档系、按哪几档就近换算）⇒ 改成点一下也摊得开的展开项，
              // ⛔ 出处与数值一个不删，只是从 hover 挪到"点一下"。
              <details className="inline-block">
                <summary
                  style={{
                    ...muted,
                    color: 'var(--orange, #d98b2b)',
                    cursor: 'pointer',
                    listStyle: 'none',
                    fontSize: '11px',
                  }}
                  title={plain(fit.size_scope_note)}
                >
                  超出常用档系，就近换算
                </summary>
                <div style={{ ...muted, marginTop: '4px', maxWidth: '360px' }}>
                  {plain(fit.size_scope_note)}
                </div>
              </details>
            ) : null}
          </div>
          <div style={{ ...muted, margin: '4px 0 8px' }}>
            号＝身高就近 5cm 一档，型＝净胸围就近 4cm 一档，体型按胸腰差分 Y/A/B/C
            {fit.drop_cm != null ? `（你的胸腰差 ${fit.drop_cm}cm）` : ''}。
            {fit.drop_reason ? `体型位没出：${plain(fit.drop_reason)}` : ''}
            {fit.bmi_band ? (
              <>
                <br />
                胖瘦程度是另一条轴：BMI {fit.bmi} ⇒ {fit.bmi_band.cn}
                {/* 🔴 10-22 X6：这一档的国标出处与阈值原来只塞在 `title=` 里（触屏读不到），
                    而外面那句硬编码括号就是它的一句话摘要 ⇒ 直接把后端原文摊开，
                    ⛔ 不另外留一份会走样的短摘要（GB/T 31901-2024 与 2026-12-01 实施日期都在原文里）。 */}
                <details style={{ marginTop: '2px' }}>
                  <summary
                    style={{ cursor: 'pointer', color: 'var(--muted)', listStyle: 'none' }}
                    title={plain(fit.bmi_band_note)}
                  >
                    这一档凭什么（国标出处与阈值）
                  </summary>
                  <div style={{ ...muted, marginTop: '2px' }}>{plain(fit.bmi_band_note)}</div>
                </details>
              </>
            ) : null}
          </div>

          {fit.checks?.map((c) => (
            <FitCheckRow key={c.key} c={c} />
          ))}

          <div style={muted}>
            号型只管尺寸分档，本身不含"好不好看"的判据（GB/T 1335 就没写）；测量口径依据 GB/T
            16160-2017（腰围取腰际线）与 GB/T 5703-2023
            §6.2.7（肩宽取两肩峰点直线距离，家用软尺只当参考值），分档值与常用档系表列已对本机国标
            PDF 逐字核对。Y/A/B/C 后面的中文是我们的描述词，不是国标用词。
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '13px', marginBottom: '6px' }}>
            <strong>这一层先判不了——请量这两个数</strong>
          </div>
          {fit.blocking?.map((b) => (
            <div key={b} style={{ fontSize: '12px', lineHeight: 1.7, marginLeft: '8px' }}>
              · {plain(b)}
            </div>
          ))}
          <div style={{ fontSize: '12px', color: 'var(--muted)', margin: '8px 0 4px' }}>
            怎么量（GB/T 16160-2017 的口径，只讲方法、不讲多少算好看）：
          </div>
          {fit.measure_guide?.map((g) => (
            <div key={g} style={{ ...muted, marginLeft: '8px' }}>
              · {plain(g)}
            </div>
          ))}
          <div style={{ ...muted, marginTop: '6px' }}>{plain(fit.note)}</div>
        </>
      )}
    </div>
  )
}

export default function TopSpecCard({
  spec,
  skin,
}: {
  spec: TopSpec
  /**
   * 后端记下的肤色来源（`_computed.skin_source`，口径见 docs/依据/18 §2.4）。
   * ⛔ 只是拆账用的定性标注：不是置信度、不参与任何计算，缺了就不显示这一行。
   */
  skin?: {
    skin_source?: string | null
    skin_undertone?: string | null
    skin_hue?: number | null
  } | null
}) {
  if (!spec) return null
  const colour = spec.colour
  // 措辞照 18 §四：只说"按你照片里这块皮肤的颜色归到哪一档"，⛔ 不许写检测/识别/测出
  const skinLine =
    skin?.skin_source === 'photo_sample'
      ? `这一轮颜色用的冷暖＝按你照片里这块皮肤的颜色归到「${skin.skin_undertone}」（色相角 ${skin.skin_hue}°），深浅仍是你自己确认的那档`
      : skin?.skin_source === 'manual'
        ? '这一轮颜色用的肤色＝你在表单里选的那档'
        : null

  return (
    <div className="glass-card p-3 mt-3 animate-fade-in">
      <div className="section-title">📐 上衣该怎么选</div>
      <div
        style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6, marginBottom: '8px' }}
      >
        只看你的身材尺寸和肤色，不读你的衣橱，也不建议你买什么。 顺序是定的：
        <strong>先合身，再修形，最后颜色</strong>。前两层结论可以相反，那是两件事。
      </div>

      {spec.fit ? <FitBlock fit={spec.fit} /> : null}

      <div style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 6px' }}>
        第 1 层 · 修形（往哪修）
      </div>
      {spec.axes.map((axis) => (
        <div key={axis.key} style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={rowLabel}>{axis.name_cn}</strong>
            <span
              className="badge badge-accent"
              style={{ fontSize: '11px' }}
              title={`依据：${evidenceLabel(axis.tier)}`}
            >
              {sideChip(axis)}
            </span>
            <span style={{ fontSize: '13px' }}>{axis.label}</span>
          </div>
          {axis.prefer.length > 0 && (
            <div
              style={{ fontSize: '12px', lineHeight: 1.7, color: 'var(--text)', marginLeft: '8px' }}
            >
              要选：{axis.prefer.map(plain).join('；')}
            </div>
          )}
          {axis.avoid.length > 0 && (
            <div
              style={{
                fontSize: '12px',
                lineHeight: 1.7,
                color: 'var(--muted)',
                marginLeft: '8px',
              }}
            >
              要避：{axis.avoid.map(plain).join('；')}
            </div>
          )}
          {axis.based_on ? (
            <div style={{ ...muted, marginLeft: '8px' }}>
              算它用的实测数：{axis.based_on} ｜ 依据：{evidenceLabel(axis.tier)}
            </div>
          ) : (
            <div style={{ ...muted, marginLeft: '8px' }}>依据：{evidenceLabel(axis.tier)}</div>
          )}
          {axis.gated && (
            <div style={{ fontSize: '11px', color: 'var(--orange, #d98b2b)', marginLeft: '8px' }}>
              ⚠️ {plain(axis.gated)}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: '12px', color: 'var(--muted)', margin: '10px 0 6px' }}>
        第 2 层 · 颜色
      </div>
      {colour.present ? (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '13px', marginBottom: '6px' }}>
            <strong>上衣颜色</strong>（肤色口径 {colour.skin_label}
            {colour.anchor_count && colour.anchor_count > 1 ? '，两个口径取低分' : ''}）
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {colour.prefer?.map((c) => (
              <details key={c.hex + c.name} className="inline-block">
                <summary
                  title={`依据：${evidenceLabel(colour.tier)}\n色差 ${c.deltaE00}（越小越接近，0＝同色） ／ 色调相差 ${c.dHue}° ／ 明暗差 ${c.dL}${
                    c.limit_field ? `\n这一分的短板口径：${c.limit_field}` : ''
                  }`}
                  style={{
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: c.hex,
                    color: chipTextColor(c.hex),
                    cursor: 'pointer',
                    listStyle: 'none',
                  }}
                >
                  {c.name} {c.score}
                </summary>
                {/* 10-22 第十四阶段·第一步 X6：这几个数原来**只活在 `title=` 里**，
                    手机上长按不弹提示 ⇒ 顾客永远读不到"这个分怎么来的"。点色块下面就把同一份数摊开。 */}
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--muted)',
                    lineHeight: 1.6,
                    maxWidth: '320px',
                    marginTop: '4px',
                  }}
                >
                  色差 {c.deltaE00}（越小越接近，0＝同色）｜色调相差 {c.dHue}°｜明暗差 {c.dL}
                  ｜依据：{evidenceLabel(colour.tier)}
                  {c.limit_field && `｜这一分的短板口径：${c.limit_field}`}
                </div>
              </details>
            ))}
          </div>
          {colour.avoid && colour.avoid.length > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px' }}>
              跟你肤色最分不开的：{colour.avoid.map((c) => c.name).join('、')}
            </div>
          )}
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            {plain(colour.note)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
            依据：{evidenceLabel(colour.tier)}
          </div>
          {skinLine && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              {skinLine}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
          上衣颜色：没给建议（{plain(colour.reason)}）
        </div>
      )}

      {spec.missing.length > 0 && (
        <div
          style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.7, marginBottom: '8px' }}
        >
          这几维没给建议：
          {spec.missing.map((m) => `${m.name_cn}（${plain(m.reason)}）`).join('；')}
        </div>
      )}

      <div
        style={{
          fontSize: '11px',
          color: 'var(--muted)',
          lineHeight: 1.7,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingTop: '6px',
        }}
      >
        {plain(spec.note)}
      </div>
      <div style={{ ...muted, marginTop: '4px' }}>依据：{plain(spec.evidence)}</div>
    </div>
  )
}

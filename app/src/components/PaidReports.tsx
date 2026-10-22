/**
 * 我的报告（第十二阶段·第一步，`docs/依据/20` §三／§八）
 * ============================================================
 * 付费那一份「深度细账」的领取与查看入口（价格以后台设置为准，⛔ 不在这里写死数字，C2）。
 * 三条写死在这里的口径：
 *  1. **权益不是这里算的**。`granted/used/left` 全部来自后端按订单表现算（`services/paidReport.js`），
 *     这一层只显示。⛔ 不许在这里"看有几份就减几"——那是第二把尺子。
 *  2. **报告体复用既有渲染器**：Top 8 那段 DOM 由 `<RecommendationReport>` 画，
 *     本文件只补付费独有的三节（A 落选尾巴／D 参数与口径／E 回执）。
 *     ⛔ 复制一份 Top 8 的 DOM：两份渲染器必然漂，顾客看到的"付费那份"就和免费那份对不上了。
 *  3. **C 档手拍值不自称科学**：D 节末尾那句口径说明是后端 `note` 原文贴出来的，
 *     ⛔ 前端不改写、不美化、不删"标定中，未回归"那半句。
 *  4. 🔴 **第十四阶段·第一步 C1**：到账有两条来路（在线订单号 `?report=`／人工已核凭证 `?proof=`），
 *     共用同一个领取口；凭证那一路的键 `DEPOSIT-<id>` 是内部幂等键，⛔ 不许显示成"订单号"。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../utils/toastOnce'
import { claimPaidReport, getPaymentEntitlement, getAccount } from '../api'
import type { MyPaymentInfo, PaidReportPayload } from '../api'
import type { BeyondTopN, EngineRecommendation } from '../types'

const RecommendationReport = lazy(() => import('./RecommendationReport'))

/** 订单号只报后 6 位：整串是商户单号，没必要在屏幕上全文展示 */
function tail(no: string): string {
  const s = String(no || '')
  return s.length > 6 ? `…${s.slice(-6)}` : s
}

function money(v: number | null | undefined): string {
  const n = Number(v)
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : '—'
}

/**
 * 🔴 第十四阶段·第一步 C1：到账来路有三种，标签只有两种是"渠道"。
 * 原来这里写的是 `channel === 'alipay' ? '支付宝' : '微信'`——人工凭证那一路的 channel 是
 * `'manual'`，会被这句的 else 分支显示成「微信」，等于告诉顾客"你用微信付的"（假话）。
 */
function channelLabel(channel: string | undefined): string {
  if (channel === 'alipay') return '支付宝'
  if (channel === 'wechat') return '微信'
  if (channel === 'manual') return '人工确认到账'
  return '未标渠道'
}

/**
 * 库里的时间串是 UTC（SQLite `datetime('now')`），而 `paid_report` 这块回执后端只给了原始串、
 * 没给 `*_beijing` 兄弟字段 ⇒ 原来这一屏直接把 UTC 当本地时间显示，**顾客看到的到账时间早 8 小时**。
 * 正解＝在前端按 `Asia/Shanghai` 现转（与 `utils/beijingTime.js` 同一口径），认不出格式就原样回显，
 * ⛔ 兜 1970、⛔ 兜"今天"。
 */
function beijingOf(utcStr: string | null | undefined): string {
  const s = typeof utcStr === 'string' ? utcStr.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return s || '—'
  const d = new Date(s.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return s
  return (
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + '（北京时间）'
  )
}

/** `_computed.ranking` 在类型里是 `unknown`（后端那棵树一直在长），这里只按需要点取，取不到就不显示 */
function rankingOf(report: EngineRecommendation): Record<string, unknown> | null {
  const r = (report._computed as Record<string, unknown> | undefined)?.ranking
  return r && typeof r === 'object' ? (r as Record<string, unknown>) : null
}

function beyondOf(report: EngineRecommendation): BeyondTopN | null {
  const b = rankingOf(report)?.beyond_top_n
  return b && typeof b === 'object' ? (b as BeyondTopN) : null
}

/**
 * D 节：把后端已经算好的参数原样列出来，⛔ 不做任何换算
 *
 * 🔴 10-22 第十四阶段·第一步 X6（`docs/依据/22` §七）：这一节原来直接把「w1／偏好乘子／
 * 算法缺席惩罚／被 Top N 挤掉」这类内部术语甩给顾客。按 §七 的固定映射改成
 * **先给人话、括号里留住原术语**（⛔ 数值和出处一个不许删——那是本项目的第一条纪律），
 * ⛔ 也不许新增「科学／专业」这类形容词。括号里的名字与后端字段一一对上，顾客想知道
 * 这一格在代码里叫什么，翻这一行就够了。
 */
function paramRows(ranking: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const push = (label: string, value: unknown): void => {
    if (value === null || value === undefined) return
    out.push([label, typeof value === 'object' ? JSON.stringify(value) : String(value)])
  }
  push('规则基础分在总分里的分量（权重 w1）', (ranking.weights as Record<string, unknown>)?.rule)
  push('色彩贴合分在总分里的分量（权重 w2）', (ranking.weights as Record<string, unknown>)?.color)
  push('廓形贴合分在总分里的分量（权重 w3）', (ranking.weights as Record<string, unknown>)?.fit)
  push('至少要量到几维才出分（覆盖率下限）', ranking.coverage_floor)
  push('算法没参与排名时的扣分（缺席惩罚）', ranking.algo_absence_penalty)
  push('这次给出几条（Top N）', ranking.top_n)
  push('给出的这几条里至少几条有算法分', ranking.min_algo_in_top)
  push('参与排名的候选一共几条（候选池）', ranking.candidates)
  push('排名靠后、这次没显示的条数', ranking.ranked_out)
  push('其中来自你衣橱的', ranking.from_wardrobe)
  const algo = ranking.algo as Record<string, unknown> | undefined
  push('显示这几条里有算法分的条数', algo ? String(algo.in_top ?? 0) : null)
  push('所有候选里有算法分的条数', algo ? String(algo.in_pool ?? 0) : null)
  push('为了让有算法分的条挤进排名而换掉的条数', algo ? String(algo.forced_in ?? 0) : null)
  const pref = ranking.preference as Record<string, unknown> | undefined
  push('你自己的偏好有没有按可信度打折（乘子）', pref ? String(pref.enabled) : null)
  push('这份偏好是根据几套穿搭算的', pref ? String(pref.samples ?? 0) : null)
  push('你的偏好实际改变排名的条数', pref ? String(pref.touched_in_top ?? 0) : null)
  const collab = ranking.collab as Record<string, unknown> | undefined
  push('「和你相似的人」那一档有没有生效（协同过滤）', collab ? String(collab.enabled) : null)
  push(
    '和你相似的人凑出了几个（同组人数）',
    collab?.cohort ? String((collab.cohort as Record<string, unknown>).size) : '凑不出同组',
  )
  push('库里这件衣服的打分条数', collab ? String(collab.signals_in_db ?? 0) : null)
  push('「和你相似的人」实际改变排名的条数', collab ? String(collab.touched_in_top ?? 0) : null)
  return out
}

/**
 * 付费报告独有的三节：A（落选尾巴）＋ D（参数与口径）＋ E（回执）。
 * B（深度分析）与 C（Top 8 名单）由 `<RecommendationReport>` 画，这里不重复。
 */
function PaidLedger({ payload }: { payload: PaidReportPayload }) {
  const report = payload.report
  const rp = report.paid_report
  const ranking = rankingOf(report)
  const topN = Number(ranking?.top_n ?? 8)
  const beyond = beyondOf(report)
  if (!rp) return null
  return (
    <div className="space-y-3" style={{ marginBottom: '12px' }}>
      {/* E 回执：这一份到底是哪笔钱换的 */}
      <div
        className="p-3"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
        }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
          交付回执 · 第 {rp.report_no} 份
        </div>
        <div className="text-xs mt-1" style={{ color: '#a8b8c4', lineHeight: '1.8' }}>
          {rp.is_platform_order_no === false
            ? '人工确认到账的一笔'
            : `订单 ${tail(rp.out_trade_no)}`}{' '}
          · {channelLabel(rp.channel)} · {money(rp.amount_fen / 100)}
          <br />
          到账 {beijingOf(rp.paid_at)} · 生成本份 {beijingOf(rp.granted_at)} · 用的是那次填的表
          （记录 #{rp.basis_log_id}，
          {rp.basis_input_at ? `填于 ${beijingOf(rp.basis_input_at)}` : '时间未记'}）
          <br />
          这份跟着当前浏览器；换设备前请用手机号注册，同一手机号才找得回。
        </div>
      </div>

      {/* A 落选尾巴：候选池没超过 Top N 时这里是空的，如实说空，⛔ 不硬凑内容 */}
      <div
        className="p-3"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
        }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
          排在这次给的 {topN} 条之外的名单
        </div>
        {beyond && beyond.rows.length > 0 ? (
          <div className="mt-2 space-y-1">
            <div className="text-xs" style={{ color: '#a8b8c4' }}>
              共 {beyond.count} 条{beyond.capped ? `（这里只列前 ${beyond.max} 条）` : ''}
            </div>
            {beyond.rows.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                className="text-xs"
                style={{
                  color: '#b8c7d4',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <span>
                  {i + 1}. {r.name || '（无名）'}
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    · {r.source === 'wardrobe' ? '你的衣橱' : '规则库'}
                  </span>
                </span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {r.score === null ? '未出分' : Number(r.score).toFixed(2)}
                  {r.missing.length ? ` · 缺 ${r.missing.join('、')}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs mt-1" style={{ color: '#a8b8c4', lineHeight: '1.7' }}>
            这次进入排序的候选不足 {topN} 条，所以名单之外没有东西可列——
            这一节要等你衣橱里的衣服或多几个条件之后才有内容。这不是"付费没给你东西"。
          </div>
        )}
      </div>

      {/* D 参数与口径：把这一份分数是怎么来的逐条列全 */}
      {ranking && (
        <div
          className="p-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
          }}
        >
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            参数与口径（这一份分是怎么算出来的）
          </div>
          <div className="mt-2 space-y-1">
            {paramRows(ranking).map(([k, v]) => (
              <div
                key={k}
                className="text-xs"
                style={{
                  color: '#b8c7d4',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <span style={{ textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
          {typeof ranking.note === 'string' && (
            <p className="text-xs mt-2" style={{ color: '#a8b8c4', lineHeight: '1.7' }}>
              {ranking.note}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function PaidReports({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<MyPaymentInfo | null>(null)
  const [payload, setPayload] = useState<PaidReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 游客付的款只挂在这台浏览器的 session 上（§八 第 6 条）⇒ 顶部那条提示按登录态显示
  const account = getAccount()

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setInfo(await getPaymentEntitlement())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 🔴 第十四阶段·第一步 C1：到账有两条来路（在线订单号／人工已核凭证 id），共用这一个领取口。
  // `busy` 存的是**带前缀的键**，⛔ 用裸 id：凭证 id 与订单尾号可能同为小数字，会互相顶掉禁用态。
  const claim = useCallback(async (target: { outTradeNo: string } | { depositId: number }) => {
    const key = 'outTradeNo' in target ? 'O:' + target.outTradeNo : 'D:' + target.depositId
    setBusy(key)
    setError('')
    try {
      const p = await claimPaidReport(target)
      setPayload(p)
      if (!p.fresh) toast('这是这一笔已生成的那一份')
      // 领完刷一次权益：`used/left` 的真相源在库里，不在这里加一减一
      setInfo(await getPaymentEntitlement())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '领取失败')
    } finally {
      setBusy('')
    }
  }, [])

  /** 下载的是「这一屏已经渲染出来的内容」＋页面现有样式，⛔ 不宣称服务端生成的原件 */
  const downloadHtml = useCallback(() => {
    const node = bodyRef.current
    if (!node) return toast('还没有可下载的报告')
    let css = ''
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        css += Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n')
      } catch {
        /* 跨源样式表读不到规则（本站是同源，真读不到就少一段样式，不影响内容） */
      }
    }
    const no = payload?.report.paid_report?.out_trade_no || 'report'
    const day = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>我的形象细账 ${tail(no)}</title><style>${css}</style></head><body style="background:#0f141c;color:#e6edf3;padding:16px;">${node.outerHTML}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `形象细账-${String(no).slice(-6)}-${day}.html`
    a.click()
    // 立刻收回会让下载中断的文件句柄在部分浏览器里报错，留 1 秒再撤
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [payload])

  const ent = info?.entitlement
  const rows = payload ? (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setPayload(null)} className="ghost-btn px-3 py-1.5 text-xs">
          ← 返回列表
        </button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="ghost-btn px-3 py-1.5 text-xs">
            🖨 打印 / 存成 PDF
          </button>
          <button onClick={downloadHtml} className="ghost-btn px-3 py-1.5 text-xs">
            ⬇ 下载这份 HTML
          </button>
        </div>
      </div>
      <div ref={bodyRef}>
        <PaidLedger payload={payload} />
        {payload.profile ? (
          <Suspense
            fallback={
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                加载报告…
              </div>
            }
          >
            <RecommendationReport
              recommendation={payload.report}
              profile={payload.profile}
              mode={payload.mode}
              compact
            />
          </Suspense>
        ) : (
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            这份报告缺当时的输入，无法渲染名单（回执仍在上面）。
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="space-y-3">
      {loading && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          读取中…
        </div>
      )}
      {error && (
        <div className="text-xs" style={{ color: '#ff9ba1', lineHeight: '1.7' }}>
          {error}
        </div>
      )}
      {ent && (
        <>
          <div
            className="p-3"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--line)',
              borderRadius: '10px',
            }}
          >
            <div className="text-sm" style={{ color: 'var(--text)' }}>
              还能领 {ent.left} 份 · 已领 {ent.used} 份
            </div>
            <div className="text-xs mt-1" style={{ color: '#a8b8c4', lineHeight: '1.8' }}>
              在线已到账 {ent.paid_orders} 笔（{money(ent.paid_amount)}）
              {ent.pending_orders > 0
                ? ` · 还有 ${ent.pending_orders} 笔没付完（${money(ent.pending_amount)}）`
                : ''}
              {ent.closed_orders > 0 ? ` · ${ent.closed_orders} 笔超时关闭` : ''}
              <br />
              {ent.proof_approved > 0
                ? `另有 ${ent.proof_approved} 笔走的是「上传截图人工确认」（${money(ent.proof_amount)}），确认后同样在这里自助领，一笔一份。`
                : '付款后回这里点「领取」就行，一单一份，可以反复打开。'}
            </div>
          </div>

          {!account && (
            <div
              className="p-3 text-xs"
              style={{
                background: 'rgba(255,212,121,0.08)',
                border: '1px solid var(--line)',
                borderRadius: '10px',
                color: '#ffd479',
                lineHeight: '1.7',
              }}
            >
              这份报告跟着当前浏览器；换设备前请用手机号注册，同一手机号才找得回。
            </div>
          )}

          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>
              可以领的
            </div>
            {ent.claimable.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {ent.paid_orders > 0
                  ? '已付的这几笔都领过了，下面直接查看。'
                  : (ent.claimable_proofs?.length ?? 0) > 0
                    ? '在线订单里没有待领的；下面这笔是人工确认后到账的，直接点领取。'
                    : '还没有已到账的订单。付完再回这里领。'}
              </div>
            ) : (
              <div className="space-y-2">
                {ent.claimable.map((c) => (
                  <div
                    key={c.out_trade_no}
                    className="flex items-center justify-between gap-2 p-3"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--line)',
                      borderRadius: '10px',
                    }}
                  >
                    <div className="text-xs" style={{ color: '#b8c7d4', lineHeight: '1.7' }}>
                      订单 {tail(c.out_trade_no)} · {money(c.amount)} ·{' '}
                      {c.channel === 'alipay' ? '支付宝' : '微信'}
                      <br />
                      <span style={{ color: 'var(--muted)' }}>到账 {c.paid_at || '—'}</span>
                    </div>
                    <button
                      onClick={() => void claim({ outTradeNo: c.out_trade_no })}
                      disabled={busy === 'O:' + c.out_trade_no}
                      className="primary-btn px-3 py-1.5 text-xs"
                      style={{ opacity: busy === 'O:' + c.out_trade_no ? 0.6 : 1 }}
                    >
                      {busy === 'O:' + c.out_trade_no ? '生成中…' : '领取'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* 🔴 C1：人工凭证那一路以前只在文案里说"由我们确认后交给你"，实际没有领取口——
                顾客付了钱、后台也确认了，页面上却只有在线订单列表。这一格把承诺接上。
                ⛔ 不显示成"订单号"：那个键是内部幂等用的 `DEPOSIT-<id>`，不是平台单号。 */}
            {(ent.claimable_proofs?.length ?? 0) > 0 && (
              <div className="space-y-2 mt-2">
                {ent.claimable_proofs!.map((p) => (
                  <div
                    key={'D' + p.deposit_id}
                    className="flex items-center justify-between gap-2 p-3"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--line)',
                      borderRadius: '10px',
                    }}
                  >
                    <div className="text-xs" style={{ color: '#b8c7d4', lineHeight: '1.7' }}>
                      人工确认到账的一笔 · {money(p.amount)}
                      <br />
                      <span style={{ color: 'var(--muted)' }}>确认于 {p.paid_at || '—'}</span>
                    </div>
                    <button
                      onClick={() => void claim({ depositId: p.deposit_id })}
                      disabled={busy === 'D:' + p.deposit_id}
                      className="primary-btn px-3 py-1.5 text-xs"
                      style={{ opacity: busy === 'D:' + p.deposit_id ? 0.6 : 1 }}
                    >
                      {busy === 'D:' + p.deposit_id ? '生成中…' : '领取'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>
              已领的
            </div>
            {ent.reports.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                还没有领过的报告。
              </div>
            ) : (
              <div className="space-y-2">
                {ent.reports.map((r) => (
                  <div
                    key={r.out_trade_no}
                    className="flex items-center justify-between gap-2 p-3"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--line)',
                      borderRadius: '10px',
                    }}
                  >
                    <div className="text-xs" style={{ color: '#b8c7d4', lineHeight: '1.7' }}>
                      第 {r.report_no} 份 ·{' '}
                      {r.is_platform_order_no === false
                        ? '人工确认到账的一笔'
                        : '订单 ' + tail(r.out_trade_no)}{' '}
                      · {money(r.amount)}
                      <br />
                      <span style={{ color: 'var(--muted)' }}>生成于 {r.granted_at || '—'}</span>
                    </div>
                    <button
                      onClick={() =>
                        void claim(
                          r.is_platform_order_no === false && r.deposit_id != null
                            ? { depositId: r.deposit_id }
                            : { outTradeNo: r.out_trade_no },
                        )
                      }
                      disabled={
                        busy ===
                        (r.is_platform_order_no === false
                          ? 'D:' + r.deposit_id
                          : 'O:' + r.out_trade_no)
                      }
                      className="ghost-btn px-3 py-1.5 text-xs"
                    >
                      {busy ===
                      (r.is_platform_order_no === false
                        ? 'D:' + r.deposit_id
                        : 'O:' + r.out_trade_no)
                        ? '打开中…'
                        : '查看'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {ent && (
        <div className="text-xs" style={{ color: 'var(--muted)', lineHeight: '1.7' }}>
          想重新算一份？先在展厅生成一次方案（报告会照你最新填的那次算），再回这里领取。
        </div>
      )}
    </div>
  )

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 flex items-end sm:items-center sm:justify-center"
      style={{ zIndex: 100, background: 'rgba(0,0,0,0.65)' }}
    >
      {/* 打印时只留报告体：这一段样式随组件走，⛔ 不动全局 CSS */}
      <style>{`@media print { body * { visibility: hidden; } .paid-report-body, .paid-report-body * { visibility: visible; } .paid-report-body { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl p-5"
        style={{
          background: '#141b26',
          border: '1px solid var(--line)',
          borderRadius: '14px 14px 0 0',
          maxHeight: '86vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
            我的报告
          </h3>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1"
            style={{
              color: 'var(--muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>
        <div className={payload ? 'paid-report-body' : ''}>{rows}</div>
      </div>
    </div>
  )
}

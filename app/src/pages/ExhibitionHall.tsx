import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { toast } from '../utils/toastOnce'
import {
  clearExpiredSession,
  createCustomerSession,
  deleteCustomerSession,
  deleteProfileArchive,
  getAccount,
  getCustomerRecommendation,
  getEngineRecommendation,
  getProfileArchive,
  getSessionId,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveProfileArchive,
  setGlobalErrorHandler,
  syncCustomerToCloud,
} from '../api'
import type { AccountInfo, ProfileField } from '../api'
import { useResponsive } from '../hooks/useResponsive'
import ErrorMessage from '../components/ui/ErrorMessage'
import type { CustomerProfile, EngineRecommendation, ProfileTag } from '../types'

// 代码分割:按需加载重型组件,减小首屏 bundle 体积
const CustomerForm = lazy(() => import('../components/CustomerForm'))
const PersonalProfileForm = lazy(() => import('../components/PersonalProfileForm'))
const RecommendationReport = lazy(() => import('../components/RecommendationReport'))
const CabinetManager = lazy(() => import('../components/CabinetManager'))
// 第十二阶段·第一步：付款之后顾客领报告的那个浮层（不是新路由，同登录面板那套遮罩）
const PaidReports = lazy(() => import('../components/PaidReports'))
const CrossCabinetReport = lazy(() => import('../components/CrossCabinetReport'))
const RuleBrowser = lazy(() => import('../components/RuleBrowser'))

/**
 * 3D模型展厅 + 形象服务一体化页面
 *
 * 支持双模式:
 *   门店模式(store): 少数字段快速采集 → 推荐 → 同步/删除
 *   个人模式(personal): 完整深度档案 → 推荐 → 橱柜管理 → 跨柜推荐
 */

type Stage = 'standby' | 'mode-select' | 'form' | 'report' | 'rules'
type Panel = 'model' | 'service'
type ServiceMode = 'store' | 'personal'
type ReportTab = 'recommendation' | 'cabinet' | 'cross' | 'rules'

export default function ExhibitionHall() {
  // 页面加载时主动清理过期 Session
  useEffect(() => {
    clearExpiredSession()
  }, [])

  const responsive = useResponsive()
  // isMobile 这次多一个用途（10-22 第十四阶段·第一步 X7）：窄屏要落到 `.narrow-hit` 类上，
  // 让选项按钮≥44px、5 列降 3 列。⛔ 不在 index.css 里再写一条 @media 767px——阈值 768 的
  // 唯一真身是 useResponsive.ts 的 DESKTOP_MIN_WIDTH，两处各写一份迟早打架。
  const { mode: layoutMode, isMobile } = responsive

  const [stage, setStage] = useState<Stage>('standby')
  const [mobilePanel, setMobilePanel] = useState<Panel>('service')
  const [serviceMode, setServiceMode] = useState<ServiceMode>('store')

  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  /** 后端长期档案(含没点生成的草稿),两个模式的表单都拿它预填 */
  const [archiveProfile, setArchiveProfile] = useState<CustomerProfile | null>(null)
  /** 个人模式:本次计算从档案补进来的字段中文名 */
  const [archiveUsed, setArchiveUsed] = useState<string[]>([])
  /** 个人模式:后端按人存下来的形象标签(算完即存) */
  const [profileTags, setProfileTags] = useState<ProfileTag[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [recommendation, setRecommendation] = useState<EngineRecommendation | null>(null)
  // 🔴 10-21 第十三阶段·第一步 §四·1：顾客在报告页天气卡里选中的城市。
  // 它**只活在这一屏**（state，⛔ 不写 localStorage、⛔ 不进档案），下一次生成时当 `/engine` 的可选第三参送上去。
  const [weatherCity, setWeatherCity] = useState<string | null>(null)
  /** 上一次生成时后端回的天气出处账（'live'/'failed' + 那句人话），原样显示，⛔ 前端不另编一句 */
  const [weatherOutcome, setWeatherOutcome] = useState<{
    source: 'live' | 'failed'
    notice?: string
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  const [reportTab, setReportTab] = useState<ReportTab>('recommendation')
  /**
   * 🔴 10-22 第十四阶段·第一步 X8（`docs/依据/22` §九）：后端每次算完都随结果带回一句 `privacy_notice`，
   * 改前前端把它整份丢掉（组件引用 0 处）⇒ 顾客在屏幕上读不到"这些数据拿去做什么、能不能删"。
   * 真相源只有后端那一份（门店走 `routes/customer.js` 的 `PRIVACY_NOTICE.highlight`，
   * 个人走 `routes/recommend.js` 的那句），⛔ 前端不许自己编一句。
   */
  const [privacyNotice, setPrivacyNotice] = useState('')

  /**
   * 🔴 10-22 第十四阶段·第一步 X2 的后半件（`docs/依据/22` §三）：吐司几秒后自动消失，
   * 顾客抬头时页面上一处痕迹都不留 ⇒ "到底是我点太快、还是没网"永远猜。
   * 去重（同一条只弹一次）在 `utils/toastOnce.ts`，**留下**这一半就落在这个 state：
   * 失败原话留在提交按钮所在那一屏上，⛔ 不改写、⛔ 不翻译成状态码、⛔ 不吞掉后端给的分钟数。
   */
  const [submitError, setSubmitError] = useState('')

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // 提交数据 -> 获取推荐
  const handleSubmit = useCallback(
    async (p: CustomerProfile) => {
      setSubmitting(true)
      // 每一次提交都重新计：上一屏留下的失败原话不许粘在这一屏上冒充"这次也失败了"（X2）
      setSubmitError('')
      setProfile(p)
      let createdSessionId: string | null = null
      try {
        if (serviceMode === 'store') {
          const session = await createCustomerSession(p)
          createdSessionId = session.session_id
          setSessionId(createdSessionId)
          const result = await getCustomerRecommendation(createdSessionId, 'store')
          setRecommendation(result.recommendation)
          setPrivacyNotice(result.privacy_notice || '')
          // 门店那一路走的是 `/customer/session/:id/recommend`（按会话里存的档案重算），
          // 本轮的天气接入只落在 `/engine` 上（§四·1 的入口写死了是它），⛔ 这里不许谎称带了天气
          setWeatherOutcome(null)
        } else {
          const result = await getEngineRecommendation(p, 'personal', weatherCity || undefined)
          setRecommendation(result.recommendation)
          setPrivacyNotice(result.privacy_notice || '')
          setWeatherOutcome(
            result.weather_source
              ? { source: result.weather_source, notice: result.weather_notice }
              : null,
          )
          setArchiveUsed(result.archive?.used_fields || [])
          setProfileTags(result.archive?.tags || [])
          setSessionId(getSessionId())
        }
        setStage('report')
      } catch (e: unknown) {
        // 门店模式:如果第1步成功但第2步失败,清理孤儿 session
        if (serviceMode === 'store' && createdSessionId) {
          try {
            await deleteCustomerSession(createdSessionId)
          } catch {
            /* 静默清理 */
          }
          setSessionId(null)
        }
        toast.error(e instanceof Error ? e.message : '获取推荐失败')
        setSubmitError(e instanceof Error ? e.message : '获取推荐失败')
      } finally {
        setSubmitting(false)
      }
    },
    // 城市变了必须重算：`weatherCity` 不在依赖里的话，这一屏选了城市点"重算"还是拿旧的那份算（§四·1）
    [serviceMode, weatherCity],
  )

  // 预填:在"选择模式"那一屏就把档案读回来.两个表单组件都只在挂载那一刻读一次 initial,
  // 等进了表单页再取已经来不及;门店模式同样复用,因为他不想为同一个人填两遍
  useEffect(() => {
    if (stage !== 'mode-select' || !getAccount()) return
    getProfileArchive()
      .then((res) => {
        if (res.profile) setArchiveProfile(res.profile)
        if (res.tags) setProfileTags(res.tags)
      })
      .catch(() => {
        /* 档案读取失败不影响正常填写 */
      })
  }, [stage])

  // 草稿自动保存:填了一半没点生成也替他记住.游客没有账号可挂,直接不存
  const draftTimer = useRef<number | null>(null)
  const handleDraft = useCallback((p: CustomerProfile) => {
    if (!getAccount()) return
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      saveProfileArchive(p).catch(() => {
        /* 草稿没存上不该打断填写 */
      })
    }, 1500)
  }, [])

  // 卸载时把还没到点的防抖定时器收掉：不然 1.5 秒内切走页面，这次 saveProfileArchive
  // 仍会带着已卸载表单的数据打后端（后写覆盖先写），控制台还会留一个对已销毁组件 setState 的警告
  useEffect(
    () => () => {
      if (draftTimer.current) {
        window.clearTimeout(draftTimer.current)
        draftTimer.current = null
      }
    },
    [],
  )

  const handleSync = useCallback(async () => {
    if (!sessionId) return
    setSyncing(true)
    try {
      await syncCustomerToCloud(sessionId)
      setSynced(true)
      toast.success('数据已同步到门店')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '同步失败')
    } finally {
      setSyncing(false)
    }
  }, [sessionId])

  /**
   * 清掉内存里那三份"预填/展示用的档案"。
   * 单独抽出来是因为有两个入口都要它：整屏重置，以及账号面板里点"删除我的全部数据"
   * （那条走的是 AccountEntry，够不着这里的 state，只能由上层把回调传下去）。
   */
  const clearArchiveMemory = useCallback(() => {
    setArchiveProfile(null)
    setArchiveUsed([])
    setProfileTags([])
  }, [])

  const resetToStandby = useCallback(() => {
    setStage('standby')
    setProfile(null)
    setSessionId(null)
    setRecommendation(null)
    // 预填源必须一起清：档案/会话数据删掉之后 archiveProfile 还留在内存里，
    // 两个表单的 `initial={profile || archiveProfile}` 会继续把刚删掉的身体数据填回去
    // （不刷新页面就一直如此，用户看到"已删除"却还能再存一遍）
    clearArchiveMemory()
    setSynced(false)
    setReportTab('recommendation')
  }, [clearArchiveMemory])

  const handleDelete = useCallback(async () => {
    if (!sessionId) return
    try {
      await deleteCustomerSession(sessionId)
      toast.success('您的数据已删除')
      resetToStandby()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }, [sessionId, resetToStandby])

  const handleBack = useCallback(() => {
    setStage('form')
    setRecommendation(null)
  }, [])

  const startService = useCallback(() => {
    setStage('mode-select')
    setMobilePanel('service')
  }, [])

  const selectMode = useCallback((mode: ServiceMode) => {
    setServiceMode(mode)
    setStage('form')
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // 安全:只接受同源 postMessage,防止跨域攻击
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'start-service') startService()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [startService])

  // 🔴 第十四阶段·第一步 X1：从 `/gallery` 独立页跳过来时带 `?start=1`，这里替顾客点开服务流程，
  // 并把这一个查询参数从地址栏撤掉（⛔ 让它留着：刷新一次就重开一次服务态，等于地址栏在替用户做主）。
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('start') !== '1') return
    startService()
    q.delete('start')
    const rest = q.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''))
  }, [startService])

  // 注册全局网络错误处理器
  useEffect(() => {
    setGlobalErrorHandler((msg: string) => {
      toast.error(msg)
    })
    return () => setGlobalErrorHandler(null)
  }, [])

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'set-mode', mode: stage }, window.location.origin)
    }
  }, [stage])

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'set-mode', mode: stage }, window.location.origin)
    }
  }, [stage])

  const isSplitScreen = layoutMode === 'desktop-landscape' || layoutMode === 'mobile-landscape'

  // 待机态
  if (stage === 'standby') {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: 'radial-gradient(ellipse at center, #182030 0%, #0d1117 70%)' }}
      >
        <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
        <Toaster />
      </div>
    )
  }

  // 手机竖屏
  if (!isSplitScreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
        <div
          className="flex z-20"
          style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}
        >
          <button
            onClick={() => setMobilePanel('model')}
            className={`tab-btn ${mobilePanel === 'model' ? 'active' : ''}`}
            style={{
              borderRadius: 0,
              borderBottom: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: '1px solid var(--line)',
            }}
          >
            ✨ 3D模型
          </button>
          <button
            onClick={() => setMobilePanel('service')}
            className={`tab-btn ${mobilePanel === 'service' ? 'active' : ''}`}
            style={{
              borderRadius: 0,
              borderBottom: 'none',
              borderTop: 'none',
              borderRight: 'none',
            }}
          >
            {stage === 'report'
              ? '📋 建议报告'
              : stage === 'mode-select'
                ? '🎯 选择模式'
                : '📝 信息填写'}
          </button>
        </div>
        <div className="flex-1 relative overflow-hidden">
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${mobilePanel === 'model' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
          >
            <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
            <button
              onClick={() => setStage('standby')}
              className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-lg ghost-btn"
              style={{ background: 'rgba(13,17,23,0.8)', backdropFilter: 'blur(12px)' }}
            >
              ←
            </button>
          </div>
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${mobilePanel === 'service' ? 'opacity-100 z-10 overflow-y-auto' : 'opacity-0 z-0 pointer-events-none'}`}
            style={{ background: 'var(--panel)' }}
          >
            <div className={isMobile ? 'p-4 narrow-hit' : 'p-4'}>
              <ServicePanel
                stage={stage}
                serviceMode={serviceMode}
                profile={profile}
                sessionId={sessionId}
                recommendation={recommendation}
                archiveProfile={archiveProfile}
                archiveUsed={archiveUsed}
                profileTags={profileTags}
                submitting={submitting}
                syncing={syncing}
                synced={synced}
                reportTab={reportTab}
                onSubmit={handleSubmit}
                onDraft={handleDraft}
                onSync={handleSync}
                onDelete={handleDelete}
                onArchiveCleared={clearArchiveMemory}
                onBack={handleBack}
                onSelectMode={selectMode}
                onReset={resetToStandby}
                onReportTabChange={setReportTab}
                onStageChange={setStage}
                weatherCity={weatherCity}
                weatherOutcome={weatherOutcome}
                onWeatherCity={setWeatherCity}
                privacyNotice={privacyNotice}
                submitError={submitError}
              />
            </div>
          </div>
        </div>
        <Toaster />
      </div>
    )
  }

  // 分屏模式
  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: 'var(--bg)' }}>
      <div
        className="relative h-full split-left"
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          background: 'radial-gradient(ellipse at center, #182030 0%, #0d1117 70%)',
        }}
      >
        <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
        <button
          onClick={() => setStage('standby')}
          className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-lg ghost-btn"
          style={{ background: 'rgba(13,17,23,0.8)', backdropFilter: 'blur(12px)' }}
        >
          ←
        </button>
      </div>
      <div
        className={
          isMobile
            ? 'split-right h-full overflow-y-auto narrow-hit'
            : 'split-right h-full overflow-y-auto'
        }
        style={{
          flex: '0 0 420px',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--line)',
          padding: '20px 18px 14px',
        }}
      >
        <ServicePanel
          stage={stage}
          serviceMode={serviceMode}
          profile={profile}
          sessionId={sessionId}
          recommendation={recommendation}
          archiveProfile={archiveProfile}
          archiveUsed={archiveUsed}
          profileTags={profileTags}
          submitting={submitting}
          syncing={syncing}
          synced={synced}
          reportTab={reportTab}
          onSubmit={handleSubmit}
          onDraft={handleDraft}
          onSync={handleSync}
          onDelete={handleDelete}
          onArchiveCleared={clearArchiveMemory}
          onBack={handleBack}
          onSelectMode={selectMode}
          onReset={resetToStandby}
          onReportTabChange={setReportTab}
          onStageChange={setStage}
          weatherCity={weatherCity}
          weatherOutcome={weatherOutcome}
          onWeatherCity={setWeatherCity}
          privacyNotice={privacyNotice}
          submitError={submitError}
          compact
        />
      </div>
      <Toaster />
    </div>
  )
}

// ============ 3D模型查看器 ============
function ModelViewer({
  iframeRef,
  onLoad,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onLoad?: () => void
}) {
  return (
    <iframe
      ref={iframeRef}
      src="/gallery"
      className="w-full h-full"
      title="3D模型展厅"
      allow="camera; microphone"
      onLoad={onLoad}
    />
  )
}

// ============ 付款 / 创作者入驻卡片(仅模式选择页,不浮在3D展示层上)============
function ServiceLinkCards({ onArchiveCleared }: { onArchiveCleared?: () => void }) {
  // 「我的报告」不开新页面（`App.tsx` 只有 `/` 一条真路由）：点开走覆盖层，同登录面板那套
  const [reportsOpen, setReportsOpen] = useState(false)
  const cards = [
    {
      href: '/pay.html',
      icon: '💳',
      title: '付款通道',
      sub: '在线付款 · 凭证提交',
      desc: '已选好服务?在这里付款并把付款凭证提交给我们核对.在线付款到账后,直接用下面那张「我的报告」领这一份细账.',
    },
    {
      href: '/creator.html',
      icon: '🎨',
      title: '创作者投稿与曝光',
      sub: '提交方案 · 审核展示 · 按热度曝光',
      desc: '上传你的搭配、化妆或推荐规则方案,审核通过后按市场推广度获得曝光.投稿目前只做展示,不涉及任何款项往来.',
    },
    {
      // 🔴 第十四阶段追加（他 10-22 的第三条指令：「给这个项目做个网页介绍……点一下就能跳转」）
      href: '/how-it-works.html',
      icon: '🧭',
      title: '这套系统是怎么造的',
      sub: '量化管线 · 依据分档 · 当前底数',
      desc: '讲清楚四件事:数据怎么量出来、规则从哪来、哪些结论有国标或论文撑着、哪些只是行业经验或命理体系.里面还写了库里现在的真实行数——样本薄我们就说薄.',
    },
  ]
  return (
    <div className="mt-4 space-y-3">
      {cards.map((c) => (
        <a
          key={c.href}
          href={c.href}
          className="block p-4"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{c.icon}</span>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {c.title}
              </h3>
              <p className="text-xs" style={{ color: '#b8c7d4' }}>
                {c.sub}
              </p>
            </div>
          </div>
          <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
            {c.desc}
          </p>
        </a>
      ))}

      {/* 第十二阶段·第一步：付款即交付的那一环。今天这句话第一次成立——
          到账后不用等人工，顾客自己在这层里领走这份细账（后端按订单号幂等，一单一份）。 */}
      <button
        onClick={() => setReportsOpen(true)}
        className="block w-full p-4 text-left"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">📑</span>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              我的报告
            </h3>
            <p className="text-xs" style={{ color: '#b8c7d4' }}>
              付款即交付 · 可反复打开
            </p>
          </div>
        </div>
        <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
          到账后在这里领那一份深度细账:除了屏幕上这 8
          条,还列出参数与口径、排在名单之外的候选和交付回执,可以打印或存成文件.
        </p>
      </button>

      <AccountEntry onArchiveCleared={onArchiveCleared} />

      {reportsOpen && (
        <Suspense
          fallback={
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              加载我的报告…
            </div>
          }
        >
          <PaidReports onClose={() => setReportsOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

function maskPhone(phone: string): string {
  const p = String(phone || '')
  return p.length === 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : p
}

// ============ 我的账号:登录 / 注册(覆盖在 3D 展示上,不跳页)============
function AccountEntry({ onArchiveCleared }: { onArchiveCleared?: () => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<AccountInfo | null>(() => getAccount())
  /** 打开面板时读一次:后端把档案与草稿变成了中文清单,这里只负责列出来 */
  const [stored, setStored] = useState<{ fields: ProfileField[]; tags: ProfileTag[] } | null>(null)

  useEffect(() => {
    if (!open || !account || stored) return
    getProfileArchive()
      .then((res) => setStored({ fields: res.fields || [], tags: res.tags || [] }))
      .catch(() => setStored({ fields: [], tags: [] }))
  }, [open, account, stored])

  const panelStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--line)',
    borderRadius: '12px',
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next =
        tab === 'login'
          ? await loginAccount(phone.trim(), password)
          : await registerAccount(phone.trim(), password, nickname.trim() || undefined)
      const { merged, ...accountInfo } = next
      setAccount(accountInfo)
      setOpen(false)
      setPassword('')
      const movedCount = merged ? Object.values(merged.moved).reduce((a: number, b) => a + b, 0) : 0
      const base = tab === 'login' ? '已登录' : '注册成功,已为你保留这份身份'
      const withData = movedCount
        ? `${base};之前游客期间攒的 ${movedCount} 条记录已并入本账号${
            merged && merged.dropped
              ? `,另有 ${merged.dropped} 条与账号里已有的重复,以已有的为准`
              : ''
          }`
        : base
      toast.success(withData)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  /** 兑现隐私承诺:可随时删掉本机档案与属于本人的全部记录(含上传的照片文件) */
  const removeArchive = async () => {
    if (busy) return
    if (
      !window.confirm(
        '将删除你存下的身体档案、面容档案、没点生成的表单草稿、形象标签、点过的建议评价、推荐与搭配记录、试穿结果,以及上传过的照片和它在服务器上的文件.删除后无法恢复,确定继续?',
      )
    )
      return
    setBusy(true)
    try {
      const r = await deleteProfileArchive()
      const deleted = [
        `身体档案 ${r.body} 份`,
        `面容档案 ${r.face} 份`,
        `表单草稿 ${r.draft} 份`,
        `形象标签 ${r.tags} 条`,
        `建议评价 ${r.feedback} 条`,
        `推荐记录 ${r.logs} 条`,
        `搭配记录 ${r.records} 条`,
        `试穿结果 ${r.tryon} 条`,
        `照片 ${r.photos} 张`,
      ].join('、')
      toast.success(
        `已删除:${deleted}${r.files ? `,同时清掉 ${r.files} 个文件` : ''}${r.files_failed ? `;${r.files_failed} 个文件没删掉,请联系管理员` : ''}`,
      )
      setOpen(false)
      setStored(null)
      // 后端已经把身体档案／标签全删了，上层内存里那三份预填源必须一起清掉：
      // 两个表单的预填取的是 `profile || archiveProfile`，不清就等于刚点完"已删除"，
      // 再进表单还是带着那份被删掉的身体数据，用户点一次生成又把它存回库里。
      // 这三份 state 在 ExhibitionHall 上，AccountEntry 够不着，只能回上去让上层清。
      onArchiveCleared?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        className="block p-4 w-full text-left"
        style={panelStyle}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">👤</span>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {account ? `已登录:${maskPhone(account.phone)}` : '我的账号'}
            </h3>
            <p className="text-xs" style={{ color: '#b8c7d4' }}>
              {account ? '换浏览器或换设备后,登录同一个手机号就能找回' : '登录 · 注册'}
            </p>
          </div>
        </div>
        <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
          {account
            ? '你提交的作品、衣橱和推荐记录都挂在这个手机号上,不会再随浏览器变化.'
            : '不登录也能逛和试用;注册后方案与作品会一直跟着这个手机号,投稿审核结果也发到这儿.'}
        </p>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 flex items-end sm:items-center sm:justify-center"
          style={{ zIndex: 100, background: 'rgba(0,0,0,0.65)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm p-5"
            style={{
              background: '#141b26',
              border: '1px solid var(--line)',
              borderRadius: '14px 14px 0 0',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
                我的账号
              </h3>
              <button
                onClick={() => setOpen(false)}
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

            {account ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--text)' }}>
                  当前:{maskPhone(account.phone)}
                  {account.nickname ? ` · ${account.nickname}` : ''}
                </p>
                <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
                  退出后这台设备回到游客身份,之前的方案与作品仍在账号里,重新登录即可继续.
                </p>
                <button
                  onClick={() => {
                    logoutAccount()
                    setAccount(null)
                    setOpen(false)
                    toast('已退出登录')
                  }}
                  className="w-full py-2 text-sm"
                  style={{ ...panelStyle, color: 'var(--text)', cursor: 'pointer' }}
                >
                  退出登录
                </button>
                <div className="p-3 text-xs" style={{ ...panelStyle, lineHeight: '1.8' }}>
                  <p className="font-semibold" style={{ color: 'var(--text)' }}>
                    我存的信息
                  </p>
                  {!stored && <p style={{ color: 'var(--muted)' }}>读取中…</p>}
                  {stored && stored.fields.length === 0 && stored.tags.length === 0 && (
                    <p style={{ color: 'var(--muted)' }}>
                      还没替你记住任何东西.填一次点生成,或只在表单里改几项,都会自动存下来.
                    </p>
                  )}
                  {stored && (stored.fields.length > 0 || stored.tags.length > 0) && (
                    <div className="mt-1" style={{ maxHeight: '170px', overflowY: 'auto' }}>
                      {stored.fields.map((f) => (
                        <div key={f.key} style={{ color: '#a8b8c4' }}>
                          <span style={{ color: 'var(--muted)' }}>{f.label}：</span>
                          {f.value}
                        </div>
                      ))}
                      {stored.tags.map((t) => (
                        <div key={t.key} style={{ color: '#a8b8c4' }}>
                          <span style={{ color: 'var(--muted)' }}>
                            {t.label.includes('（算出）') ? t.label : `${t.label}（算出）`}：
                          </span>
                          {t.value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
                  下面这项删除的是我们替你记住的身体与面容档案、以及挂在账号下的推荐记录,删完仍可随时重新填写试用.
                </p>
                <button
                  onClick={removeArchive}
                  disabled={busy}
                  className="w-full py-2 text-sm"
                  style={{
                    ...panelStyle,
                    color: 'var(--danger)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  删除我的形象档案与记录
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex" style={panelStyle}>
                  {(['login', 'register'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        setTab(key)
                        setError('')
                      }}
                      className="flex-1 py-2 text-sm"
                      style={{
                        background: tab === key ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: 'none',
                        borderRadius: '12px',
                        color: tab === key ? 'var(--text)' : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {key === 'login' ? '登录' : '注册'}
                    </button>
                  ))}
                </div>

                <input
                  className="form-input w-full"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                />
                <input
                  className="form-input w-full"
                  type="password"
                  maxLength={64}
                  placeholder={tab === 'login' ? '密码' : '设一个密码,至少 6 位'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {tab === 'register' && (
                  <input
                    className="form-input w-full"
                    maxLength={40}
                    placeholder="昵称(可选,展示在创作者广场)"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                )}
                {tab === 'login' && (
                  <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: '1.6' }}>
                    忘记密码?找门店管理员或本站管理员,报手机号即可重置;你的档案、衣橱和作品都不会受影响.
                  </p>
                )}

                <button
                  onClick={submit}
                  disabled={busy || !phone || !password}
                  className="w-full py-2.5 text-sm font-semibold"
                  style={{
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#0d1117',
                    cursor: busy || !phone || !password ? 'not-allowed' : 'pointer',
                    opacity: busy || !phone || !password ? 0.5 : 1,
                  }}
                >
                  {busy ? '处理中…' : tab === 'login' ? '登录' : '注册并登录'}
                </button>

                {error && (
                  <p className="text-xs" style={{ color: '#f87171' }}>
                    {error}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: '1.6' }}>
                  手机号只用来找回你自己的数据和联系你付款,不会展示给别人.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ============ 服务面板 ============
interface ServicePanelProps {
  stage: Stage
  serviceMode: ServiceMode
  profile: CustomerProfile | null
  sessionId: string | null
  recommendation: EngineRecommendation | null
  /** 个人模式:后端长期档案,用于深度表单预填 */
  archiveProfile: CustomerProfile | null
  /** 个人模式:本次计算从档案补进来的字段中文名 */
  archiveUsed: string[]
  /** 个人模式:后端按人存下来的形象标签 */
  profileTags: ProfileTag[]
  submitting: boolean
  syncing: boolean
  synced: boolean
  reportTab: ReportTab
  onSubmit: (p: CustomerProfile) => void
  /** 表单每改一次就回调,由上层防抖存草稿(游客没有账号可挂,不会真发请求) */
  onDraft: (p: CustomerProfile) => void
  onSync: () => void
  onDelete: () => void
  /** 账号面板里"删除我的全部数据"成功后，要由上层把内存里那三份档案预填源一起清掉 */
  onArchiveCleared: () => void
  onBack: () => void
  onSelectMode: (mode: ServiceMode) => void
  onReset: () => void
  onReportTabChange: (tab: ReportTab) => void
  /** 切换页面阶段(用于进入/退出规则浏览器等独立页) */
  onStageChange: (stage: Stage) => void
  /** 🔴 10-21 第十三阶段·第一步 §四·1：报告页天气卡选中的城市（只在这一屏，⛔ 不落库、⛔ 不进档案） */
  weatherCity: string | null
  /** 上一次生成时后端给的天气出处账；null＝那一次没带城市（响应与改前逐字节相同） */
  weatherOutcome: { source: 'live' | 'failed'; notice?: string } | null
  onWeatherCity: (c: string | null) => void
  /** 后端随推荐结果带回的那句隐私声明（X8，⛔ 前端不许自己编） */
  privacyNotice: string
  /** 上一次提交失败的原话（X2 §三：吐司会自己消失，这一句必须留在页面上） */
  submitError: string
  compact?: boolean
}

function ServicePanel(props: ServicePanelProps) {
  const {
    stage,
    serviceMode,
    profile,
    sessionId,
    recommendation,
    submitting,
    syncing,
    synced,
    reportTab,
    onSubmit,
    onDraft,
    onSync,
    onDelete,
    onArchiveCleared,
    onBack,
    onSelectMode,
    onReset,
    onReportTabChange,
    onStageChange,
    compact,
    archiveProfile,
    archiveUsed,
    profileTags,
    weatherCity,
    weatherOutcome,
    onWeatherCity,
    privacyNotice,
    submitError,
  } = props

  // 头部
  const Header = (
    <header className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex items-center justify-between">
        <h1
          className="text-lg font-semibold gradient-text"
          style={{ letterSpacing: '0.3px', margin: 0 }}
        >
          形象数据中心
        </h1>
        {stage !== 'mode-select' && (
          <button
            onClick={onReset}
            className="ghost-btn text-xs px-2 py-1"
            style={{ color: 'var(--muted)' }}
          >
            ✕ 退出
          </button>
        )}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {stage === 'mode-select' && '请选择服务模式'}
        {stage === 'form' &&
          (serviceMode === 'store' ? '门店快速服务 · 填写基础信息' : '个人深度分析 · 填写完整档案')}
        {stage === 'report' && '您的专属形象建议报告'}
        {stage === 'rules' && '了解系统如何根据你的档案生成建议'}
      </p>
    </header>
  )

  // 模式选择页
  if (stage === 'mode-select') {
    return (
      <div className="animate-fade-in">
        {Header}
        <div className="space-y-3">
          <button
            onClick={() => onSelectMode('store')}
            className="p-4 w-full text-left"
            style={{
              background:
                'linear-gradient(135deg, rgba(110,231,199,0.15) 0%, rgba(110,231,199,0.05) 100%)',
              border: '2px solid var(--accent)',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(110,231,199,0.1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(110,231,199,0.25)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(110,231,199,0.1)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🏪</span>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#8ef5d8' }}>
                  门店快速模式
                </h3>
                <p className="text-xs" style={{ color: '#b8c7d4' }}>
                  少填快算 · 快速推荐 · 门店同步
                </p>
              </div>
            </div>
            <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
              适合门店现场服务,快速采集顾客性别、肤色、脸型、体型、场景,即时生成穿搭/妆造/发型/配饰建议,支持同步门店和删除数据.
            </p>
          </button>

          <button
            onClick={() => onSelectMode('personal')}
            className="p-4 w-full text-left"
            style={{
              background:
                'linear-gradient(135deg, rgba(192,132,252,0.15) 0%, rgba(192,132,252,0.05) 100%)',
              border: '2px solid #c084fc',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(192,132,252,0.1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(192,132,252,0.25)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(192,132,252,0.1)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📱</span>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#d4a5ff' }}>
                  个人深度模式
                </h3>
                <p className="text-xs" style={{ color: '#b8c7d4' }}>
                  完整档案 · 算法分析 · 橱柜管理
                </p>
              </div>
            </div>
            <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
              适合个人深度使用,采集完整身材数据、五官细节、风格偏好:BMI/腰臀比/腿身比按人体尺寸的常见量级和公开研究方向计算,区间是参考线,不是国标判定;体型、肤色季型、脸型与风格建议属行业经验体系,都不是科学结论.管理衣橱/化妆品/配饰三柜,获取跨柜联动推荐和购物建议.
            </p>
          </button>
        </div>

        <ServiceLinkCards onArchiveCleared={onArchiveCleared} />

        {/* 规则说明入口:让用户在填表前先了解规则引擎,理解"填什么能匹配到什么" */}
        <div className="mt-4 pt-3 text-center" style={{ borderTop: '1px dashed var(--line)' }}>
          <button
            onClick={() => onStageChange('rules')}
            className="ghost-btn text-xs px-3 py-2"
            style={{ color: 'var(--accent)' }}
          >
            📖 想先了解规则?查看规则说明 →
          </button>
        </div>
      </div>
    )
  }

  // 规则浏览器页(从模式选择页进入,帮助用户理解规则引擎)
  if (stage === 'rules') {
    return (
      <div className="animate-fade-in">
        <header className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center justify-between">
            <h1
              className="text-lg font-semibold gradient-text"
              style={{ letterSpacing: '0.3px', margin: 0 }}
            >
              📖 规则说明
            </h1>
            <button
              onClick={() => onStageChange('mode-select')}
              className="ghost-btn text-xs px-2 py-1"
              style={{ color: 'var(--muted)' }}
            >
              ← 返回
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            了解系统如何根据你的档案生成建议
          </p>
        </header>
        <Suspense
          fallback={
            <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
              加载中...
            </div>
          }
        >
          <RuleBrowser initialMode={serviceMode} compact={compact} />
        </Suspense>
      </div>
    )
  }

  // 表单页
  if (stage === 'form') {
    return (
      <div className="animate-fade-in">
        {Header}
        {/* 🔴 第十四阶段·第一步 X2（`docs/依据/22` §三）：失败原话留在这一屏。
            吐司会自己消失、`toastOnce` 只负责"同一条不弹两次"，顾客抬头时页面必须还有痕迹，
            否则他分不清是没网、点太快、还是额度用完了。文案用后端原话，⛔ 不改写、⛔ 不吞分钟数。
            `onRetry` 这里刻意不挂：`/engine` 那把桶是 20 次/分钟，挂一个"重试"按钮就是替顾客连点。 */}
        {submitError && (
          <div style={{ marginBottom: '10px' }}>
            <ErrorMessage message={submitError} />
          </div>
        )}
        <Suspense
          fallback={
            <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
              加载中...
            </div>
          }
        >
          {serviceMode === 'store' ? (
            <CustomerForm
              initial={profile || archiveProfile || undefined}
              onSubmit={onSubmit}
              submitting={submitting}
              compact={compact}
            />
          ) : (
            <PersonalProfileForm
              initial={profile || archiveProfile || undefined}
              onSubmit={onSubmit}
              onChange={onDraft}
              submitting={submitting}
              compact={compact}
            />
          )}
        </Suspense>
      </div>
    )
  }

  // 报告页
  if (stage === 'report' && recommendation && profile) {
    return (
      <div className="animate-fade-in">
        {Header}

        {/* 报告页内 Tab 切换 */}
        <div className="flex gap-1 pb-2 mb-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <button
            onClick={() => onReportTabChange('recommendation')}
            className={`tab-btn ${reportTab === 'recommendation' ? 'active' : ''}`}
          >
            📋 形象建议
          </button>
          {serviceMode === 'personal' && (
            <>
              <button
                onClick={() => onReportTabChange('cabinet')}
                className={`tab-btn ${reportTab === 'cabinet' ? 'active' : ''}`}
              >
                🗄 橱柜管理
              </button>
              <button
                onClick={() => onReportTabChange('cross')}
                className={`tab-btn ${reportTab === 'cross' ? 'active' : ''}`}
              >
                🔗 跨柜推荐
              </button>
            </>
          )}
          {/* 规则说明:门店/个人模式都显示,让用户对照推荐结果理解规则 */}
          <button
            onClick={() => onReportTabChange('rules')}
            className={`tab-btn ${reportTab === 'rules' ? 'active' : ''}`}
          >
            📖 规则说明
          </button>
        </div>

        {/* 长期档案生效提示:本次没填却用上了的字段 */}
        {serviceMode === 'personal' && reportTab === 'recommendation' && archiveUsed.length > 0 && (
          <div className="mb-3" style={{ fontSize: '12px', color: 'var(--muted)' }}>
            本次有 {archiveUsed.length} 项沿用了你的历史档案：{archiveUsed.join('、')}
          </div>
        )}

        {/* 形象标签:每次算完存进库里的那一份,关掉页面也还在 */}
        {serviceMode === 'personal' && reportTab === 'recommendation' && profileTags.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5" style={{ fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>已存入你的形象标签：</span>
            {profileTags.map((t) => (
              <span
                key={t.key}
                style={{
                  color: 'var(--text)',
                  border: '1px solid var(--line)',
                  borderRadius: 999,
                  padding: '1px 8px',
                }}
              >
                {t.label} {t.value}
              </span>
            ))}
          </div>
        )}

        {/* 推荐报告 */}
        {reportTab === 'recommendation' && (
          <Suspense
            fallback={
              <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
                加载中...
              </div>
            }
          >
            <RecommendationReport
              recommendation={recommendation}
              profile={profile}
              mode={serviceMode}
              sessionId={sessionId || undefined}
              onSync={onSync}
              onDelete={onDelete}
              onBack={onBack}
              synced={synced}
              syncing={syncing}
              compact={compact}
              weatherCity={weatherCity}
              weatherSource={weatherOutcome?.source ?? null}
              weatherNotice={weatherOutcome?.notice ?? null}
              onWeatherCityChange={onWeatherCity}
              privacyNotice={privacyNotice}
              onRegenerate={() => {
                if (profile) onSubmit(profile)
              }}
            />
          </Suspense>
        )}

        {/* 橱柜管理 */}
        {reportTab === 'cabinet' && (
          <Suspense
            fallback={
              <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
                加载中...
              </div>
            }
          >
            <CabinetManager profile={profile} compact={compact} />
          </Suspense>
        )}

        {/* 跨柜推荐 */}
        {reportTab === 'cross' && (
          <Suspense
            fallback={
              <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
                加载中...
              </div>
            }
          >
            <CrossCabinetReport profile={profile} compact={compact} />
          </Suspense>
        )}

        {/* 规则说明:展示所有规则,让用户对照推荐结果理解"为什么推荐这个" */}
        {reportTab === 'rules' && (
          <Suspense
            fallback={
              <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
                加载中...
              </div>
            }
          >
            <RuleBrowser initialMode={serviceMode} compact={compact} />
          </Suspense>
        )}
      </div>
    )
  }

  // 🔴 第十四阶段·第一步 X3（规范 `docs/依据/22` §四）：走到这里＝`stage` 停在 'report' 但
  // `recommendation` 或 `profile` 不在（请求失败、被清空、刷新后状态丢了）。
  // 原来这一格是一颗**永久转圈**：顾客分不清"还在算"还是"死了"，门店屏能空转一整天。
  // 正解分两档：真在提交 ⇒ 说清在算什么；数据没到 ⇒ 说人话 + 给两条出路。
  // ⛔ 不许在这里塞一个默认空报告充数（硬规矩 2：缺测不出分），⛔ 也不许假装"马上就好"。
  if (submitting) {
    return (
      <div className="animate-fade-in">
        {Header}
        <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
          <div className="spinner mx-auto mb-3"></div>
          正在按你刚填的那次算，一般几秒就好……
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {Header}
      <div
        className="p-4 text-center"
        style={{
          border: '1px solid var(--line)',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)',
          lineHeight: '1.9',
        }}
      >
        <div className="text-sm" style={{ color: 'var(--text)' }}>
          这一屏没有可显示的结果
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {recommendation
            ? '结果算出来了，但当时填的那份表单不在（刷新过或换过设备），所以报告缺输入。'
            : '这次没算出结果——可能是网络断了，或请求超时了。系统没有替你猜一份。'}
        </div>
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={onBack} className="primary-btn px-4 py-2 text-xs">
            回表单再看一次
          </button>
          <button onClick={onReset} className="ghost-btn px-4 py-2 text-xs">
            回展厅首页
          </button>
        </div>
      </div>
    </div>
  )
}

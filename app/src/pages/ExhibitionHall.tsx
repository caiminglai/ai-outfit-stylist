import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { toast } from '../utils/toastOnce'
import {
  clearExpiredSession,
  createCustomerSession,
  deleteCustomerSession,
  getAccount,
  getCustomerRecommendation,
  getEngineRecommendation,
  getProfileArchive,
  getSessionId,
  saveProfileArchive,
  setGlobalErrorHandler,
  syncCustomerToCloud,
} from '../api'
import { useResponsive } from '../hooks/useResponsive'
import type { CustomerProfile, EngineRecommendation, ProfileTag } from '../types'
import { ModelViewer } from './exhibition/ModelViewer'
import { ServicePanel } from './exhibition/ServicePanel'
import type { Panel, ReportTab, ServiceMode, Stage } from './exhibition/stages'

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

  // 🔴 11-03 第 4 项：`?start=1` 是「这一屏开在哪个阶段」的输入，⛔ 由 effect 替顾客按下按钮
  // （那是 `react-hooks/set-state-in-effect` 记的同步 setState），现在直接在初值里读出来。
  // 地址栏上撤掉那一个查询参数仍留在下面的 effect 里——它只动浏览器历史，不动 state。
  const [stage, setStage] = useState<Stage>(() =>
    new URLSearchParams(window.location.search).get('start') === '1' ? 'mode-select' : 'standby',
  )
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

  // 🔴 第十四阶段·第一步 X1：从 `/gallery` 独立页跳过来时带 `?start=1`。服务态这一半现在由 `stage`
  // 的初值直接读出（见上面 `useState<Stage>` 那三行注释），这里只剩另一半：把这一个查询参数从地址栏撤掉
  // （⛔ 让它留着：刷新一次就重开一次服务态，等于地址栏在替用户做主）。
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('start') !== '1') return
    q.delete('start')
    const rest = q.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''))
  }, [])

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

  // 2026-10-29 体型驱动：把顾客/档案里已填的六格身体尺寸同步给展厅 iframe 的 3D 模特。
  // 取 `profile ?? archiveProfile`（本次提交的优先，其次是长期档案的草稿）；两份都没有就送 null，
  // 展厅侧恢复默认体型。缺哪个字段展厅就不动哪根轴——与"缺测不出分"同一条纪律。
  const postBodyToGallery = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    const src = profile ?? archiveProfile
    const body = src
      ? {
          height: src.height,
          weight: src.weight,
          bust: src.bust,
          waist: src.waist,
          hip: src.hip,
          shoulder: src.shoulder,
        }
      : null
    iframe.contentWindow.postMessage({ type: 'set-body', body }, window.location.origin)
  }, [profile, archiveProfile])

  useEffect(() => {
    postBodyToGallery()
  }, [postBodyToGallery])

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'set-mode', mode: stage }, window.location.origin)
    }
    // 体型驱动：iframe 重载后 gallery 侧状态清零，必须补发一次当前尺寸
    postBodyToGallery()
  }, [stage, postBodyToGallery])

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

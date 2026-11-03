/**
 * 跨柜联动报告主组件
 * 负责Tab切换、API调用、状态管理
 * 子组件已拆分至 ui/ 和同级业务组件文件
 */

import { useCallback, useState } from 'react'
import type {
  CustomerProfile,
  CrossCabinetRecommendation,
  SeasonalReminder,
  BrandPreference,
  CabinetHealth,
} from '../types'
import {
  getCrossCabinetRecommend,
  getSeasonalReminder,
  getBrandPreference,
  getCabinetHealth,
} from '../api'
import LoadingSpinner from './ui/LoadingSpinner'
import ErrorMessage from './ui/ErrorMessage'
import ErrorBoundary from './ErrorBoundary'
import CrossCabinetMatch from './CrossCabinetMatch'
import CrossCabinetSeasonal from './CrossCabinetSeasonal'
import CrossCabinetBrand from './CrossCabinetBrand'
import CrossCabinetHealth from './CrossCabinetHealth'

// 常量

const OCCASIONS = ['上班通勤', '约会', '派对', '面试', '日常', '运动', '婚礼'] as const

const TABS = [
  { key: 'occasion', label: '场合推荐', icon: '🎯' },
  { key: 'seasonal', label: '季节提醒', icon: '🌤' },
  { key: 'brand', label: '品牌偏好', icon: '🏷' },
  { key: 'health', label: '健康检查', icon: '🩺' },
] as const

type TabKey = (typeof TABS)[number]['key']

interface CrossCabinetReportProps {
  profile?: CustomerProfile | null
  compact?: boolean
}

export default function CrossCabinetReport({ profile, compact }: CrossCabinetReportProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('occasion')

  // 各 Tab 状态
  const [selectedOccasion, setSelectedOccasion] = useState<string>('')
  const [crossData, setCrossData] = useState<CrossCabinetRecommendation | null>(null)
  const [crossLoading, setCrossLoading] = useState(false)
  const [crossError, setCrossError] = useState<string>('')

  const [seasonalData, setSeasonalData] = useState<SeasonalReminder | null>(null)
  const [seasonalLoading, setSeasonalLoading] = useState(false)
  const [seasonalError, setSeasonalError] = useState<string>('')

  const [brandData, setBrandData] = useState<BrandPreference | null>(null)
  const [brandLoading, setBrandLoading] = useState(false)
  const [brandError, setBrandError] = useState<string>('')

  const [healthData, setHealthData] = useState<CabinetHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState<string>('')

  // ========== 数据获取 ==========

  const fetchCrossRecommend = useCallback(
    async (occasion: string) => {
      if (!occasion) return
      setCrossLoading(true)
      setCrossError('')
      setCrossData(null)
      try {
        const data = await getCrossCabinetRecommend(occasion, profile ?? undefined)
        setCrossData(data)
      } catch (e: unknown) {
        setCrossError(e instanceof Error ? e.message : '获取推荐失败')
      } finally {
        setCrossLoading(false)
      }
    },
    [profile],
  )

  const handleOccasionSelect = (occ: string) => {
    setSelectedOccasion(occ)
    fetchCrossRecommend(occ)
  }

  // 🔴 11-03 第 4 项：原来这三档挂在「effect 监听 activeTab ⇒ 切过去就同步 setState 再发请求」上，
  // 那正是 `react-hooks/set-state-in-effect` 记的写法（promise 链的成因见 `AccessoryTab.tsx` 同段注释）。
  // 现在取数函数里三格写全在 promise 回调里，两个复位（挂起态、上一次的读数错误）留在事件处理器；
  // 触发口从 effect 换成下面 `handleTabClick` 里的同款守卫——只有「点进这一档且从没取过」才发，逐字照旧。
  const fetchSeasonal = useCallback(() => {
    return getSeasonalReminder()
      .then(setSeasonalData)
      .catch((e: unknown) => {
        setSeasonalError(e instanceof Error ? e.message : '获取季节提醒失败')
      })
      .finally(() => setSeasonalLoading(false))
  }, [])

  const fetchBrand = useCallback(() => {
    return getBrandPreference()
      .then(setBrandData)
      .catch((e: unknown) => {
        setBrandError(e instanceof Error ? e.message : '获取品牌偏好失败')
      })
      .finally(() => setBrandLoading(false))
  }, [])

  const fetchHealth = useCallback(() => {
    return getCabinetHealth()
      .then(setHealthData)
      .catch((e: unknown) => {
        setHealthError(e instanceof Error ? e.message : '获取健康检查失败')
      })
      .finally(() => setHealthLoading(false))
  }, [])

  /** 点 Tab：换过去 + 这一档还没取过时取一次（原 effect 的守卫搬到这里，条件一字未动） */
  const handleTabClick = (key: TabKey) => {
    setActiveTab(key)
    if (key === 'seasonal' && !seasonalData && !seasonalLoading && !seasonalError) {
      setSeasonalLoading(true)
      fetchSeasonal()
    }
    if (key === 'brand' && !brandData && !brandLoading && !brandError) {
      setBrandLoading(true)
      fetchBrand()
    }
    if (key === 'health' && !healthData && !healthLoading && !healthError) {
      setHealthLoading(true)
      fetchHealth()
    }
  }

  /** 读数失败之后点「重试」：先把上一次的错误与挂起态复位，再取（⛔ 这两格别搬回取数函数里） */
  const retrySeasonal = () => {
    setSeasonalError('')
    setSeasonalLoading(true)
    fetchSeasonal()
  }

  const retryBrand = () => {
    setBrandError('')
    setBrandLoading(true)
    fetchBrand()
  }

  const retryHealth = () => {
    setHealthError('')
    setHealthLoading(true)
    fetchHealth()
  }

  const paddingClass = compact ? 'p-2 space-y-2' : 'p-3 space-y-3'

  return (
    <div className={paddingClass}>
      {/* Tab 切换栏 */}
      <div className="flex gap-1 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.key)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: 场合推荐 */}
      {activeTab === 'occasion' && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex flex-wrap gap-1.5">
            {OCCASIONS.map((occ) => (
              <button
                key={occ}
                className={`opt-btn ${selectedOccasion === occ ? 'active' : ''}`}
                onClick={() => handleOccasionSelect(occ)}
                disabled={crossLoading}
              >
                {occ}
              </button>
            ))}
          </div>
          {crossLoading && <LoadingSpinner text="正在分析跨柜搭配..." />}
          {crossError && (
            <ErrorMessage
              message={crossError}
              onRetry={() => fetchCrossRecommend(selectedOccasion)}
            />
          )}
          {crossData && !crossLoading && (
            <ErrorBoundary>
              <CrossCabinetMatch crossData={crossData} />
            </ErrorBoundary>
          )}
          {!crossData && !crossLoading && !crossError && (
            <div className="glass-card p-6 text-center animate-fade-in">
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>请选择场合查看跨柜推荐</div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 季节提醒 */}
      {activeTab === 'seasonal' && (
        <div className="space-y-3 animate-fade-in">
          {seasonalLoading && <LoadingSpinner text="正在获取季节提醒..." />}
          {seasonalError && <ErrorMessage message={seasonalError} onRetry={retrySeasonal} />}
          {seasonalData && typeof seasonalData === 'object' && !seasonalLoading && (
            <ErrorBoundary>
              <CrossCabinetSeasonal seasonalData={seasonalData} />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* Tab 3: 品牌偏好 */}
      {activeTab === 'brand' && (
        <div className="space-y-3 animate-fade-in">
          {brandLoading && <LoadingSpinner text="正在分析品牌偏好..." />}
          {brandError && <ErrorMessage message={brandError} onRetry={retryBrand} />}
          {brandData && !brandLoading && (
            <ErrorBoundary>
              <CrossCabinetBrand brandData={brandData} />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* Tab 4: 健康检查 */}
      {activeTab === 'health' && (
        <div className="space-y-3 animate-fade-in">
          {healthLoading && <LoadingSpinner text="正在检查三柜健康..." />}
          {healthError && <ErrorMessage message={healthError} onRetry={retryHealth} />}
          {healthData && !healthLoading && (
            <ErrorBoundary>
              <CrossCabinetHealth healthData={healthData} />
            </ErrorBoundary>
          )}
        </div>
      )}
    </div>
  )
}

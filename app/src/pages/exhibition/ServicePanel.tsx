// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（2 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import { Suspense } from 'react'
import ErrorMessage from '../../components/ui/ErrorMessage'
import type { CustomerProfile, EngineRecommendation, ProfileTag } from '../../types'
import { ServiceLinkCards } from './ServiceLinkCards'
import {
  CabinetManager,
  CrossCabinetReport,
  CustomerForm,
  PersonalProfileForm,
  RecommendationReport,
  RuleBrowser,
} from './lazy'
import type { ReportTab, ServiceMode, Stage } from './stages'

// ============ 服务面板 ============
export interface ServicePanelProps {
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

export function ServicePanel(props: ServicePanelProps) {
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

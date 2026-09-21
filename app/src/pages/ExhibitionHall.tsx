import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'sonner';
import {
  clearExpiredSession,
  createCustomerSession,
  deleteCustomerSession,
  getCustomerRecommendation,
  getEngineRecommendation,
  getSessionId,
  setGlobalErrorHandler,
  syncCustomerToCloud,
} from '../api';
import { useResponsive } from '../hooks/useResponsive';
import type { CustomerProfile, EngineRecommendation } from '../types';

// 代码分割:按需加载重型组件,减小首屏 bundle 体积
const CustomerForm = lazy(() => import('../components/CustomerForm'));
const PersonalProfileForm = lazy(() => import('../components/PersonalProfileForm'));
const RecommendationReport = lazy(() => import('../components/RecommendationReport'));
const CabinetManager = lazy(() => import('../components/CabinetManager'));
const CrossCabinetReport = lazy(() => import('../components/CrossCabinetReport'));
const RuleBrowser = lazy(() => import('../components/RuleBrowser'));

/**
 * 3D模型展厅 + 形象服务一体化页面
 *
 * 支持双模式:
 *   门店模式(store): 8字段快速采集 → 推荐 → 同步/删除
 *   个人模式(personal): 50+字段深度采集 → 推荐 → 橱柜管理 → 跨柜推荐
 */

type Stage = 'standby' | 'mode-select' | 'form' | 'report' | 'rules';
type Panel = 'model' | 'service';
type ServiceMode = 'store' | 'personal';
type ReportTab = 'recommendation' | 'cabinet' | 'cross' | 'rules';

export default function ExhibitionHall() {
  // 页面加载时主动清理过期 Session
  useEffect(() => {
    clearExpiredSession();
  }, []);

  const responsive = useResponsive();
  const { mode: layoutMode } = responsive;

  const [stage, setStage] = useState<Stage>('standby');
  const [mobilePanel, setMobilePanel] = useState<Panel>('service');
  const [serviceMode, setServiceMode] = useState<ServiceMode>('store');

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<EngineRecommendation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  const [reportTab, setReportTab] = useState<ReportTab>('recommendation');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 提交数据 -> 获取推荐
  const handleSubmit = useCallback(async (p: CustomerProfile) => {
    setSubmitting(true);
    setProfile(p);
    let createdSessionId: string | null = null;
    try {
      if (serviceMode === 'store') {
        const session = await createCustomerSession(p);
        createdSessionId = session.session_id;
        setSessionId(createdSessionId);
        const result = await getCustomerRecommendation(createdSessionId, 'store');
        setRecommendation(result.recommendation);
      } else {
        const result = await getEngineRecommendation(p, 'personal');
        setRecommendation(result.recommendation);
        setSessionId(getSessionId());
      }
      setStage('report');
    } catch (e: unknown) {
      // 门店模式:如果第1步成功但第2步失败,清理孤儿 session
      if (serviceMode === 'store' && createdSessionId) {
        try { await deleteCustomerSession(createdSessionId); } catch { /* 静默清理 */ }
        setSessionId(null);
      }
      toast.error(e instanceof Error ? e.message : '获取推荐失败');
    } finally {
      setSubmitting(false);
    }
  }, [serviceMode]);

  const handleSync = useCallback(async () => {
    if (!sessionId) return;
    setSyncing(true);
    try {
      await syncCustomerToCloud(sessionId);
      setSynced(true);
      toast.success('数据已同步到门店');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  }, [sessionId]);

  const handleDelete = useCallback(async () => {
    if (!sessionId) return;
    try {
      await deleteCustomerSession(sessionId);
      toast.success('您的数据已删除');
      resetToStandby();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }, [sessionId]);

  const resetToStandby = useCallback(() => {
    setStage('standby');
    setProfile(null);
    setSessionId(null);
    setRecommendation(null);
    setSynced(false);
    setReportTab('recommendation');
  }, []);

  const handleBack = useCallback(() => {
    setStage('form');
    setRecommendation(null);
  }, []);

  const startService = useCallback(() => {
    setStage('mode-select');
    setMobilePanel('service');
  }, []);

  const selectMode = useCallback((mode: ServiceMode) => {
    setServiceMode(mode);
    setStage('form');
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // 安全:只接受同源 postMessage,防止跨域攻击
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'start-service') startService();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [startService]);

  // 注册全局网络错误处理器
  useEffect(() => {
    setGlobalErrorHandler((msg: string) => {
      toast.error(msg);
    });
    return () => setGlobalErrorHandler(null);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'set-mode', mode: stage }, window.location.origin);
    }
  }, [stage]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'set-mode', mode: stage }, window.location.origin);
    }
  }, [stage]);

  const isSplitScreen = layoutMode === 'desktop-landscape' || layoutMode === 'mobile-landscape';

  // 待机态
  if (stage === 'standby') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'radial-gradient(ellipse at center, #182030 0%, #0d1117 70%)' }}>
        <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
        <Toaster />
      </div>
    );
  }

  // 手机竖屏
  if (!isSplitScreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
        <div className="flex z-20" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
          <button
            onClick={() => setMobilePanel('model')}
            className={`tab-btn ${mobilePanel === 'model' ? 'active' : ''}`}
            style={{ borderRadius: 0, borderBottom: 'none', borderTop: 'none', borderLeft: 'none', borderRight: '1px solid var(--line)' }}
          >✨ 3D模型</button>
          <button
            onClick={() => setMobilePanel('service')}
            className={`tab-btn ${mobilePanel === 'service' ? 'active' : ''}`}
            style={{ borderRadius: 0, borderBottom: 'none', borderTop: 'none', borderRight: 'none' }}
          >{stage === 'report' ? '📋 建议报告' : stage === 'mode-select' ? '🎯 选择模式' : '📝 信息填写'}</button>
        </div>
        <div className="flex-1 relative overflow-hidden">
          <div className={`absolute inset-0 transition-opacity duration-300 ${mobilePanel === 'model' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
            <button onClick={() => setStage('standby')} className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-lg ghost-btn"
              style={{ background: 'rgba(13,17,23,0.8)', backdropFilter: 'blur(12px)' }}>←</button>
          </div>
          <div className={`absolute inset-0 transition-opacity duration-300 ${mobilePanel === 'service' ? 'opacity-100 z-10 overflow-y-auto' : 'opacity-0 z-0 pointer-events-none'}`}
            style={{ background: 'var(--panel)' }}>
            <div className="p-4">
              <ServicePanel
                stage={stage} serviceMode={serviceMode} profile={profile} sessionId={sessionId}
                recommendation={recommendation} submitting={submitting} syncing={syncing} synced={synced}
                reportTab={reportTab}
                onSubmit={handleSubmit} onSync={handleSync} onDelete={handleDelete}
                onBack={handleBack} onSelectMode={selectMode} onReset={resetToStandby}
                onReportTabChange={setReportTab} onStageChange={setStage}
              />
            </div>
          </div>
        </div>
        <Toaster />
      </div>
    );
  }

  // 分屏模式
  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: 'var(--bg)' }}>
      <div className="relative h-full split-left" style={{ flex: '1 1 auto', minWidth: 0, background: 'radial-gradient(ellipse at center, #182030 0%, #0d1117 70%)' }}>
        <ModelViewer iframeRef={iframeRef} onLoad={handleIframeLoad} />
        <button onClick={() => setStage('standby')} className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-lg ghost-btn"
          style={{ background: 'rgba(13,17,23,0.8)', backdropFilter: 'blur(12px)' }}>←</button>
      </div>
      <div className="split-right h-full overflow-y-auto" style={{ flex: '0 0 420px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', padding: '20px 18px 14px' }}>
        <ServicePanel
          stage={stage} serviceMode={serviceMode} profile={profile} sessionId={sessionId}
          recommendation={recommendation} submitting={submitting} syncing={syncing} synced={synced}
          reportTab={reportTab}
          onSubmit={handleSubmit} onSync={handleSync} onDelete={handleDelete}
          onBack={handleBack} onSelectMode={selectMode} onReset={resetToStandby}
          onReportTabChange={setReportTab} onStageChange={setStage} compact
        />
      </div>
      <Toaster />
    </div>
  );
}

// ============ 3D模型查看器 ============
function ModelViewer({ iframeRef, onLoad }: { iframeRef: React.RefObject<HTMLIFrameElement | null>; onLoad?: () => void; }) {
  return (
    <iframe ref={iframeRef} src="/gallery" className="w-full h-full" title="3D模型展厅" allow="camera; microphone" onLoad={onLoad} />
  );
}

// ============ 服务面板 ============
interface ServicePanelProps {
  stage: Stage;
  serviceMode: ServiceMode;
  profile: CustomerProfile | null;
  sessionId: string | null;
  recommendation: EngineRecommendation | null;
  submitting: boolean;
  syncing: boolean;
  synced: boolean;
  reportTab: ReportTab;
  onSubmit: (p: CustomerProfile) => void;
  onSync: () => void;
  onDelete: () => void;
  onBack: () => void;
  onSelectMode: (mode: ServiceMode) => void;
  onReset: () => void;
  onReportTabChange: (tab: ReportTab) => void;
  /** 切换页面阶段(用于进入/退出规则浏览器等独立页) */
  onStageChange: (stage: Stage) => void;
  compact?: boolean;
}

function ServicePanel(props: ServicePanelProps) {
  const { stage, serviceMode, profile, sessionId, recommendation, submitting, syncing, synced, reportTab,
    onSubmit, onSync, onDelete, onBack, onSelectMode, onReset, onReportTabChange, onStageChange, compact } = props;

  // 头部
  const Header = (
    <header className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold gradient-text" style={{ letterSpacing: '0.3px', margin: 0 }}>
          形象数据中心
        </h1>
        {stage !== 'mode-select' && (
          <button onClick={onReset} className="ghost-btn text-xs px-2 py-1" style={{ color: 'var(--muted)' }}>
            ✕ 退出
          </button>
        )}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {stage === 'mode-select' && '请选择服务模式'}
        {stage === 'form' && (serviceMode === 'store' ? '门店快速服务 · 填写基础信息' : '个人深度分析 · 填写完整档案')}
        {stage === 'report' && '您的专属形象建议报告'}
        {stage === 'rules' && '了解系统如何根据你的档案生成建议'}
      </p>
    </header>
  );

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
              background: 'linear-gradient(135deg, rgba(110,231,199,0.15) 0%, rgba(110,231,199,0.05) 100%)',
              border: '2px solid var(--accent)',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(110,231,199,0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(110,231,199,0.25)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(110,231,199,0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🏪</span>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#8ef5d8' }}>门店快速模式</h3>
                <p className="text-xs" style={{ color: '#b8c7d4' }}>8个字段 · 快速推荐 · 门店同步</p>
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
              background: 'linear-gradient(135deg, rgba(192,132,252,0.15) 0%, rgba(192,132,252,0.05) 100%)',
              border: '2px solid #c084fc',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(192,132,252,0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(192,132,252,0.25)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(192,132,252,0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📱</span>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#d4a5ff' }}>个人深度模式</h3>
                <p className="text-xs" style={{ color: '#b8c7d4' }}>50+字段 · 算法分析 · 橱柜管理</p>
              </div>
            </div>
            <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
              适合个人深度使用,采集完整身材数据、五官细节、风格偏好,获得BMI/体型/肤色/脸型科学分析,管理衣橱/化妆品/配饰三柜,获取跨柜联动推荐和购物建议.
            </p>
          </button>
        </div>

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
    );
  }

  // 规则浏览器页(从模式选择页进入,帮助用户理解规则引擎)
  if (stage === 'rules') {
    return (
      <div className="animate-fade-in">
        <header className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold gradient-text" style={{ letterSpacing: '0.3px', margin: 0 }}>
              📖 规则说明
            </h1>
            <button onClick={() => onStageChange('mode-select')} className="ghost-btn text-xs px-2 py-1" style={{ color: 'var(--muted)' }}>
              ← 返回
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            了解系统如何根据你的档案生成建议
          </p>
        </header>
        <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
          <RuleBrowser initialMode={serviceMode} compact={compact} />
        </Suspense>
      </div>
    );
  }

  // 表单页
  if (stage === 'form') {
    return (
      <div className="animate-fade-in">
        {Header}
        <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
          {serviceMode === 'store' ? (
            <CustomerForm initial={profile || undefined} onSubmit={onSubmit} submitting={submitting} compact={compact} />
          ) : (
            <PersonalProfileForm initial={profile || undefined} onSubmit={onSubmit} submitting={submitting} compact={compact} />
          )}
        </Suspense>
      </div>
    );
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
          >📋 形象建议</button>
          {serviceMode === 'personal' && (
            <>
              <button
                onClick={() => onReportTabChange('cabinet')}
                className={`tab-btn ${reportTab === 'cabinet' ? 'active' : ''}`}
              >🗄 橱柜管理</button>
              <button
                onClick={() => onReportTabChange('cross')}
                className={`tab-btn ${reportTab === 'cross' ? 'active' : ''}`}
              >🔗 跨柜推荐</button>
            </>
          )}
          {/* 规则说明:门店/个人模式都显示,让用户对照推荐结果理解规则 */}
          <button
            onClick={() => onReportTabChange('rules')}
            className={`tab-btn ${reportTab === 'rules' ? 'active' : ''}`}
          >📖 规则说明</button>
        </div>

        {/* 推荐报告 */}
        {reportTab === 'recommendation' && (
          <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
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
            />
          </Suspense>
        )}

        {/* 橱柜管理 */}
        {reportTab === 'cabinet' && (
          <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
            <CabinetManager
              profile={profile}
              compact={compact}
            />
          </Suspense>
        )}

        {/* 跨柜推荐 */}
        {reportTab === 'cross' && (
          <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
            <CrossCabinetReport
              profile={profile}
              compact={compact}
            />
          </Suspense>
        )}

        {/* 规则说明:展示所有规则,让用户对照推荐结果理解"为什么推荐这个" */}
        {reportTab === 'rules' && (
          <Suspense fallback={<div className="text-center py-8" style={{ color: 'var(--muted)' }}>加载中...</div>}>
            <RuleBrowser initialMode={serviceMode} compact={compact} />
          </Suspense>
        )}
      </div>
    );
  }

  // 加载中
  return (
    <div className="animate-fade-in">
      {Header}
      <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
        <div className="spinner mx-auto mb-3"></div>
        加载中...
      </div>
    </div>
  );
}

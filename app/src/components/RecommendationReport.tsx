/** 建议报告页 - 门店/个人模式 + 天气/AI文案/星座/试穿增强功能 */
import { useState } from 'react';
import type { CustomerProfile, EngineRecommendation, InventoryProduct, RuleRecommendationItem, WeatherData } from '../types';
import InventoryCard from './InventoryCard';
import AlgorithmAnalysisCard from './recommend/AlgorithmAnalysis';
import EnhancedTextCard from './recommend/EnhancedTextCard';
import HoroscopeCard from './recommend/HoroscopeCard';
import { FIELD_LABELS, HIDDEN_FIELDS, TAB_LABEL, TABS } from './recommend/RecommendTab';
import TryonCard from './recommend/TryonCard';
import WeatherCard from './recommend/WeatherCard';

interface RecommendationReportProps {
  recommendation: EngineRecommendation;
  profile: CustomerProfile;
  mode: 'store' | 'personal';
  sessionId?: string;
  onSync?: () => void;
  onDelete?: () => void;
  onBack?: () => void;
  synced?: boolean;
  syncing?: boolean;
  compact?: boolean;
}

export default function RecommendationReport({
  recommendation, profile, mode, sessionId,
  onSync, onDelete, onBack, synced, syncing, compact,
}: RecommendationReportProps) {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['key']>('穿搭');
  // 天气数据,供 AI 文案增强使用
  const [weather, setWeather] = useState<WeatherData | null>(null);
  // 虚拟试穿面板展开状态
  const [tryonOpen, setTryonOpen] = useState(false);
  // "为什么推荐"展开状态(按 group_id 记录哪些卡片展开了)
  const [explainOpen, setExplainOpen] = useState<Record<number, boolean>>({});

  /** 切换某条推荐的"为什么推荐"展开/收起 */
  const toggleExplain = (groupId: number): void => {
    setExplainOpen((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const items: RuleRecommendationItem[] = recommendation[activeTab] || [];
  const inventory: InventoryProduct[] = recommendation.inventory?.[activeTab] || [];
  const analysis = recommendation.algorithm_analysis;

  return (
    <div className="space-y-3">
      {/* 顾客档案摘要 */}
      <div className="glass-card p-3" style={{ borderColor: 'var(--accent)' }}>
        <div className="flex items-center justify-between mb-2 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>形象建议报告</h2>
          <span className="pill-tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
            {mode === 'store' ? '🏪 门店推荐' : '📱 个人深度分析'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {profile.gender && <span className="pill-tag">{profile.gender}</span>}
          {profile.skin_tone && <span className="pill-tag">{profile.skin_tone}</span>}
          {profile.skin_tone_detail && <span className="pill-tag">{profile.skin_tone_detail}</span>}
          {profile.face_shape && <span className="pill-tag">{profile.face_shape}</span>}
          {profile.body_type && <span className="pill-tag">{profile.body_type}</span>}
          {profile.body_type_detail && <span className="pill-tag">{profile.body_type_detail}</span>}
          {profile.scenario && <span className="pill-tag">{profile.scenario}</span>}
          {profile.occasion && <span className="pill-tag">{profile.occasion}</span>}
          {profile.preferred_style && <span className="pill-tag">{profile.preferred_style}</span>}
          {profile.season && <span className="pill-tag">{profile.season}</span>}
        </div>
      </div>

      {/* 天气查询卡片 */}
      <WeatherCard onWeather={setWeather} />

      {/* 个人模式:算法分析报告 */}
      {mode === 'personal' && analysis && (
        <AlgorithmAnalysisCard analysis={analysis} />
      )}

      {/* 分类 Tab */}
      <div className="flex gap-1 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 推荐内容 */}
      <div className="space-y-2.5">
        {items.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>
            暂无{TAB_LABEL(activeTab)}推荐数据,请补充更多个人信息
          </div>
        ) : (
          items.map((item) => (
            <div key={item.group_id} className="glass-card p-3">
              {item.group_name && (
                <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{item.group_name}</span>
                  {item.score > 0 && (
                    <span className="pill-tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      匹配度 {item.score}
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                {Object.entries(item)
                  .filter(([k]) => !HIDDEN_FIELDS.includes(k))
                  .map(([key, val]) => {
                    const label = FIELD_LABELS[key] || key;
                    const isAvoid = key === 'avoid';
                    return (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>{label}</span>
                        <span className="flex-1" style={{
                          color: isAvoid ? 'var(--danger)' : 'var(--text)',
                          lineHeight: '1.5',
                        }}>{String(val)}</span>
                      </div>
                    );
                  })}
              </div>
              {item.explanation && item.explanation.命中条件.length > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px dashed var(--line)' }}>
                  <button
                    onClick={() => toggleExplain(item.group_id)}
                    className="text-xs flex items-center gap-1"
                    style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    <span>{explainOpen[item.group_id] ? '▼' : '▶'}</span>
                    <span>💡 为什么推荐这个?</span>
                  </button>
                  {explainOpen[item.group_id] && (
                    <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <div>这条推荐命中了以下条件:</div>
                      {item.explanation.命中条件.map((cond, i) => (
                        <div key={i} className="flex items-center gap-1" style={{ paddingLeft: '12px' }}>
                          <span style={{ color: 'var(--accent)' }}>✓</span>
                          <span>{cond}</span>
                        </div>
                      ))}
                      <div className="mt-1" style={{ fontSize: '11px' }}>
                        匹配分: {item.explanation.匹配分} · 优先级: {item.explanation.优先级}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* AI 文案增强 */}
      <EnhancedTextCard recommendation={recommendation} weather={weather} mode={mode} />

      {/* 库存匹配(门店模式) */}
      {mode === 'store' && inventory.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">📦</span>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text)' }}>门店库存匹配</h3>
            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>共 {inventory.length} 件</span>
          </div>
          <div className="space-y-2">
            {inventory.map(prod => (
              <InventoryCard key={prod.id} product={prod} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {/* 星座运势卡片 */}
      <HoroscopeCard />

      {/* 操作按钮 */}
      <div className="flex gap-2 pt-2">
        {onBack && (
          <button onClick={onBack} className="ghost-btn flex-1 py-2.5 text-sm">
            ← 重新填写
          </button>
        )}
        {mode === 'store' && sessionId && onSync && (
          <button
            onClick={onSync}
            disabled={synced || syncing}
            className={`flex-1 py-2.5 text-sm ${synced ? 'ghost-btn' : 'gradient-btn'}`}
            style={synced ? { color: 'var(--good)', borderColor: 'var(--good)' } : {}}
          >
            {syncing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
                同步中...
              </span>
            ) : synced ? '✓ 已同步门店' : '☁ 同步到门店'}
          </button>
        )}
        {mode === 'store' && sessionId && onDelete && (
          <button
            onClick={onDelete}
            className="ghost-btn flex-1 py-2.5 text-sm"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            🗑 删除我的数据
          </button>
        )}
        <button
          onClick={() => setTryonOpen(!tryonOpen)}
          className="ghost-btn flex-1 py-2.5 text-sm"
          style={tryonOpen ? { color: '#34d399', borderColor: '#34d399' } : {}}
        >
          {tryonOpen ? '✕ 收起试穿' : '👗 虚拟试穿'}
        </button>
      </div>

      {/* 虚拟试穿表单 */}
      {tryonOpen && <TryonCard />}
    </div>
  );
}

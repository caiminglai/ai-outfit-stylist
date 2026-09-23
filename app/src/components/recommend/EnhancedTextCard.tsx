/**
 * AI 文案增强卡片组件
 *
 * 调用后端接口，将推荐结果和天气数据结合，生成个性化推荐文案
 */
import { useState } from 'react';
import type { EngineRecommendation, WeatherData, EnhancedText } from '../../types';
import { enhanceRecommendationText } from '../../api';

interface EnhancedTextCardProps {
  /** 推荐数据 */
  recommendation: EngineRecommendation;
  /** 天气数据（可选，结合天气生成更精准的文案） */
  weather: WeatherData | null;
  /** 当前模式：门店 / 个人 */
  mode: 'store' | 'personal';
}

export default function EnhancedTextCard({
  recommendation, weather, mode,
}: EnhancedTextCardProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnhance(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result: EnhancedText = await enhanceRecommendationText(recommendation, weather, mode);
      setText(result.text);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '增强失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-3" style={{ borderColor: '#a78bfa' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">✨</span>
          <h3 className="text-sm font-semibold" style={{ color: '#a78bfa' }}>AI 文案增强</h3>
        </div>
        <button
          onClick={handleEnhance}
          disabled={loading}
          className="gradient-btn text-xs px-3 py-1.5"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="spinner" style={{ width: '12px', height: '12px' }}></span>
              生成中...
            </span>
          ) : text ? '重新生成' : '生成文案'}
        </button>
      </div>
      {error && (
        <div className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{error}</div>
      )}
      {loading && !text && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>正在生成个性化推荐文案，请稍候...</div>
      )}
      {text && (
        <div
          className="text-xs"
          style={{ color: 'var(--text)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

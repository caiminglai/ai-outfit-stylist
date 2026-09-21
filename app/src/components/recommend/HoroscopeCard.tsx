/**
 * 星座运势卡片组件
 *
 * 查询今日星座运势，展示心情、幸运色/数字、运势概述和穿搭建议
 */
import { useState } from 'react';
import type { HoroscopeData } from '../../types';
import { getDailyHoroscope } from '../../api';

/** 12 星座选项 */
const ZODIAC_OPTIONS: { key: string; label: string }[] = [
  { key: 'aries', label: '♈ 白羊' },
  { key: 'taurus', label: '♉ 金牛' },
  { key: 'gemini', label: '♊ 双子' },
  { key: 'cancer', label: '♋ 巨蟹' },
  { key: 'leo', label: '♌ 狮子' },
  { key: 'virgo', label: '♍ 处女' },
  { key: 'libra', label: '♎ 天秤' },
  { key: 'scorpio', label: '♏ 天蝎' },
  { key: 'sagittarius', label: '♐ 射手' },
  { key: 'capricorn', label: '♑ 摩羯' },
  { key: 'aquarius', label: '♒ 水瓶' },
  { key: 'pisces', label: '♓ 双鱼' },
];

export default function HoroscopeCard() {
  const [selected, setSelected] = useState<string>('');
  const [data, setData] = useState<HoroscopeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleQuery(zodiac: string): Promise<void> {
    setSelected(zodiac);
    setLoading(true);
    setError(null);
    try {
      const result = await getDailyHoroscope(zodiac);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '查询失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-3" style={{ borderColor: '#fbbf24' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">🔮</span>
        <h3 className="text-sm font-semibold" style={{ color: '#fbbf24' }}>今日星座运势</h3>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {ZODIAC_OPTIONS.map(z => (
          <button
            key={z.key}
            onClick={() => handleQuery(z.key)}
            className={`pill-tag text-xs ${selected === z.key ? 'active' : ''}`}
            style={selected === z.key ? {
              color: '#fbbf24', borderColor: '#fbbf24',
            } : {}}
          >
            {z.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{error}</div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span className="spinner" style={{ width: '12px', height: '12px' }}></span>
          查询中...
        </div>
      )}
      {data && !loading && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>星座</span>
            <span style={{ color: 'var(--text)' }}>{data.zodiac_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>心情</span>
            <span className="pill-tag" style={{ fontSize: '10px' }}>{data.mood}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>幸运色</span>
            <span style={{ color: 'var(--text)' }}>{data.lucky_color}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>幸运数字</span>
            <span style={{ color: 'var(--text)' }}>{data.lucky_number}</span>
          </div>
          <div className="flex items-start gap-2 pt-1.5 mt-1" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>运势概述</span>
            <span style={{ color: 'var(--text)', lineHeight: '1.5' }}>{data.summary}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>穿搭建议</span>
            <span style={{ color: 'var(--text)', lineHeight: '1.5' }}>{data.suggestion}</span>
          </div>
        </div>
      )}
    </div>
  );
}

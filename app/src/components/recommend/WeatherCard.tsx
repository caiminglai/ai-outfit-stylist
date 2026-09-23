/**
 * 天气查询卡片组件
 *
 * 根据城市查询天气，输出穿衣策略建议，并通过回调将天气数据传递给父组件
 */
import { useState } from 'react';
import type { WeatherProfile, WeatherData } from '../../types';
import { getWeatherProfile } from '../../api';

interface WeatherCardProps {
  /** 天气数据回调，供父组件（如 AI 文案增强）使用 */
  onWeather: (w: WeatherData | null) => void;
}

export default function WeatherCard({ onWeather }: WeatherCardProps) {
  const [location, setLocation] = useState('');
  const [profile, setProfile] = useState<WeatherProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleQuery(): Promise<void> {
    if (!location.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const p = await getWeatherProfile(location.trim());
      setProfile(p);
      onWeather(p.weather);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '查询失败');
      setProfile(null);
      onWeather(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-3" style={{ borderColor: '#38bdf8' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">🌤</span>
        <h3 className="text-sm font-semibold" style={{ color: '#38bdf8' }}>天气与穿衣策略</h3>
      </div>
      <div className="flex gap-1.5 mb-2">
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleQuery(); }}
          placeholder="输入城市名，如 北京 / 上海"
          className="form-input flex-1 text-xs"
          style={{ padding: '6px 10px' }}
        />
        <button
          onClick={handleQuery}
          disabled={loading || !location.trim()}
          className="gradient-btn text-xs px-3"
        >
          {loading ? <span className="spinner" style={{ width: '12px', height: '12px' }}></span> : '查询'}
        </button>
      </div>
      {error && (
        <div className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{error}</div>
      )}
      {profile && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>城市</span>
            <span style={{ color: 'var(--text)' }}>{profile.weather.location}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>温度</span>
            <span style={{ color: 'var(--text)' }}>{profile.weather.temperature}°C</span>
            <span style={{ color: 'var(--muted)' }}>体感 {profile.weather.feelsLike}°C</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>天气</span>
            <span style={{ color: 'var(--text)' }}>{profile.weather.condition}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>湿度</span>
            <span style={{ color: 'var(--text)' }}>{profile.weather.humidity}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>风力</span>
            <span style={{ color: 'var(--text)' }}>{profile.weather.windDir} {profile.weather.windScale}级</span>
          </div>
          <div className="flex items-start gap-2 pt-1.5 mt-1" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>穿衣策略</span>
            <span style={{ color: 'var(--text)', lineHeight: '1.5' }}>
              <span className="pill-tag" style={{ fontSize: '10px', marginRight: '4px' }}>{profile.profile.level}</span>
              {profile.profile.advice}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

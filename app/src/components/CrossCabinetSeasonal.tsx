/**
 * 跨柜季节提醒面板
 * 展示当季衣橱/化妆品/配饰的建议和统计
 */

import type { SeasonalReminder } from '../types';

/** 季节提醒面板 props */
interface CrossCabinetSeasonalProps {
  /** 季节提醒数据 */
  seasonalData: SeasonalReminder;
}

/** 根据季节返回对应图标 */
function getSeasonIcon(season: string): string {
  if (season === '春') return '🌸';
  if (season === '夏') return '☀️';
  if (season === '秋') return '🍂';
  return '❄️';
}

/**
 * 将旧版 API 返回格式（reminders + summary）规范化为新格式
 * 兼容后端未重启时返回旧格式数据的情况
 */
function normalizeData(raw: Record<string, unknown>): SeasonalReminder {
  // 如果已经是新格式（有 wardrobe 字段），直接用
  if (raw.wardrobe && raw.tips) {
    return raw as unknown as SeasonalReminder;
  }

  // 旧格式兼容：从 reminders 数组中提取信息
  const reminders = (raw.reminders as Record<string, unknown>[]) || [];
  const summary = (raw.summary as Record<string, number>) || {};

  const findReminder = (cabinet: string) =>
    reminders.find((r) => r.cabinet === cabinet);

  const wardrobeReminder = findReminder('wardrobe');
  const cosmeticReminder = findReminder('cosmetic');
  const accessoryReminder = findReminder('accessory');

  const wardrobeTotal = summary.wardrobe_count ?? 0;
  const cosmeticTotal = summary.cosmetic_count ?? 0;
  const accessoryTotal = summary.accessory_count ?? 0;

  return {
    current_season: (raw.current_season as string) || '未知',
    tips: {
      outfit: (wardrobeReminder?.message as string) || '暂无衣橱提醒',
      cosmetic: (cosmeticReminder?.message as string) || '化妆品状态良好',
      accessory: (accessoryReminder?.message as string) || '暂无配饰提醒',
    },
    wardrobe: {
      total: wardrobeTotal,
      season_items: wardrobeTotal,
      need_attention: !!wardrobeReminder,
    },
    cosmetic: {
      total: cosmeticTotal,
      tip: cosmeticReminder?.message || '化妆品状态良好',
    },
    accessory: {
      total: accessoryTotal,
      season_items: accessoryTotal,
      need_attention: !!accessoryReminder,
    },
  };
}

/** 季节提醒面板 */
export default function CrossCabinetSeasonal({ seasonalData }: CrossCabinetSeasonalProps) {
  // 规范化数据，兼容旧格式
  const data = normalizeData(seasonalData);

  return (
    <>
      {/* 季节标题 */}
      <div className="text-center py-2">
        <span style={{ fontSize: 28, display: 'block', marginBottom: 4 }}>
          {getSeasonIcon(data.current_season)}
        </span>
        <span className="gradient-text" style={{ fontSize: 18, fontWeight: 700 }}>
          {data.current_season}季衣橱提醒
        </span>
      </div>

      {/* 衣橱卡片 */}
      <div className="glass-card p-3 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 14, fontWeight: 600 }}>👗 衣橱建议</span>
          {data.wardrobe?.need_attention && (
            <span className="pill-tag" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
              ⚠ 需关注
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>
          {data.tips?.outfit || '暂无建议'}
        </p>
        <div className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {data.wardrobe?.season_items ?? 0}
          </span>
          <span style={{ color: 'var(--muted)' }}>/ {data.wardrobe?.total ?? 0} 件当季衣物</span>
        </div>
      </div>

      {/* 化妆品卡片 */}
      <div className="glass-card p-3 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 14, fontWeight: 600 }}>💄 化妆品建议</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>
          {data.tips?.cosmetic || data.cosmetic?.tip || '暂无建议'}
        </p>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {data.cosmetic?.total ?? 0}
          </span>
          <span style={{ color: 'var(--muted)' }}> 件化妆品</span>
        </div>
      </div>

      {/* 配饰卡片 */}
      <div className="glass-card p-3 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 14, fontWeight: 600 }}>💎 配饰建议</span>
          {data.accessory?.need_attention && (
            <span className="pill-tag" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
              ⚠ 需关注
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>
          {data.tips?.accessory || '暂无建议'}
        </p>
        <div className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {data.accessory?.season_items ?? 0}
          </span>
          <span style={{ color: 'var(--muted)' }}>/ {data.accessory?.total ?? 0} 件当季配饰</span>
        </div>
      </div>
    </>
  );
}

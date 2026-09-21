/**
 * 跨柜品牌偏好面板
 * 展示衣橱/化妆品/配饰的品牌分布和风格偏好
 */

import type { BrandPreference, BrandCount } from '../types';

// ============================================================
// 数据规范化 —— 兼容后端旧格式返回
// ============================================================

function normalizeData(raw: Record<string, unknown>): BrandPreference {
  // 如果已经是新格式（有 wardrobe_brands 字段），直接用
  if (raw.wardrobe_brands !== undefined || raw.cosmetic_brands !== undefined) {
    return {
      wardrobe_brands: Array.isArray(raw.wardrobe_brands) ? raw.wardrobe_brands as BrandCount[] : [],
      cosmetic_brands: Array.isArray(raw.cosmetic_brands) ? raw.cosmetic_brands as BrandCount[] : [],
      accessory_brands: Array.isArray(raw.accessory_brands) ? raw.accessory_brands as BrandCount[] : [],
      price_range: (raw.price_range as BrandPreference['price_range']) ?? {
        wardrobe: { min: 0, max: 0, avg: 0, count: 0 },
        cosmetic: { min: 0, max: 0, avg: 0, count: 0 },
        accessory: { min: 0, max: 0, avg: 0, count: 0 },
      },
      style_preferences: Array.isArray(raw.style_preferences) ? raw.style_preferences as string[] : [],
      summary: (raw.summary as BrandPreference['summary']) ?? {
        wardrobe_count: 0,
        cosmetic_count: 0,
        accessory_count: 0,
      },
    };
  }

  // 旧格式兼容：top_brands + by_cabinet
  const topBrands = Array.isArray(raw.top_brands) ? raw.top_brands as BrandCount[] : [];
  const byCabinet = (raw.by_cabinet as Record<string, Record<string, number>>) || {};

  const toBrandList = (obj: Record<string, number> | undefined): BrandCount[] => {
    if (!obj) return [];
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([brand, count]) => ({ brand, count }));
  };

  const summary = (raw.summary as BrandPreference['summary']) ?? {
    wardrobe_count: 0,
    cosmetic_count: 0,
    accessory_count: 0,
  };

  return {
    wardrobe_brands: topBrands,
    cosmetic_brands: toBrandList(byCabinet.cosmetic),
    accessory_brands: toBrandList(byCabinet.accessory),
    price_range: {
      wardrobe: { min: 0, max: 0, avg: 0, count: summary.wardrobe_count },
      cosmetic: { min: 0, max: 0, avg: 0, count: summary.cosmetic_count },
      accessory: { min: 0, max: 0, avg: 0, count: summary.accessory_count },
    },
    style_preferences: [],
    summary,
  };
}

// ============================================================
// 品牌偏好面板
// ============================================================

/** 品牌偏好面板 props */
interface CrossCabinetBrandProps {
  /** 品牌偏好数据 */
  brandData: BrandPreference;
}

/** 品牌列表渲染 */
function BrandList({ title, icon, brands, totalCount }: { title: string; icon: string; brands: BrandCount[]; totalCount: number }) {
  const safeBrands = brands ?? [];
  return (
    <div className="glass-card p-3 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <span style={{ fontSize: 14, fontWeight: 600 }}>{icon} {title}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>共 {totalCount ?? 0} 件</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {safeBrands.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>暂无品牌数据</span>
        )}
        {safeBrands.map((b, i) => (
          <span key={i} className="pill-tag">
            {b.brand} <span style={{ color: 'var(--accent)', marginLeft: 4 }}>{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 品牌偏好面板 */
export default function CrossCabinetBrand({ brandData }: CrossCabinetBrandProps) {
  const data = normalizeData(brandData as unknown as Record<string, unknown>);
  const summary = data.summary ?? { wardrobe_count: 0, cosmetic_count: 0, accessory_count: 0 };

  return (
    <>
      <BrandList
        title="衣橱品牌" icon="👗"
        brands={data.wardrobe_brands}
        totalCount={summary.wardrobe_count}
      />
      <BrandList
        title="化妆品品牌" icon="💄"
        brands={data.cosmetic_brands}
        totalCount={summary.cosmetic_count}
      />
      <BrandList
        title="配饰品牌" icon="💎"
        brands={data.accessory_brands}
        totalCount={summary.accessory_count}
      />
      {/* 风格偏好 */}
      {(data.style_preferences ?? []).length > 0 && (
        <div className="glass-card p-3 animate-fade-in">
          <div className="mb-2" style={{ fontSize: 14, fontWeight: 600 }}>🎨 风格偏好</div>
          <div className="flex flex-wrap gap-1.5">
            {data.style_preferences.map((s, i) => (
              <span key={i} className="pill-tag">{s}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

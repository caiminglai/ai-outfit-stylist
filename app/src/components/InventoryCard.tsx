import type { InventoryProduct } from '../types';

/**
 * 库存商品卡片组件 - 深色科技风
 *
 * 使用 var(--panel-2) 卡片背景 + var(--accent) 强调
 * 库存状态用 var(--good) / var(--danger) 区分
 */

interface InventoryCardProps {
  product: InventoryProduct;
  compact?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  top: '上装', bottom: '下装', shoes: '鞋履',
  accessory: '配饰', makeup: '美妆', hairstyle: '发型',
};

export default function InventoryCard({ product, compact }: InventoryCardProps) {
  const stockStatus = product.stock > 0
    ? { label: '有货', color: 'var(--good)', bg: 'rgba(110, 231, 199, 0.12)' }
    : { label: '缺货', color: 'var(--danger)', bg: 'rgba(240, 122, 122, 0.12)' };

  const tags = [
    ...(product.style_tags || []),
    ...(product.color_tags || []),
    ...(product.season_tags || []),
  ];

  return (
    <div className="glass-card p-3 flex gap-3 transition-transform hover:scale-[1.01]">
      {/* 商品图片占位 */}
      <div
        className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
      >
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="w-full h-full rounded-lg object-cover" />
          : <span className="text-2xl">📦</span>
        }
      </div>

      {/* 商品信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{product.name}</div>
            {product.brand && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{product.brand}</div>}
          </div>
          <span
            className="pill-tag flex-shrink-0"
            style={{ color: stockStatus.color, borderColor: stockStatus.color, background: stockStatus.bg }}
          >
            {stockStatus.label}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {CATEGORY_LABELS[product.category_code] || product.category_name}
          </span>
          {product.color && <span className="text-[10px]" style={{ color: 'var(--muted)' }}>· {product.color}</span>}
          {product.size && <span className="text-[10px]" style={{ color: 'var(--muted)' }}>· {product.size}</span>}
          {product.price != null && (
            <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>¥{product.price}</span>
          )}
          {product.stock > 0 && product.stock <= 3 && (
            <span className="text-[10px]" style={{ color: 'var(--warning)' }}>仅剩{product.stock}件</span>
          )}
        </div>

        {!compact && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.slice(0, 4).map((tag, i) => (
              <span key={i} className="pill-tag text-[10px]">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import type { WardrobeItem } from '../../types'
import { getWardrobeCategoryLabel } from '../CabinetConstants'

export interface WardrobeGridProps {
  items: WardrobeItem[]
  loading: boolean
  loadError: boolean
  isSameOriginImage: (url?: string | null) => string | null
  onRetry: () => void
  onEdit: (item: WardrobeItem) => void
  onDelete: (id: number | undefined) => void
}

export function WardrobeGrid({
  items,
  loading,
  loadError,
  isSameOriginImage,
  onRetry,
  onEdit,
  onDelete,
}: WardrobeGridProps) {
  const pillCls = 'pill-tag'

  return (
    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {loading && (
        <div role="status" aria-label="加载中" style={{ textAlign: 'center', padding: '20px' }}>
          <span className="spinner" />
        </div>
      )}
      {!loading && loadError && (
        <div
          role="alert"
          style={{
            textAlign: 'center',
            padding: '20px',
            color: 'var(--danger)',
            fontSize: '13px',
          }}
        >
          <div>加载失败</div>
          <button
            className="ghost-btn"
            style={{ marginTop: '8px', padding: '5px 16px', fontSize: '12px' }}
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      )}
      {!loading && !loadError && items.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '20px',
            color: 'var(--muted)',
            fontSize: '13px',
          }}
        >
          暂无衣物，点击上方按钮添加
        </div>
      )}
      {!loading &&
        !loadError &&
        items.map((item) => (
          <div
            key={item.id}
            className="glass-card p-3"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            {/* 「只存图」那件把照片摊在列表上（没拍照的不占位；外部地址不请求，见 sameOriginImage） */}
            {isSameOriginImage(item.image_url) && (
              <img
                src={item.image_url}
                alt={item.name}
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                style={{ border: '1px solid var(--line)', marginRight: '8px' }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '13px',
                  color: 'var(--text)',
                  marginBottom: '4px',
                }}
              >
                {item.name}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                <span className={pillCls}>{getWardrobeCategoryLabel(item.category)}</span>
                {/* 扫来的那件把条码摊在卡片上：店员要能一眼核对扫对没扫对 */}
                {item.sku && <span className={pillCls}>码 {item.sku}</span>}
                {item.color && <span className={pillCls}>{item.color}</span>}
                {(item.fit_type || item.fit_style) && (
                  <span className={pillCls}>{item.fit_type || item.fit_style}</span>
                )}
                {item.fabric_weight && <span className={pillCls}>{item.fabric_weight}</span>}
                {item.price != null && (
                  <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>
                    ¥{Number(item.price).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginLeft: '10px', flexShrink: 0 }}>
              <button
                className="ghost-btn"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={() => onEdit(item)}
              >
                修改
              </button>
              <button
                className="ghost-btn"
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: 'var(--danger)',
                  borderColor: 'var(--danger)',
                }}
                onClick={() => onDelete(item.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
    </div>
  )
}

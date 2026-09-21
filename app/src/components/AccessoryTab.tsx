/**
 * 配饰柜标签页
 *
 * 独立管理配饰相关的全部状态、CRUD 操作和分析功能。
 * 从 CabinetManager 中提取而来，降低单文件复杂度。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type {
  CustomerProfile,
  AccessoryItem,
  AccessoryGapResult,
  ShoppingWishlistItem,
} from '../types';
import {
  listAccessories,
  addAccessory,
  deleteAccessory,
  getAccessoryGaps,
  suggestAccessories,
} from '../api';
import {
  ACCESSORY_CATEGORIES,
  getAccessoryCategoryLabel,
  getPriorityColor,
  getPriorityLabel,
  btnStyle,
} from './CabinetConstants';

/* ================================================================
   Props
   ================================================================ */

interface AccessoryTabProps {
  profile?: CustomerProfile | null;
  compact?: boolean;
}

/* ================================================================
   默认表单值
   ================================================================ */

const ACCESSORY_FORM_DEFAULT = {
  name: '',
  category: 'earring' as string,
  material: '',
  metal_color: '',
  price: '',
};

/* ================================================================
   防御性数据规范化
   兼容后端新旧两种 gap 数据格式
   ================================================================ */

/** 规范化缺口数据，兼容后端新旧格式 */
function normalizeGapResult(raw: Record<string, unknown> | null): AccessoryGapResult | null {
  if (!raw || typeof raw !== 'object') return null;

  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps : [];
  const gaps: AccessoryGap[] = rawGaps.map((g: Record<string, unknown>) => ({
    type: (g.type as string) ?? (g.category as string) ?? (g.label as string) ?? '未知类型',
    priority: (g.priority as 'high' | 'medium' | 'low') ?? 'medium',
    message: (g.message as string) ?? (g.reason as string) ?? '',
    suggestions: Array.isArray(g.suggestions) ? g.suggestions as string[] : [],
  }));

  const rawStats = (raw.stats as Record<string, unknown>) ?? raw;
  const byCategory = (rawStats.by_category as Record<string, number>) ?? (raw.by_category as Record<string, number>) ?? {};
  const stats: AccessoryStats = {
    total: (rawStats.total as number) ?? (raw.total_items as number) ?? 0,
    by_category: byCategory,
  };

  return { gaps, stats };
}

/** 规范化购物建议数组 */
function normalizeSuggestions(raw: unknown): ShoppingWishlistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    name: (item.name as string) ?? (item.label as string) ?? '未知商品',
    category: (item.category as string) ?? '',
    reason: (item.reason as string) ?? '',
    priority: (item.priority as 'high' | 'medium' | 'low') ?? 'medium',
  }));
}

/* ================================================================
   组件
   ================================================================ */

export default function AccessoryTab({ profile, compact }: AccessoryTabProps) {
  /* ---------- 状态 ---------- */
  const [items, setItems] = useState<AccessoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [gaps, setGaps] = useState<AccessoryGapResult | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ShoppingWishlistItem[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [form, setForm] = useState(ACCESSORY_FORM_DEFAULT);

  /* ---------- 数据加载 ---------- */

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAccessories();
      setItems(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '加载配饰失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /* ---------- 添加 ---------- */

  const handleAdd = async () => {
    const { name, category, material, metal_color, price } = form;
    if (!name.trim()) {
      toast.error('请输入配饰名称');
      return;
    }
    try {
      await addAccessory({
        name: name.trim(),
        category,
        material: material.trim() || undefined,
        metal_color: metal_color.trim() || undefined,
        price: price ? Number(price) : undefined,
      });
      toast.success('添加成功');
      setShowAdd(false);
      setForm(ACCESSORY_FORM_DEFAULT);
      await fetchItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  /* ---------- 删除 ---------- */

  const handleDelete = async (id: number | undefined) => {
    if (!id) return;
    try {
      await deleteAccessory(id);
      toast.success('已删除');
      await fetchItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  /* ---------- 分析操作 ---------- */

  const handleGaps = async () => {
    setGapsLoading(true);
    setGaps(null);
    try {
      const result = await getAccessoryGaps(profile ?? undefined);
      setGaps(normalizeGapResult(result as unknown as Record<string, unknown>));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '缺口分析失败');
    } finally {
      setGapsLoading(false);
    }
  };

  const handleSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestions(null);
    try {
      const result = await suggestAccessories(profile ?? undefined);
      setSuggestions(normalizeSuggestions(result));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取购物建议失败');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  /* ---------- 统计 ---------- */

  const stats = useMemo(() => {
    const byCategory: Record<string, number> = {};
    items.forEach(item => {
      const cat = item.category || '其他';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    return { total: items.length, byCategory };
  }, [items]);

  /* ---------- 渲染 ---------- */

  const pillCls = 'pill-tag';

  return (
    <div className="animate-fade-in">
      {/* 顶部状态栏 */}
      <div className="glass-card p-3 mb-3" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px' }}>
          共 {stats.total} 件
        </span>
        {Object.entries(stats.byCategory).map(([cat, count]) => (
          <span key={cat} className={pillCls}>
            {getAccessoryCategoryLabel(cat)} {count}
          </span>
        ))}
      </div>

      {/* 添加按钮 */}
      <button
        className="gradient-btn"
        style={{ width: '100%', ...btnStyle(compact) }}
        onClick={() => setShowAdd(true)}
      >
        + 添加配饰
      </button>

      {/* 添加表单弹窗 */}
      {showAdd && (
        <div className="glass-card p-3 mt-3 animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
          <div className="section-title">添加配饰</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="form-input"
              placeholder="名称"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            />
            <select
              className="form-select"
              value={form.category}
              onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
            >
              {ACCESSORY_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="材质"
              value={form.material}
              onChange={e => setForm(prev => ({ ...prev, material: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="金属色"
              value={form.metal_color}
              onChange={e => setForm(prev => ({ ...prev, metal_color: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="价格"
              type="number"
              value={form.price}
              onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="gradient-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleAdd}>
                确认添加
              </button>
              <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={() => setShowAdd(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <span className="spinner" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: '13px' }}>
            暂无配饰，点击上方按钮添加
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="glass-card p-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>
                {item.name}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                <span className={pillCls}>{getAccessoryCategoryLabel(item.category)}</span>
                {item.material && <span className={pillCls}>{item.material}</span>}
                {item.metal_color && <span className={pillCls}>{item.metal_color}</span>}
                {item.price != null && (
                  <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>
                    ¥{item.price}
                  </span>
                )}
              </div>
            </div>
            <div style={{ marginLeft: '10px', flexShrink: 0 }}>
              <button
                className="ghost-btn"
                style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => handleDelete(item.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 底部操作按钮组 */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleGaps} disabled={gapsLoading}>
          {gapsLoading ? <span className="spinner" /> : '🔍 缺口分析'}
        </button>
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleSuggestions} disabled={suggestionsLoading}>
          {suggestionsLoading ? <span className="spinner" /> : '💡 购物建议'}
        </button>
      </div>

      {/* 缺口分析结果 */}
      {gaps && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">配饰缺口分析</div>
          {gaps.gaps.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>暂无缺口</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {gaps.gaps.map((gap, idx) => (
                <div key={idx} className="glass-card" style={{ padding: '10px', background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className={pillCls}>{gap.type}</span>
                    <span
                      className={pillCls}
                      style={{ color: getPriorityColor(gap.priority), borderColor: getPriorityColor(gap.priority) }}
                    >
                      {getPriorityLabel(gap.priority)}优先级
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>{gap.message}</div>
                  {gap.suggestions.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {gap.suggestions.map((s, si) => (
                        <div key={si}>- {s}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 购物建议结果 */}
      {suggestions && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">购物建议</div>
          {suggestions.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>暂无推荐</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {suggestions.map((item, idx) => (
                <div key={idx} className="glass-card" style={{ padding: '10px', background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{item.name}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                    <span className={pillCls}>{getAccessoryCategoryLabel(item.category)}</span>
                    <span
                      className={pillCls}
                      style={{ color: getPriorityColor(item.priority), borderColor: getPriorityColor(item.priority) }}
                    >
                      {getPriorityLabel(item.priority)}优先级
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{item.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

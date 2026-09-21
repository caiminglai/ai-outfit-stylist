/**
 * 化妆品柜标签页
 *
 * 独立管理化妆品相关的全部状态、CRUD 操作和分析功能。
 * 从 CabinetManager 中提取而来，降低单文件复杂度。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type {
  CustomerProfile,
  CosmeticItem,
  CosmeticGapResult,
  ShoppingWishlistItem,
} from '../types';
import {
  listCosmetics,
  addCosmetic,
  deleteCosmetic,
  getCosmeticGaps,
  suggestCosmetics,
  getCosmeticExpiry,
} from '../api';
import {
  COSMETIC_CATEGORIES,
  getCosmeticCategoryLabel,
  getPriorityColor,
  getPriorityLabel,
  btnStyle,
} from './CabinetConstants';

/* ================================================================
   Props
   ================================================================ */

interface CosmeticTabProps {
  profile?: CustomerProfile | null;
  compact?: boolean;
}

/* ================================================================
   默认表单值
   ================================================================ */

const COSMETIC_FORM_DEFAULT = {
  name: '',
  brand: '',
  category: 'lipstick' as string,
  color_name: '',
  color_tone: '',
  color_family: '',
  finish: '',
  price: '',
  opened_date: '',
  expiry_months: '12',
};

/* ================================================================
   防御性数据规范化
   兼容后端新旧两种 gap 数据格式
   ================================================================ */

/** 规范化缺口数据，兼容后端新旧格式 */
function normalizeGapResult(raw: Record<string, unknown> | null): CosmeticGapResult | null {
  if (!raw || typeof raw !== 'object') return null;

  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps : [];
  const gaps: CosmeticGap[] = rawGaps.map((g: Record<string, unknown>) => ({
    type: (g.type as string) ?? (g.category as string) ?? (g.label as string) ?? '未知类型',
    priority: (g.priority as 'high' | 'medium' | 'low') ?? 'medium',
    message: (g.message as string) ?? (g.reason as string) ?? '',
    suggestions: Array.isArray(g.suggestions) ? g.suggestions as string[] : [],
  }));

  // 规范化 stats，兼容后端嵌套和扁平两种格式
  const rawStats = (raw.stats as Record<string, unknown>) ?? raw;
  const byCategory = (rawStats.by_category as Record<string, number>) ?? (raw.by_category as Record<string, number>) ?? {};
  const stats: CosmeticStats = {
    total: (rawStats.total as number) ?? (raw.total_items as number) ?? 0,
    by_category: byCategory,
    expiring: (rawStats.expiring as number) ?? 0,
    expired: (rawStats.expired as number) ?? 0,
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

/** 规范化保质期检查结果 */
function normalizeExpiryItems(raw: unknown): CosmeticItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    id: item.id as number | undefined,
    name: (item.name as string) ?? '未知',
    brand: item.brand as string | undefined,
    category: (item.category as string) ?? '',
    opened_date: item.opened_date as string | undefined,
    expiry_months: item.expiry_months as number | undefined,
  }));
}

/* ================================================================
   组件
   ================================================================ */

export default function CosmeticTab({ profile, compact }: CosmeticTabProps) {
  /* ---------- 状态 ---------- */
  const [items, setItems] = useState<CosmeticItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [gaps, setGaps] = useState<CosmeticGapResult | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ShoppingWishlistItem[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [expiry, setExpiry] = useState<CosmeticItem[] | null>(null);
  const [expiryLoading, setExpiryLoading] = useState(false);

  const [form, setForm] = useState(COSMETIC_FORM_DEFAULT);

  /* ---------- 数据加载 ---------- */

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCosmetics();
      setItems(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '加载化妆品失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /* ---------- 添加 ---------- */

  const handleAdd = async () => {
    const { name, brand, category, color_name, color_tone, color_family, finish, price, opened_date, expiry_months } = form;
    if (!name.trim()) {
      toast.error('请输入化妆品名称');
      return;
    }
    try {
      await addCosmetic({
        name: name.trim(),
        brand: brand.trim() || undefined,
        category,
        color_name: color_name.trim() || undefined,
        color_tone: (color_tone as '冷' | '暖' | '中性') || undefined,
        color_family: color_family.trim() || undefined,
        finish: finish.trim() || undefined,
        price: price ? Number(price) : undefined,
        opened_date: opened_date || undefined,
        expiry_months: expiry_months ? Number(expiry_months) : undefined,
      });
      toast.success('添加成功');
      setShowAdd(false);
      setForm(COSMETIC_FORM_DEFAULT);
      await fetchItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  /* ---------- 删除 ---------- */

  const handleDelete = async (id: number | undefined) => {
    if (!id) return;
    try {
      await deleteCosmetic(id);
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
      const result = await getCosmeticGaps(profile ?? undefined);
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
      const result = await suggestCosmetics(profile ?? undefined);
      setSuggestions(normalizeSuggestions(result));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取购物建议失败');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleExpiry = async () => {
    setExpiryLoading(true);
    setExpiry(null);
    try {
      const result = await getCosmeticExpiry();
      setExpiry(normalizeExpiryItems(result));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '保质期检查失败');
    } finally {
      setExpiryLoading(false);
    }
  };

  /* ---------- 统计 ---------- */

  const stats = useMemo(() => {
    const now = new Date();
    let expiring = 0;
    let expired = 0;
    items.forEach(item => {
      if (item.opened_date && item.expiry_months) {
        const opened = new Date(item.opened_date);
        if (isNaN(opened.getTime())) return; // 无效日期跳过
        const expiryDate = new Date(opened);
        expiryDate.setMonth(expiryDate.getMonth() + item.expiry_months);
        if (now > expiryDate) {
          expired++;
        } else if (now >= new Date(expiryDate.getTime() - 30 * 24 * 60 * 60 * 1000)) {
          expiring++;
        }
      }
    });
    const byCategory: Record<string, number> = {};
    items.forEach(item => {
      const cat = item.category || '其他';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    return { total: items.length, expiring, expired, byCategory };
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
        {stats.expiring > 0 && (
          <span className={pillCls} style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
            即将过期 {stats.expiring}
          </span>
        )}
        {stats.expired > 0 && (
          <span className={pillCls} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            已过期 {stats.expired}
          </span>
        )}
        {Object.entries(stats.byCategory).map(([cat, count]) => (
          <span key={cat} className={pillCls}>
            {getCosmeticCategoryLabel(cat)} {count}
          </span>
        ))}
      </div>

      {/* 添加按钮 */}
      <button
        className="gradient-btn"
        style={{ width: '100%', ...btnStyle(compact) }}
        onClick={() => setShowAdd(true)}
      >
        + 添加化妆品
      </button>

      {/* 添加表单弹窗 */}
      {showAdd && (
        <div className="glass-card p-3 mt-3 animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
          <div className="section-title">添加化妆品</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="form-input"
              placeholder="名称"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="品牌"
              value={form.brand}
              onChange={e => setForm(prev => ({ ...prev, brand: e.target.value }))}
            />
            <select
              className="form-select"
              value={form.category}
              onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
            >
              {COSMETIC_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="色号"
              value={form.color_name}
              onChange={e => setForm(prev => ({ ...prev, color_name: e.target.value }))}
            />
            <select
              className="form-select"
              value={form.color_tone}
              onChange={e => setForm(prev => ({ ...prev, color_tone: e.target.value }))}
            >
              <option value="">色调（可选）</option>
              <option value="冷">冷</option>
              <option value="暖">暖</option>
              <option value="中性">中性</option>
            </select>
            <input
              className="form-input"
              placeholder="色系"
              value={form.color_family}
              onChange={e => setForm(prev => ({ ...prev, color_family: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="质地/妆效"
              value={form.finish}
              onChange={e => setForm(prev => ({ ...prev, finish: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="价格"
              type="number"
              value={form.price}
              onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
            />
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>开封日期</div>
            <input
              className="form-input"
              type="date"
              value={form.opened_date}
              onChange={e => setForm(prev => ({ ...prev, opened_date: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="保质期（月）"
              type="number"
              value={form.expiry_months}
              onChange={e => setForm(prev => ({ ...prev, expiry_months: e.target.value }))}
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
            暂无化妆品，点击上方按钮添加
          </div>
        )}
        {items.map(item => {
          const remaining = item.remaining ?? 100;
          return (
            <div key={item.id} className="glass-card p-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>
                  {item.name}
                  {item.brand && <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: '6px' }}>{item.brand}</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
                  <span className={pillCls}>{getCosmeticCategoryLabel(item.category)}</span>
                  {item.color_name && <span className={pillCls}>{item.color_name}</span>}
                  {item.price != null && (
                    <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>
                      ¥{item.price}
                    </span>
                  )}
                </div>
                {/* 剩余量进度条 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    flex: 1,
                    height: '5px',
                    background: 'var(--line)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${remaining}%`,
                      height: '100%',
                      background: remaining > 30 ? 'var(--accent)' : remaining > 10 ? 'var(--warning)' : 'var(--danger)',
                      borderRadius: '3px',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>{remaining}%</span>
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
          );
        })}
      </div>

      {/* 底部操作按钮组 */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleGaps} disabled={gapsLoading}>
          {gapsLoading ? <span className="spinner" /> : '🔍 缺口分析'}
        </button>
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleSuggestions} disabled={suggestionsLoading}>
          {suggestionsLoading ? <span className="spinner" /> : '💡 购物建议'}
        </button>
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleExpiry} disabled={expiryLoading}>
          {expiryLoading ? <span className="spinner" /> : '⏰ 保质期检查'}
        </button>
      </div>

      {/* 缺口分析结果 */}
      {gaps && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">化妆品缺口分析</div>
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
                    <span className={pillCls}>{getCosmeticCategoryLabel(item.category)}</span>
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

      {/* 保质期检查结果 */}
      {expiry && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">保质期检查</div>
          {expiry.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>所有化妆品均在保质期内</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {expiry.map((item, idx) => (
                <div key={idx} className="glass-card" style={{ padding: '10px', background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                    {item.name}
                    {item.brand && <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: '6px' }}>{item.brand}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                    <span className={pillCls}>{getCosmeticCategoryLabel(item.category)}</span>
                    {item.opened_date && (
                      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        开封: {item.opened_date}
                      </span>
                    )}
                    {item.expiry_months && (
                      <span style={{ fontSize: '12px', color: 'var(--warning)' }}>
                        保质期: {item.expiry_months}个月
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

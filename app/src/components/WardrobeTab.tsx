/**
 * 衣橱管理标签页
 *
 * 独立管理衣橱相关的全部状态、CRUD 操作和分析功能。
 * 从 CabinetManager 中提取而来，降低单文件复杂度。
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import type {
  CustomerProfile,
  WardrobeItem,
  WardrobeGapResult,
  ShoppingWishlistItem,
  ClothingItem,
} from '../types';
import {
  listWardrobeItems,
  addWardrobeItem,
  deleteWardrobeItem,
  getWardrobeGaps,
  suggestPurchases,
  getWardrobeStatus,
  uploadClothing,
} from '../api';
import {
  WARDROBE_CATEGORIES,
  getWardrobeCategoryLabel,
  getPriorityColor,
  getPriorityLabel,
  btnStyle,
} from './CabinetConstants';

/* ================================================================
   Props
   ================================================================ */

interface WardrobeTabProps {
  profile?: CustomerProfile | null;
  compact?: boolean;
}

/* ================================================================
   默认表单值
   ================================================================ */

const WARDROBE_FORM_DEFAULT = {
  name: '',
  category: 'top' as string,
  color: '',
  style_tags: '',
  season_tags: '',
  occasion_tags: '',
  price: '',
};

/* ================================================================
   防御性数据规范化
   兼容后端新旧两种 gap 数据格式
   ================================================================ */

/** 规范化缺口数据，兼容后端新旧格式 */
function normalizeGapResult(raw: Record<string, unknown> | null): WardrobeGapResult | null {
  if (!raw || typeof raw !== 'object') return null;

  // 新格式：gaps 已是 [{ type, priority, message, suggestions }]
  // 旧格式：gaps 是 [{ category, label, reason, ... }]
  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps : [];
  const gaps: WardrobeGap[] = rawGaps.map((g: Record<string, unknown>) => ({
    type: (g.type as string) ?? (g.category as string) ?? (g.label as string) ?? '未知类型',
    priority: (g.priority as 'high' | 'medium' | 'low') ?? 'medium',
    message: (g.message as string) ?? (g.reason as string) ?? '',
    suggestions: Array.isArray(g.suggestions) ? g.suggestions as string[] : [],
  }));

  // 规范化 stats
  const rawStats = (raw.stats as Record<string, unknown>) ?? {};
  const stats: WardrobeStats = {
    total: (rawStats.total as number) ?? 0,
    by_category: (rawStats.by_category as Record<string, number>) ?? {},
    by_season: (rawStats.by_season as Record<string, number>) ?? {},
    by_style: (rawStats.by_style as Record<string, number>) ?? {},
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

export default function WardrobeTab({ profile, compact }: WardrobeTabProps) {
  /* ---------- 状态 ---------- */
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [gaps, setGaps] = useState<WardrobeGapResult | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ShoppingWishlistItem[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [status, setStatus] = useState<WardrobeGapResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [form, setForm] = useState(WARDROBE_FORM_DEFAULT);

  /* 拍照上传 */
  const [showPhotoUpload, setShowPhotoUpload] = useState(true);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* ---------- 数据加载 ---------- */

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWardrobeItems();
      setItems(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '加载衣橱失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /* ---------- 添加 ---------- */

  const handleAdd = async () => {
    const { name, category, color, style_tags, season_tags, occasion_tags, price } = form;
    if (!name.trim()) {
      toast.error('请输入衣物名称');
      return;
    }
    try {
      await addWardrobeItem({
        name: name.trim(),
        category,
        color: color.trim() || undefined,
        style_tags: style_tags ? style_tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        season_tags: season_tags ? season_tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        occasion_tags: occasion_tags ? occasion_tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        price: price ? Number(price) : undefined,
      });
      toast.success('添加成功');
      setShowAdd(false);
      setShowPhotoUpload(true);
      setForm(WARDROBE_FORM_DEFAULT);
      await fetchItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  /* ---------- 拍照上传 -> AI 识别 -> 自动填充表单 ---------- */

  const handlePhotoUpload = async (file: File): Promise<void> => {
    setPhotoUploading(true);
    try {
      const result: ClothingItem = await uploadClothing(file);
      const sem = result.semantics;
      if (!sem) {
        toast.error('AI识别返回数据不完整');
        return;
      }
      setForm({
        name: sem.item_name ?? '',
        category: sem.category ?? '',
        color: sem.color ?? '',
        style_tags: (sem.style ?? []).join(','),
        season_tags: (sem.season ?? []).join(','),
        occasion_tags: (sem.usage ?? []).join(','),
        price: '',
      });
      setShowAdd(true);
      setShowPhotoUpload(false);
      toast.success('AI识别成功，请确认信息');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '上传识别失败');
    } finally {
      setPhotoUploading(false);
    }
  };

  /* ---------- 删除 ---------- */

  const handleDelete = async (id: number | undefined) => {
    if (!id) return;
    try {
      await deleteWardrobeItem(id);
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
      const result = await getWardrobeGaps(profile ?? undefined);
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
      const result = await suggestPurchases(profile ?? undefined);
      setSuggestions(normalizeSuggestions(result));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取购物建议失败');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleStatus = async () => {
    setStatusLoading(true);
    setStatus(null);
    try {
      const result = await getWardrobeStatus();
      setStatus(normalizeGapResult(result as unknown as Record<string, unknown>));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取衣橱状态失败');
    } finally {
      setStatusLoading(false);
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
            {getWardrobeCategoryLabel(cat)} {count}
          </span>
        ))}
      </div>

      {/* 添加按钮 */}
      <button
        className="gradient-btn"
        style={{ width: '100%', ...btnStyle(compact) }}
        onClick={() => { setShowAdd(true); setShowPhotoUpload(false); }}
      >
        + 添加衣物
      </button>

      {/* 拍照上传（AI 识别） */}
      {showPhotoUpload && (
        <>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handlePhotoUpload(file);
              e.target.value = '';
            }}
          />
          <button
            className="ghost-btn"
            style={{ width: '100%', ...btnStyle(compact), marginTop: '8px' }}
            disabled={photoUploading}
            onClick={() => photoInputRef.current?.click()}
          >
            {photoUploading ? <span className="spinner" /> : '📷 拍照上传'}
          </button>
        </>
      )}

      {/* 添加表单弹窗 */}
      {showAdd && (
        <div className="glass-card p-3 mt-3 animate-fade-in" style={{ borderColor: 'var(--accent)' }}>
          <div className="section-title">添加衣物</div>
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
              {WARDROBE_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="颜色"
              value={form.color}
              onChange={e => setForm(prev => ({ ...prev, color: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="风格标签（逗号分隔）"
              value={form.style_tags}
              onChange={e => setForm(prev => ({ ...prev, style_tags: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="季节标签（逗号分隔）"
              value={form.season_tags}
              onChange={e => setForm(prev => ({ ...prev, season_tags: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="场合标签（逗号分隔）"
              value={form.occasion_tags}
              onChange={e => setForm(prev => ({ ...prev, occasion_tags: e.target.value }))}
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
              <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={() => { setShowAdd(false); setShowPhotoUpload(true); }}>
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
            暂无衣物，点击上方按钮添加
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="glass-card p-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>
                {item.name}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                <span className={pillCls}>{getWardrobeCategoryLabel(item.category)}</span>
                {item.color && <span className={pillCls}>{item.color}</span>}
                {item.price != null && (
                  <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>
                    ¥{item.price}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginLeft: '10px', flexShrink: 0 }}>
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
        <button className="ghost-btn" style={{ flex: 1, ...btnStyle(compact) }} onClick={handleStatus} disabled={statusLoading}>
          {statusLoading ? <span className="spinner" /> : '📊 衣橱状态'}
        </button>
      </div>

      {/* 缺口分析结果 */}
      {gaps && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">缺口分析</div>
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
                    <span className={pillCls}>{getWardrobeCategoryLabel(item.category)}</span>
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

      {/* 衣橱状态结果 */}
      {status && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">衣橱状态</div>
          <div style={{ fontSize: '13px', color: 'var(--text)' }}>
            <div>总件数: <strong>{status.stats.total}</strong></div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>分类统计:</div>
              {Object.entries(status.stats.by_category).map(([cat, count]) => (
                <span key={cat} className={pillCls} style={{ marginRight: '4px', marginBottom: '4px' }}>
                  {getWardrobeCategoryLabel(cat)}: {count}
                </span>
              ))}
            </div>
            {status.stats.by_season && Object.keys(status.stats.by_season).length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>季节分布:</div>
                {Object.entries(status.stats.by_season).map(([season, count]) => (
                  <span key={season} className={pillCls} style={{ marginRight: '4px', marginBottom: '4px' }}>
                    {season}: {count}
                  </span>
                ))}
              </div>
            )}
            {status.stats.by_style && Object.keys(status.stats.by_style).length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>风格分布:</div>
                {Object.entries(status.stats.by_style).map(([style, count]) => (
                  <span key={style} className={pillCls} style={{ marginRight: '4px', marginBottom: '4px' }}>
                    {style}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

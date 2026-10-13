/**
 * 衣橱管理标签页
 *
 * 独立管理衣橱相关的全部状态、CRUD 操作和分析功能。
 * 从 CabinetManager 中提取而来，降低单文件复杂度。
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import type {
  CustomerProfile,
  WardrobeItem,
  WardrobeGapResult,
  WardrobeGap,
  WardrobeStats,
  ShoppingWishlistItem,
  ClothingItem,
  TopFitResult,
} from '../types'
import {
  listWardrobeItems,
  addWardrobeItem,
  updateWardrobeItem,
  deleteWardrobeItem,
  getWardrobeGaps,
  suggestPurchases,
  rankTopsByBody,
  getWardrobeStatus,
  uploadClothing,
} from '../api'
import {
  WARDROBE_CATEGORIES,
  getWardrobeCategoryLabel,
  getPriorityColor,
  getPriorityLabel,
  btnStyle,
} from './CabinetConstants'
import { UPLOAD_ACCEPT, checkPickedImage } from '../lib/imagePick'

/* ================================================================
   Props
   ================================================================ */

interface WardrobeTabProps {
  profile?: CustomerProfile | null
  compact?: boolean
}

/* ================================================================
   默认表单值
   ================================================================ */

const WARDROBE_FORM_DEFAULT = {
  name: '',
  category: 'top' as string,
  color: '',
  fit_style: '' as string,
  fabric_weight: '' as string,
  style_tags: '',
  season_tags: '',
  occasion_tags: '',
  price: '',
}

/* ================================================================
   防御性数据规范化
   兼容后端新旧两种 gap 数据格式
   ================================================================ */

/**
 * 缺口类型的中文兜底名。
 * category_* 类缺口后端直接带 label(上衣/下装…),走 gap.label 那条;
 * 季节、色彩这两类后端只给 type 不给 label,不映射的话胶囊 pill 会把英文码
 * 原样(如 'season_gap')糊在界面上——正是"后端说了、前端没读"这一族。
 */
const WARDROBE_GAP_TYPE_LABELS: Record<string, string> = {
  season_gap: '季节缺口',
  color_diversity: '色彩多样性',
}

/** 规范化缺口数据，兼容后端新旧格式 */
function normalizeGapResult(raw: Record<string, unknown> | null): WardrobeGapResult | null {
  if (!raw || typeof raw !== 'object') return null

  // 新格式：gaps 已是 [{ type, label?, priority, message, suggestions }]
  // 旧格式：gaps 是 [{ category, label, reason, ... }]
  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps : []
  const gaps: WardrobeGap[] = rawGaps.map((g: Record<string, unknown>) => ({
    type: (g.type as string) ?? (g.category as string) ?? '未知类型',
    label: (g.label as string) ?? undefined,
    priority: (g.priority as 'high' | 'medium' | 'low') ?? 'medium',
    message: (g.message as string) ?? (g.reason as string) ?? '',
    suggestions: Array.isArray(g.suggestions) ? (g.suggestions as string[]) : [],
  }))

  // 规范化 stats
  const rawStats = (raw.stats as Record<string, unknown>) ?? {}
  const stats: WardrobeStats = {
    total: (rawStats.total as number) ?? 0,
    by_category: (rawStats.by_category as Record<string, number>) ?? {},
    by_season: (rawStats.by_season as Record<string, number>) ?? {},
    by_style: (rawStats.by_style as Record<string, number>) ?? {},
  }

  return { gaps, stats }
}

/** 规范化购物建议数组 */
function normalizeSuggestions(raw: unknown): ShoppingWishlistItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item: Record<string, unknown>) => ({
    name: (item.name as string) ?? (item.label as string) ?? '未知商品',
    category: (item.category as string) ?? '',
    reason: (item.reason as string) ?? '',
    priority: (item.priority as 'high' | 'medium' | 'low') ?? 'medium',
  }))
}

/**
 * 把"身材偏差向量"拼成一句人话（只写量到的，没量的不写、也不写"未知"凑数）。
 * want 的符号约定与后端 topFitBody.js 一致：+ 想往外加，− 想往里收，0 这一维不推拉。
 */
function describeDeviation(dev: TopFitResult['person_deviation']): string {
  const label: Record<string, string> = {
    shoulder: '肩线',
    waist: '腰线',
    length: '视觉腰位',
    volume: '体量',
    pattern: '条纹',
  }
  const measured: string[] = []
  if (dev.bmi != null) measured.push(`BMI ${dev.bmi}`)
  if (dev.shoulder_ratio != null) measured.push(`肩宽÷身高 ${dev.shoulder_ratio}%`)
  if (dev.shoulder_waist_ratio != null) measured.push(`肩宽÷腰围 ${dev.shoulder_waist_ratio}`)
  if (dev.leg_ratio != null) measured.push(`腿身比 ${dev.leg_ratio}`)
  if (dev.bust_waist_diff != null) measured.push(`胸腰差 ${dev.bust_waist_diff}cm`)
  if (dev.hip_waist_diff != null) measured.push(`臀腰差 ${dev.hip_waist_diff}cm`)
  if (dev.waist_groove_cm != null) measured.push(`腰沟 ${dev.waist_groove_cm}cm`)
  if (dev.ease_window_cm) measured.push(`松量合适区间 ${dev.ease_window_cm.join('~')}cm`)

  const wants: string[] = []
  for (const [k, v] of Object.entries(dev.want)) {
    if (v == null) continue
    const name = label[k] || k
    if (v === 0) wants.push(`${name}不推拉`)
    else wants.push(`${name}${v > 0 ? '想加' : '想收'} ${Math.abs(v)}`)
  }

  const head = measured.length ? measured.join(' / ') : '没量到尺寸'
  const tail = wants.length
    ? `想往哪修：${wants.join(' / ')}`
    : '没量到能判的尺寸 ⇒ 只按能算的几维打分'
  return `${head}；${tail}`
}

/* ================================================================
   组件
   ================================================================ */

export default function WardrobeTab({ profile, compact }: WardrobeTabProps) {
  /* ---------- 状态 ---------- */
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [gaps, setGaps] = useState<WardrobeGapResult | null>(null)
  const [gapsLoading, setGapsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<ShoppingWishlistItem[] | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [status, setStatus] = useState<WardrobeGapResult | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  /** 上衣按身材打分的结果（后端 /wardrobe/top-fit，不看脸那一半） */
  const [topFit, setTopFit] = useState<TopFitResult | null>(null)
  const [topFitLoading, setTopFitLoading] = useState(false)

  const [form, setForm] = useState(WARDROBE_FORM_DEFAULT)
  /** 非空 = 表单正在改这一条;null = 新增 */
  const [editingId, setEditingId] = useState<number | null>(null)

  /* 拍照上传 */
  const [showPhotoUpload, setShowPhotoUpload] = useState(true)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  /* ---------- 数据加载 ---------- */

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listWardrobeItems()
      setItems(data)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '加载衣橱失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  /* ---------- 表单开关与提交 ---------- */

  const closeForm = () => {
    setShowAdd(false)
    setEditingId(null)
    setForm(WARDROBE_FORM_DEFAULT)
    setShowPhotoUpload(true)
  }

  const openEdit = (item: WardrobeItem) => {
    if (!item.id) return
    setForm({
      name: item.name ?? '',
      category: item.category ?? 'top',
      color: item.color ?? '',
      fit_style: item.fit_style ?? '',
      fabric_weight: item.fabric_weight ?? '',
      style_tags: (item.style_tags ?? []).join(','),
      season_tags: (item.season_tags ?? []).join(','),
      occasion_tags: (item.occasion_tags ?? []).join(','),
      price: item.price != null ? String(item.price) : '',
    })
    setEditingId(item.id ?? null)
    setShowPhotoUpload(false)
    setShowAdd(true)
  }

  // POST 与 PUT 共用这一份打包：可空的列没填就发 null，不发 undefined。
  // · PUT 的契约是「这个键不传＝这一列不动，传 null＝写成 NULL」(api.ts 的 PutPayload)。
  //   原来空框被打包成 undefined ⇒ 键根本不在请求里，用户在修改框里删掉颜色/版型/标签点
  //   保存，刷新回来老值一个都没少，看着就是"改了没生效"。
  // · POST 那边同样安全：三条写口对 null 分别走 `data.xxx || null`、coerceExpiryField 的
  //   null 分支、JSON 列的 `JSON.stringify(val || [])`，落库结果和"没给"一样。
  const splitTags = (v: string) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const buildPayload = () => ({
    name: form.name.trim(),
    category: form.category,
    color: form.color.trim() || null,
    fit_style: (form.fit_style.trim() || null) as WardrobeItem['fit_style'] | null,
    fabric_weight: (form.fabric_weight.trim() || null) as WardrobeItem['fabric_weight'] | null,
    style_tags: splitTags(form.style_tags),
    season_tags: splitTags(form.season_tags),
    occasion_tags: splitTags(form.occasion_tags),
    price: form.price ? Number(form.price) : null,
  })

  const handleSubmit = async () => {
    if (submitting) return
    if (!form.name.trim()) {
      toast.error('请输入衣物名称')
      return
    }
    const payload = buildPayload()
    setSubmitting(true)
    try {
      if (editingId != null) {
        await updateWardrobeItem(editingId, payload)
        toast.success('已保存修改')
      } else {
        await addWardrobeItem(payload)
        toast.success('添加成功')
      }
      closeForm()
      await fetchItems()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : editingId != null ? '保存失败' : '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------- 拍照上传 -> AI 识别 -> 自动填充表单 ---------- */

  const handlePhotoUpload = async (file: File): Promise<void> => {
    setPhotoUploading(true)
    try {
      const result: ClothingItem = await uploadClothing(file)
      const sem = result.semantics
      if (!sem) {
        toast.error('识别结果不完整')
        return
      }
      // 后端这条上传链路目前不做任何识别,semantics 是写死的占位(category='未分类'、color='未知'…)。
      // '未分类'不在 WARDROBE_CATEGORIES 里 ⇒ 若照单塞进受控 <select>,下拉框会显示空白而 state 停在'未分类',
      // 存出来的衣物归不进任何缺口桶。只有当识别真给出一个合法分类时才覆盖默认值。
      const knownCategory = WARDROBE_CATEGORIES.some((c) => c.value === sem.category)
      setForm((prev) => ({
        ...prev,
        name: sem.item_name && sem.item_name !== '未命名' ? sem.item_name : prev.name,
        category: knownCategory ? (sem.category as string) : prev.category,
        color: sem.color && sem.color !== '未知' ? sem.color : prev.color,
        style_tags: (sem.style ?? []).join(','),
        season_tags: (sem.season ?? []).join(','),
        occasion_tags: (sem.usage ?? []).join(','),
      }))
      setEditingId(null)
      setShowAdd(true)
      setShowPhotoUpload(false)
      toast.success('照片已保存，请手动补充识别信息')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '上传识别失败')
    } finally {
      setPhotoUploading(false)
    }
  }

  /* ---------- 删除 ---------- */

  const handleDelete = async (id: number | undefined) => {
    if (!id) return
    try {
      await deleteWardrobeItem(id)
      toast.success('已删除')
      await fetchItems()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  /* ---------- 分析操作 ---------- */

  const handleGaps = async () => {
    setGapsLoading(true)
    setGaps(null)
    try {
      const result = await getWardrobeGaps(profile ?? undefined)
      setGaps(normalizeGapResult(result as unknown as Record<string, unknown>))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '缺口分析失败')
    } finally {
      setGapsLoading(false)
    }
  }

  const handleSuggestions = async () => {
    setSuggestionsLoading(true)
    setSuggestions(null)
    try {
      const result = await suggestPurchases(profile ?? undefined)
      setSuggestions(normalizeSuggestions(result))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取购物建议失败')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  /**
   * 上衣按身材打分：把衣柜里的上装/外套按"这个人的比例偏差"排序。
   * 缺的尺寸不编造——后端那侧对应轴直接缺席，所以分数只反映量到的那几维。
   */
  const handleTopFit = async () => {
    setTopFitLoading(true)
    setTopFit(null)
    try {
      const result = await rankTopsByBody(profile ?? ({} as CustomerProfile))
      setTopFit(result)
      if (result.ranked.length === 0) {
        toast.message('这次的尺寸或上衣信息不够，没打出分来')
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '上衣打分失败')
    } finally {
      setTopFitLoading(false)
    }
  }

  const handleStatus = async () => {
    setStatusLoading(true)
    setStatus(null)
    try {
      const result = await getWardrobeStatus()
      setStatus(normalizeGapResult(result as unknown as Record<string, unknown>))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '获取衣橱状态失败')
    } finally {
      setStatusLoading(false)
    }
  }

  /* ---------- 统计 ---------- */

  const stats = useMemo(() => {
    const byCategory: Record<string, number> = {}
    items.forEach((item) => {
      const cat = item.category || '其他'
      byCategory[cat] = (byCategory[cat] || 0) + 1
    })
    return { total: items.length, byCategory }
  }, [items])

  /* ---------- 渲染 ---------- */

  const pillCls = 'pill-tag'

  return (
    <div className="animate-fade-in">
      {/* 顶部状态栏 */}
      <div
        className="glass-card p-3 mb-3"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}
      >
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
        onClick={() => {
          setForm(WARDROBE_FORM_DEFAULT)
          setEditingId(null)
          setShowAdd(true)
          setShowPhotoUpload(false)
        }}
      >
        + 添加衣物
      </button>

      {/* 拍照上传（AI 识别） */}
      {showPhotoUpload && (
        <>
          <input
            ref={photoInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                // 拍照/选图先在本机过一遍格式与体积，别把 20MB 原片传上去换一句 400
                const err = checkPickedImage(file, '这张照片')
                if (err) toast.error(err)
                else handlePhotoUpload(file)
              }
              e.target.value = ''
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
        <div
          className="glass-card p-3 mt-3 animate-fade-in"
          style={{ borderColor: 'var(--accent)' }}
        >
          <div className="section-title">{editingId != null ? '修改衣物' : '添加衣物'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="form-input"
              placeholder="名称"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <select
              className="form-select"
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            >
              {WARDROBE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="颜色"
              value={form.color}
              onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
            />
            {/* 版型与面料厚薄：上衣体量轴的两格输入，不填＝没量，引擎不会替你猜 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={form.fit_style}
                onChange={(e) => setForm((prev) => ({ ...prev, fit_style: e.target.value }))}
              >
                <option value="">版型（选填）</option>
                <option value="合体">合体</option>
                <option value="宽松">宽松</option>
              </select>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={form.fabric_weight}
                onChange={(e) => setForm((prev) => ({ ...prev, fabric_weight: e.target.value }))}
              >
                <option value="">面料厚薄（选填）</option>
                <option value="薄">薄</option>
                <option value="中">中</option>
                <option value="厚">厚</option>
              </select>
            </div>
            <input
              className="form-input"
              placeholder="风格标签（逗号分隔）"
              value={form.style_tags}
              onChange={(e) => setForm((prev) => ({ ...prev, style_tags: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="季节标签（逗号分隔）"
              value={form.season_tags}
              onChange={(e) => setForm((prev) => ({ ...prev, season_tags: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="场合标签（逗号分隔）"
              value={form.occasion_tags}
              onChange={(e) => setForm((prev) => ({ ...prev, occasion_tags: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="价格"
              type="number"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="gradient-btn"
                style={{ flex: 1, ...btnStyle(compact) }}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {editingId != null ? '保存修改' : '确认添加'}
              </button>
              <button
                className="ghost-btn"
                style={{ flex: 1, ...btnStyle(compact) }}
                onClick={closeForm}
              >
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
        {items.map((item) => (
          <div
            key={item.id}
            className="glass-card p-3"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
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
                {item.color && <span className={pillCls}>{item.color}</span>}
                {item.fit_style && <span className={pillCls}>{item.fit_style}</span>}
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
                onClick={() => openEdit(item)}
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
        <button
          className="ghost-btn"
          style={{ flex: 1, ...btnStyle(compact) }}
          onClick={handleGaps}
          disabled={gapsLoading}
        >
          {gapsLoading ? <span className="spinner" /> : '🔍 缺口分析'}
        </button>
        <button
          className="ghost-btn"
          style={{ flex: 1, ...btnStyle(compact) }}
          onClick={handleSuggestions}
          disabled={suggestionsLoading}
        >
          {suggestionsLoading ? <span className="spinner" /> : '💡 购物建议'}
        </button>
        <button
          className="ghost-btn"
          style={{ flex: 1, ...btnStyle(compact) }}
          onClick={handleStatus}
          disabled={statusLoading}
        >
          {statusLoading ? <span className="spinner" /> : '📊 衣橱状态'}
        </button>
        <button
          className="ghost-btn"
          style={{ flex: 1, ...btnStyle(compact) }}
          onClick={handleTopFit}
          disabled={topFitLoading}
        >
          {topFitLoading ? <span className="spinner" /> : '📏 上衣打分'}
        </button>
      </div>

      {/* 上衣按身材打分：只算身体这一半，色彩那一半在报告页的"上衣贴合度" */}
      {topFit && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">上衣按身材打分</div>
          <div
            style={{
              color: 'var(--muted)',
              fontSize: '12px',
              lineHeight: 1.6,
              marginBottom: '8px',
            }}
          >
            {describeDeviation(topFit.person_deviation)}
          </div>
          {topFit.ranked.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              这次一件都没打出分：要么档案里的尺寸没量，
              要么这些上衣的名称／版型／厚薄里读不出修形线索。缺的东西我们不替你猜。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {topFit.ranked.map((t) => (
                <div
                  key={t.id ?? t.name}
                  className="glass-card"
                  style={{ padding: '10px', background: 'var(--bg)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                      {t.name}
                    </span>
                    <span style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 600 }}>
                      {t.score}/100
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    {t.axes.map((a) => (
                      <span key={a.key} className={pillCls} title={a.tier}>
                        {a.name_cn} {Math.round(a.score * 100)}
                      </span>
                    ))}
                    {t.axes_missing.length > 0 && (
                      <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
                        另 {t.axes_missing.length} 维没计入
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {topFit.unscored.length > 0 && (
            <div
              style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}
            >
              没打分的 {topFit.unscored.length} 件：
              {topFit.unscored.map((u) => u.name).join('、')}
            </div>
          )}
          <div
            style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '11px', lineHeight: 1.6 }}
          >
            {topFit.note}
          </div>
        </div>
      )}

      {/* 缺口分析结果 */}
      {gaps && (
        <div className="glass-card p-3 mt-3 animate-fade-in">
          <div className="section-title">缺口分析</div>
          {gaps.gaps.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>暂无缺口</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {gaps.gaps.map((gap, idx) => (
                <div
                  key={idx}
                  className="glass-card"
                  style={{ padding: '10px', background: 'var(--bg)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '4px',
                    }}
                  >
                    <span className={pillCls}>
                      {gap.label || WARDROBE_GAP_TYPE_LABELS[gap.type] || gap.type}
                    </span>
                    <span
                      className={pillCls}
                      style={{
                        color: getPriorityColor(gap.priority),
                        borderColor: getPriorityColor(gap.priority),
                      }}
                    >
                      {getPriorityLabel(gap.priority)}优先级
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>
                    {gap.message}
                  </div>
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
                <div
                  key={idx}
                  className="glass-card"
                  style={{ padding: '10px', background: 'var(--bg)' }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                    {item.name}
                  </div>
                  <div
                    style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}
                  >
                    <span className={pillCls}>{getWardrobeCategoryLabel(item.category)}</span>
                    <span
                      className={pillCls}
                      style={{
                        color: getPriorityColor(item.priority),
                        borderColor: getPriorityColor(item.priority),
                      }}
                    >
                      {getPriorityLabel(item.priority)}优先级
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                    {item.reason}
                  </div>
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
            <div>
              总件数: <strong>{status.stats.total}</strong>
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>
                分类统计:
              </div>
              {Object.entries(status.stats.by_category).map(([cat, count]) => (
                <span
                  key={cat}
                  className={pillCls}
                  style={{ marginRight: '4px', marginBottom: '4px' }}
                >
                  {getWardrobeCategoryLabel(cat)}: {count}
                </span>
              ))}
            </div>
            {status.stats.by_season && Object.keys(status.stats.by_season).length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>
                  季节分布:
                </div>
                {Object.entries(status.stats.by_season).map(([season, count]) => (
                  <span
                    key={season}
                    className={pillCls}
                    style={{ marginRight: '4px', marginBottom: '4px' }}
                  >
                    {season}: {count}
                  </span>
                ))}
              </div>
            )}
            {status.stats.by_style && Object.keys(status.stats.by_style).length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ marginBottom: '4px', color: 'var(--muted)', fontSize: '12px' }}>
                  风格分布:
                </div>
                {Object.entries(status.stats.by_style).map(([style, count]) => (
                  <span
                    key={style}
                    className={pillCls}
                    style={{ marginRight: '4px', marginBottom: '4px' }}
                  >
                    {style}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

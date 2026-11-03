/**
 * 衣橱管理标签页
 *
 * 独立管理衣橱相关的全部状态、CRUD 操作和分析功能。
 * 从 CabinetManager 中提取而来，降低单文件复杂度。
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from '../utils/toastOnce'
import type {
  CustomerProfile,
  WardrobeItem,
  WardrobeGapResult,
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
  lookupWardrobeSku,
} from '../api'
import {
  WARDROBE_CATEGORIES,
  getWardrobeCategoryLabel,
  getPriorityColor,
  getPriorityLabel,
  btnStyle,
} from './CabinetConstants'
import { UPLOAD_ACCEPT, checkPickedImage } from '../lib/imagePick'
import WardrobeDiary from './WardrobeDiary'
import { evidenceLabel } from './recommend/evidenceMeta'
import { describeDeviation } from './wardrobe/describeDeviation'
import { WARDROBE_FORM_DEFAULT } from './wardrobe/formDefault'
import { sameOriginImage } from './wardrobe/imageSrc'
import {
  WARDROBE_GAP_TYPE_LABELS,
  normalizeGapResult,
  normalizeSuggestions,
} from './wardrobe/normalize'
import type { WardrobeTabProps } from './wardrobe/types'

export default function WardrobeTab({ profile, compact }: WardrobeTabProps) {
  /* ---------- 状态 ---------- */
  const [items, setItems] = useState<WardrobeItem[]>([])
  // 🔴 11-03 第 4 项：挂起态初值＝「正在取」，手动重取由事件处理器置真；
  // promise 链的成因见 `AccessoryTab.tsx` 里同一段注释。
  const [loading, setLoading] = useState(true)
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

  /* 扫码录入（键盘式扫码枪＝敲一串字符再自动按回车，所以监听 keydown 就够，不用摄像头） */
  const [scanValue, setScanValue] = useState('')
  const [scanBusy, setScanBusy] = useState(false)

  /* ---------- 数据加载 ---------- */

  const fetchItems = useCallback(() => {
    return listWardrobeItems()
      .then(setItems)
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : '加载衣橱失败')
      })
      .finally(() => setLoading(false))
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
      fit_type: item.fit_type ?? '',
      fabric_weight: item.fabric_weight ?? '',
      pattern: item.pattern ?? '',
      shoulder_cm: item.shoulder_cm != null ? String(item.shoulder_cm) : '',
      bust_cm: item.bust_cm != null ? String(item.bust_cm) : '',
      length_cm: item.length_cm != null ? String(item.length_cm) : '',
      waistband_cm: item.waistband_cm != null ? String(item.waistband_cm) : '',
      style_tags: (item.style_tags ?? []).join(','),
      season_tags: (item.season_tags ?? []).join(','),
      occasion_tags: (item.occasion_tags ?? []).join(','),
      price: item.price != null ? String(item.price) : '',
      sku: item.sku ?? '',
      image_url: item.image_url ?? '',
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
  /** 实测尺寸：空框 → null（＝没量）；有内容 → 数。脏值由下面 measureFormError 拦，不在这里抹成 null */
  const toCm = (v: string) => (v.trim() === '' ? null : Number(v))
  /**
   * 哪些分类必填版型（10-19 第三阶段·模块一）：只有穿在上半身、松量算得出意义的这三类要选。
   * 鞋、包、下装没有"成品胸围 − 净胸围"这一维，逼用户选档位只会选出噪声（后端也不认它们进打分）。
   */
  const FIT_TYPE_CATEGORIES = ['top', 'outerwear', 'dress']
  const FIT_TYPE_OPTIONS = ['修身', '合身', '宽松', '廓形']
  const fitTypeRequired = FIT_TYPE_CATEGORIES.includes(form.category)
  /** 版型闸门：该选没选就拦下来说一句，别让这条记录带着"整维缺席"进库 */
  const fitTypeError = () =>
    fitTypeRequired && form.fit_type.trim() === ''
      ? '请先选版型（修身/合身/宽松/廓形）——不用软尺也能推荐，就靠这一档估松量'
      : null
  /**
   * 四格实测尺寸的前端闸门：填了却不是个数就拦下来说一句，
   * 不能让它打包成 NaN→null 静默把库里已有的尺寸抹掉（和后端 measureError 同一把尺子）。
   */
  const measureFormError = () => {
    const cells: Array<[string, string, number, string]> = [
      ['衣服肩宽', form.shoulder_cm, 15, '两肩缝点之间的直线距离'],
      ['衣服胸围', form.bust_cm, 50, '袖窿下方一周最宽处'],
      ['衣服衣长', form.length_cm, 25, '肩颈点（领口最高偏侧处）到下摆'],
      ['腰头/收口高', form.waistband_cm, 0, '腰头那条缝带自己的高度，没有就填 0'],
    ]
    for (const [label, raw, min, how] of cells) {
      if (raw.trim() === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) return `${label}只能填数字（单位 cm），量法：${how}`
      if (n < min || n > 200) return `${label}看起来不像一个衣服尺寸（${min}~200 cm），量法：${how}`
    }
    return null
  }
  const buildPayload = () => ({
    name: form.name.trim(),
    category: form.category,
    color: form.color.trim() || null,
    // fit_style 这一列从 10-19 第三阶段起不再由表单产生（退役为展示标签，评分只认 fit_type）
    fit_type: ((fitTypeRequired && form.fit_type.trim()) || null) as
      WardrobeItem['fit_type'] | null,
    fabric_weight: (form.fabric_weight.trim() || null) as WardrobeItem['fabric_weight'] | null,
    pattern: form.pattern.trim() || null,
    shoulder_cm: toCm(form.shoulder_cm),
    bust_cm: toCm(form.bust_cm),
    length_cm: toCm(form.length_cm),
    waistband_cm: toCm(form.waistband_cm),
    style_tags: splitTags(form.style_tags),
    season_tags: splitTags(form.season_tags),
    occasion_tags: splitTags(form.occasion_tags),
    price: form.price ? Number(form.price) : null,
    // 条码那一格：空框发 null＝"这件不是扫来的"（PUT 那边 null 才是清空，见 api.ts PutPayload）
    sku: form.sku.trim() || null,
    // 照片同理：空框发 null＝把这张图从这条记录上摘掉（文件留在 uploads/ 由上传那条线自己管，
    // 这里不代它删盘，删照片另有 DELETE /api/clothing/:id）
    image_url: form.image_url.trim() || null,
  })

  const handleSubmit = async () => {
    if (submitting) return
    if (!form.name.trim()) {
      toast.error('请输入衣物名称')
      return
    }
    const measureErr = measureFormError()
    if (measureErr) {
      toast.error(measureErr)
      return
    }
    // 版型必选（上衣/外套/连衣裙）：这是"不动软尺也能跑公式"的那道闸门，不许留空
    const fErr = fitTypeError()
    if (fErr) {
      toast.error(fErr)
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
      setLoading(true)
      await fetchItems()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : editingId != null ? '保存失败' : '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------- 扫码录入（第五阶段·第一步「门店扫码快速录入」，2026-10-20） ---------- */

  /**
   * 扫一次条码：后端一次问两张表，这里按三种结果各说一句人话——
   * 静默是最坏的结局，店员会以为已经录进去了。
   * ① 自己衣柜里已有 ⇒ 不重复开空白表单，提示"已有 N 件同款"；
   * ② 门店库存里有 ⇒ 开新增表单并把名称/品类/标签/价格带出来，条码先填上；
   * ③ 两边都没有 ⇒ 也开新增表单（扫到的这件可能就是新品），但只带条码，并说清"名称品类请手填"。
   * ⚠️ ② 目前不分店（库存表没有分店那一列），多家店共用一张库存表时别店的同款也会被带出来。
   */
  const handleScan = async (raw: string) => {
    const sku = raw.trim()
    if (!sku) {
      toast.error('条码是空的：扫码枪扫一下，或手打吊牌上的编号再按回车')
      return
    }
    setScanBusy(true)
    try {
      const hit = await lookupWardrobeSku(sku)
      setScanValue('')

      if (hit.in_wardrobe) {
        const first = hit.mine[0]
        const dup = hit.mine.length > 1 ? `（同款 ${hit.mine.length} 件）` : ''
        toast.message(`衣柜里已有这件：${first.name || sku}${dup}——要改就点列表里那一行`)
        return
      }

      if (hit.in_inventory) {
        const p = hit.store[0]
        const nextCategory = WARDROBE_CATEGORIES.some((c) => c.value === p.category_code)
          ? (p.category_code as string)
          : WARDROBE_FORM_DEFAULT.category
        const colors = (p.color_tags ?? []).filter(Boolean)
        setForm({
          ...WARDROBE_FORM_DEFAULT,
          name: p.name ?? '',
          category: nextCategory,
          // 颜色只在库存给出唯一一色时才带：多色带进单一 color 格会变成"一格里塞两个词"，
          // 色彩那一维认不出反而算错（后端 colorMetrics 按单色解析）。
          color: colors.length === 1 ? colors[0] : '',
          style_tags: (p.style_tags ?? []).join(','),
          season_tags: (p.season_tags ?? []).join(','),
          price: p.price != null ? String(p.price) : '',
          sku: hit.sku,
          // 后台给这件商品传过图就一并带出来（只带地址，不重新上传）
          image_url: p.image_url ?? '',
        })
        setEditingId(null)
        setShowPhotoUpload(false)
        setShowAdd(true)
        const multi = hit.store.length > 1 ? `同码有 ${hit.store.length} 条，取最新一条` : ''
        const needFit = FIT_TYPE_CATEGORIES.includes(nextCategory)
        toast.success(
          `从门店库存带出「${p.name || hit.sku}」${multi ? '；' + multi : ''}${
            needFit ? '；版型（修身/合身/宽松/廓形）还差你选一下' : ''
          }`,
        )
        return
      }

      setForm({ ...WARDROBE_FORM_DEFAULT, sku: hit.sku })
      setEditingId(null)
      setShowPhotoUpload(false)
      setShowAdd(true)
      toast.message(`条码 ${hit.sku} 在你衣柜和门店库存里都没有 ⇒ 当新品录，名称与品类请手填`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '扫码查询失败')
    } finally {
      setScanBusy(false)
    }
  }

  /* ---------- 拍照上传（10-20 第五阶段·第一步定的口径：只存图，不识别） ---------- */

  const handlePhotoUpload = async (file: File): Promise<void> => {
    setPhotoUploading(true)
    try {
      const result: ClothingItem = await uploadClothing(file)
      // 这条上传链路后端只落 clothing_items 一张表，semantics 全为写死的占位
      // （category='未分类'、color='未知'、item_name='未命名'，见 backend/routes/clothing.js:68-75），
      // 本机没有视觉模型、外部识别 API 属掏钱项 ⇒ 本轮按他拍的「只存图」办：
      // 把图片地址带到衣柜这条记录上（image_url），识别一个字段都不填。
      // 下面这些守卫留着不删：哪天识别真接上了，占位值还是不能往表单里灌。
      const sem = result.semantics
      const knownCategory = WARDROBE_CATEGORIES.some((c) => c.value === sem?.category)
      if (!result.image_url) {
        toast.error('照片没存下来（后端没回图片地址）')
        return
      }
      setForm((prev) => ({
        ...prev,
        // 只存图 ⇒ 名称/颜色/版型一律保持用户自己的输入，识别占位不进表单
        name: sem?.item_name && sem.item_name !== '未命名' ? sem.item_name : prev.name,
        category: knownCategory ? (sem.category as string) : prev.category,
        color: sem?.color && sem.color !== '未知' ? sem.color : prev.color,
        image_url: result.image_url,
      }))
      setEditingId(null)
      setShowAdd(true)
      setShowPhotoUpload(false)
      toast.success('照片已存到这一件（识别暂未接入）：名称与版型请手填')
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
      setLoading(true)
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
    const byColor: Record<string, number> = {}
    let totalPrice = 0
    let priceCount = 0
    items.forEach((item) => {
      const cat = item.category || '其他'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      const color = item.color || '未标注'
      byColor[color] = (byColor[color] || 0) + 1
      if (item.price != null && !isNaN(Number(item.price))) {
        totalPrice += Number(item.price)
        priceCount += 1
      }
    })
    // 颜色取前 5，其余归"其他"
    const sortedColors = Object.entries(byColor).sort((a, b) => b[1] - a[1])
    const topColors = sortedColors.slice(0, 5)
    const otherColorCount = sortedColors.slice(5).reduce((s, [, c]) => s + c, 0)
    if (otherColorCount > 0) topColors.push(['其他', otherColorCount])
    return {
      total: items.length,
      byCategory,
      byColor: topColors,
      avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : null,
    }
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
        {stats.avgPrice != null && (
          <span className={pillCls} style={{ marginLeft: 'auto' }}>
            均价 ¥{stats.avgPrice}
          </span>
        )}
      </div>

      {/* 色彩洞察（借鉴 AI衣橱：颜色比例看板） */}
      {stats.byColor.length > 0 && (
        <div className="glass-card p-3 mb-3">
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--accent)' }}>
            🎨 色彩构成
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.byColor.map(([color, count]) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              return (
                <div key={color} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-full border"
                    style={{
                      backgroundColor: color.startsWith('#') ? color : '#ccc',
                      borderColor: 'var(--line)',
                    }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {color} {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 扫码录入（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
          键盘式扫码枪＝模拟键盘敲一串字符再自动按回车 ⇒ 只吃 Enter 一个动作就够，
          手打吊牌编号再回车走同一条路。查完三种结果都会说一句话，不静默。 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input
          className="form-input"
          style={{ flex: 1 }}
          placeholder="扫码枪扫条码 / 手打吊牌编号"
          value={scanValue}
          autoComplete="off"
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleScan(scanValue)
          }}
        />
        <button className="ghost-btn" onClick={() => handleScan(scanValue)} disabled={scanBusy}>
          {scanBusy ? <span className="spinner" /> : '查'}
        </button>
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
            {/* 版型（fit_type，10-19 第三阶段·模块一）：上衣/外套/连衣裙**必选**这一档。
                量不了软尺的人靠它把松量估出来（后端按区间中值估、覆盖率只按半格计），
                所以它是必填项，而下面的实测四格反而是选填。
                老的 fit_style（合体/宽松）从这一轮起退役成只读展示标签，表单不再产生它。 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={form.fit_type}
                onChange={(e) => setForm((prev) => ({ ...prev, fit_type: e.target.value }))}
              >
                <option value="">
                  {fitTypeRequired ? '版型（必选）' : '版型（这一类不需要）'}
                </option>
                {FIT_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
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
            <select
              className="form-select"
              value={form.pattern}
              onChange={(e) => setForm((prev) => ({ ...prev, pattern: e.target.value }))}
            >
              <option value="">条纹方向（选填，纯色就不选）</option>
              <option value="竖条">竖条</option>
              <option value="横条">横条</option>
            </select>
            {/* 成衣实测四格（10-19 第二阶段「最后一公里」）：量到了就按实测打分，优先级高于版型档。
                第三阶段把它折进"高级选项"——不挡人，量了更准；空着＝没量＝那一维不进分，系统不替你猜。 */}
            <details style={{ margin: '4px 0' }}>
              <summary style={{ fontSize: '12px', color: 'var(--muted)', cursor: 'pointer' }}>
                高级选项（选填）：用软尺量一下这四格，比只选版型更准
              </summary>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px' }}>
                衣服平铺量：肩宽＝两肩缝点直线距离，胸围＝袖窿下方一周最宽处，
                衣长＝肩颈点到下摆，腰头高＝腰头缝带自身高度（没有就填 0）
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="肩宽 cm"
                  value={form.shoulder_cm}
                  onChange={(e) => setForm((prev) => ({ ...prev, shoulder_cm: e.target.value }))}
                />
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="胸围 cm"
                  value={form.bust_cm}
                  onChange={(e) => setForm((prev) => ({ ...prev, bust_cm: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="衣长 cm"
                  value={form.length_cm}
                  onChange={(e) => setForm((prev) => ({ ...prev, length_cm: e.target.value }))}
                />
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="腰头高 cm（无腰头填 0）"
                  value={form.waistband_cm}
                  onChange={(e) => setForm((prev) => ({ ...prev, waistband_cm: e.target.value }))}
                />
              </div>
            </details>
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
            {/* 条码／店内编号（第五阶段·第一步）。扫出来的这一格可以被手改：
                吊牌码与店内自编码常常两套并存，锁死改不了就成死账。清空＝这件不算扫来的。 */}
            <input
              className="form-input"
              placeholder="条码 / 店内编号（扫码枪扫一下会自动填）"
              value={form.sku}
              onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
            />
            {/* 照片这一格（第五阶段·第一步「只存图」）：上面点了「📷 拍照上传」就有地址、
                预览出来让人核对拍的是不是这件；没有就只挂一句提示。⛔ 这里不做识别，
                地址是后端 /uploads/xxx.jpg 原样回的那串。外部地址只当文本摊出来、不让浏览器去取。 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {sameOriginImage(form.image_url) ? (
                <img
                  src={form.image_url}
                  alt="这件衣物的照片"
                  className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                  style={{ border: '1px solid var(--line)' }}
                />
              ) : form.image_url ? (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>外部地址不显示</span>
              ) : null}
              <span style={{ fontSize: '12px', color: 'var(--muted)', flex: 1 }}>
                {form.image_url
                  ? '照片已挂在这一件上'
                  : '没拍照：要带照片就点上方「📷 拍照上传」（只存图，系统不识别）'}
              </span>
              {form.image_url && (
                <button
                  className="ghost-btn"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={() => setForm((prev) => ({ ...prev, image_url: '' }))}
                >
                  不挂这张
                </button>
              )}
            </div>
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
            {/* 「只存图」那件把照片摊在列表上（没拍照的不占位；外部地址不请求，见 sameOriginImage） */}
            {sameOriginImage(item.image_url) && (
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

      {/* 穿搭日记（2026-10-20 第八阶段·一d）：衣橱页唯一的"记一笔今天穿了什么"入口。
          衣柜列表就是它的选择面 ⇒ 放在列表后面、分析按钮前面，顾客录完衣服顺手就能记。 */}
      <WardrobeDiary items={items} compact={compact} />

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
                      <span key={a.key} className={pillCls} title={evidenceLabel(a.tier)}>
                        {a.name_cn} {Math.round(a.score * 100)}
                      </span>
                    ))}
                    {t.axes_missing.length > 0 && (
                      <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
                        另 {t.axes_missing.length} 维没计入
                      </span>
                    )}
                  </div>
                  {/* 🔴 10-22 X6（依据/22 §七）：这一维凭什么撑得住原来只剩一枚 `title={a.tier}`
                      的裸字母（A/B/C/D），手机触屏点不出任何字 ⇒ 摊成行内一句人话，
                      字母与后端一个没改，只是不甩给顾客看。 */}
                  {t.axes.some((a) => a.tier) && (
                    <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '4px' }}>
                      依据：
                      {t.axes
                        .filter((a) => a.tier)
                        .map((a) => `${a.name_cn} ${evidenceLabel(a.tier)}`)
                        .join('／')}
                    </div>
                  )}
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

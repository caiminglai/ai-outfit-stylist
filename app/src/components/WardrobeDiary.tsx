/**
 * 穿搭日记（`wardrobe_outfits`）的顾客端入口（2026-10-20 第八阶段·第一步 一d）
 *
 * 为什么要有这一页：spec docs/依据/16 §一·1.2 现量到"这张表 0 行不是偶然"——后端只有
 * GET+POST、POST 的 INSERT 只写 6 列（`user_id`/`rating`/`is_favorite` 永远 NULL）、
 * 没有 PUT/DELETE，而 `grep -rn outfits app/src` 命中 **0 处** ⇒ 顾客根本没有地方能记。
 * 日记是"隐性偏好"与协同过滤唯一的原料来源，这条路不通，后面两层全是空转。
 *
 * 三条硬口径（都在代码里，不写在文档里就算了）：
 * ① **场合下拉吃后端带回来的词表**（`GET /outfits` 的 `occasions`），⛔ 不在这里抄第二份；
 *    词表为空 ⇒ 禁用下拉并说清"这一格先留空"，与后端那句 400 同一口径。
 * ② **星级＝这套整体满意（1~5，一格）**。审美/合身两把星在推荐卡的反馈链上
 *    （`feedback_events.aesthetic_score`/`fit_score`，一b 已接通）；日记这一列只有一格，
 *    本轮**零迁移**、不给它加列 ⇒ 要拆成两把星归你裁决（16 §七 新增第 7 条）。
 * ③ 再点同一颗星＝**取消**（送 null 清空，不送 0——0 会被后端拦成 400）。
 *
 * 🔴 2026-10-21 第十一阶段·第一步加的第 4 条口径（规范 `docs/依据/19` §七）：
 * ④ **这套是"哪天穿的、那天多冷"要能记**。表单加了穿着日期＋当天天气两块，天气两条路：
 *    按城市点「取今天」（走既有 `getWeatherProfile`，数据出处是 **Open-Meteo 公共接口**、无需密钥），
 *    或自己手选五档＋体感温度。五档词表同样**与闸门同源**（`GET /outfits` 的 `weather_levels`），
 *    ⛔ 不在前端抄第二份。三格全可选：⛔ 没有"默认舒适档"这回事，取不到天气就原样把后端那句中文
 *    贴出来（19 §九：不许说"系统知道你那里冷不冷"）；缺的格子在列表里显示"未记"，
 *    ⛔ 不许显示"未知/常温"那种冒充有数据的词。
 *
 * 多选的是**衣柜里已有的单品**（`items` 由衣橱页传进来），不接受手填 ID：
 * 后端 POST/PUT 会逐条校验归属，塞别人的 ID 直接 400，这里提前把选择面收在自有衣物上。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '../utils/toastOnce'
import type { WardrobeItem, WardrobeOutfit } from '../types'
import {
  listWardrobeOutfits,
  createWardrobeOutfit,
  updateWardrobeOutfit,
  deleteWardrobeOutfit,
  getWeatherProfile,
  type OutfitDraft,
} from '../api'
import { getWardrobeCategoryLabel, btnStyle } from './CabinetConstants'

interface WardrobeDiaryProps {
  items: WardrobeItem[]
  compact?: boolean
}

/** 季节四档：值与档案偏好那一列同形（types/index.ts:107 `season?: '春'|'夏'|'秋'|'冬'`） */
const SEASON_VALUES = ['春', '夏', '秋', '冬'] as const

/**
 * 今天（本地日历日，`YYYY-MM-DD`）。用途只有两处，⛔ 都不许变成"替用户补数据"：
 * ① 新记录的**默认**穿着日期（用户清空就是"不记"，提交的是 `null`，见下面 `save`）；
 * ② 「取今天」判断"我取到的这份天气是不是你要记的那一天"。
 * 后端按东八区校验日期，本机在东八区；跨时区的游客会差一天，那是已知边界（19 §三 第 2 条）。
 */
const todayISO = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const DRAFT_DEFAULT = (): OutfitDraft => ({
  name: `${todayISO().slice(5)}的搭配`,
  item_ids: [],
  occasion: null,
  season: null,
  rating: null,
  notes: '',
  // 🔴 三格默认值就是"没记"（⛔ 不许默认天气档，硬规矩 2 在采集层的落地）
  wear_date: todayISO(),
  weather_level: null,
  feels_like_c: null,
})

/** 表单里的日记行：可选列用 null 表示"这一格空着"，与 PUT 的清空口径对齐。
 *  数字那一格在表单里存**字符串**（受控 input 的老问题：`number | null` 会让"清空"与"0"分不开） */
interface RowDraft {
  name: string
  item_ids: number[]
  occasion: string | null
  season: string | null
  rating: number | null
  notes: string
  wear_date: string
  weather_level: string | null
  feels_like_c: string
}

const toRowDraft = (d: OutfitDraft): RowDraft => ({
  name: d.name,
  item_ids: [...d.item_ids],
  occasion: d.occasion ?? null,
  season: d.season ?? null,
  rating: d.rating ?? null,
  notes: d.notes ?? '',
  wear_date: d.wear_date ?? '',
  weather_level: d.weather_level ?? null,
  feels_like_c:
    d.feels_like_c === null || d.feels_like_c === undefined ? '' : String(d.feels_like_c),
})

/**
 * 列表行上"那天的天气"这一句的读法（19 §七 第 3 条）：
 * 有档说档，只有体感温度就说体感，两格都没有就说"未记"。
 * ⛔ 不许写"未知/常温/舒适"——那是拿缺测冒充有数据（硬规矩 2 在文案层的落地）。
 */
const weatherLabel = (row: WardrobeOutfit): string => {
  if (row.weather_level) return row.weather_level
  if (typeof row.feels_like_c === 'number') return `体感 ${row.feels_like_c}℃`
  return '未记'
}

/** 一行五星；再点同一颗＝取消（与推荐卡那把星同一交互契约） */
function DiaryStars({
  value,
  disabled,
  onPick,
}: {
  value: number | null
  disabled: boolean
  onPick: (v: number | null) => void
}) {
  const shown = value ?? 0
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
      <span>满意</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          title={n === shown ? '再点一下取消这排星' : '这套穿得满意吗（1~5）'}
          onClick={() => onPick(n === shown ? null : n)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0 1px',
            fontSize: '14px',
            lineHeight: 1,
            cursor: disabled ? 'default' : 'pointer',
            color: n <= shown ? 'var(--accent)' : 'var(--line)',
          }}
        >
          {n <= shown ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}

export default function WardrobeDiary({ items, compact }: WardrobeDiaryProps) {
  const [rows, setRows] = useState<WardrobeOutfit[]>([])
  const [occasions, setOccasions] = useState<string[]>([])
  // 五档词表与闸门同源（`GET /outfits` 的 `weather_levels`），⛔ 不在这里抄第二份
  const [weatherLevels, setWeatherLevels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<RowDraft>(() => toRowDraft(DRAFT_DEFAULT()))
  const [saving, setSaving] = useState(false)
  // 「取今天」那一路：城市输入框只在点按钮时用一次，⛔ 不写进任何一格的默认值
  const [city, setCity] = useState('')
  const [fetchingWeather, setFetchingWeather] = useState(false)

  const nameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const it of items) if (typeof it.id === 'number') m.set(it.id, it.name)
    return m
  }, [items])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listWardrobeOutfits()
      setRows(r.outfits ?? [])
      setOccasions(r.occasions ?? [])
      setWeatherLevels(r.weather_levels ?? [])
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '日记读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggleItem = (id?: number) => {
    if (typeof id !== 'number') return
    setDraft((prev) => ({
      ...prev,
      item_ids: prev.item_ids.includes(id)
        ? prev.item_ids.filter((x) => x !== id)
        : [...prev.item_ids, id],
    }))
  }

  const startAdd = () => {
    setEditingId(null)
    setDraft(toRowDraft(DRAFT_DEFAULT()))
    setOpen(true)
  }

  const startEdit = (row: WardrobeOutfit) => {
    if (!row.id) return
    setEditingId(row.id)
    setDraft(
      toRowDraft({
        name: row.name,
        item_ids: row.item_ids ?? [],
        occasion: row.occasion ?? null,
        season: row.season ?? null,
        rating: row.rating ?? null,
        notes: row.notes ?? '',
        wear_date: row.wear_date ?? null,
        weather_level: row.weather_level ?? null,
        feels_like_c: row.feels_like_c ?? null,
      }),
    )
    setOpen(true)
  }

  /**
   * 「按城市取今天的天气」——出处是 **Open-Meteo 公共接口**（无需密钥，`api.open-meteo.com`），
   * 只有那 10 个城市支持；取不到就原样把后端那句中文贴出来，⛔ 绝不静默降级成"帮你选舒适档"。
   *
   * 🔴 一条必须守住的诚实：取到的是**今天**的天气。如果这一笔记的不是今天，
   * 那就不能把它写进"那天的天气"这一格（那是假数据）⇒ 只提示、不落笔，请用户手选那一天的档。
   */
  const fetchTodayWeather = async () => {
    const loc = city.trim()
    if (!loc) return toast.error('先写个城市名（只有 10 个城市支持，不在里面的就自己选档）')
    setFetchingWeather(true)
    try {
      const p = await getWeatherProfile(loc)
      const level = p?.profile?.level ?? null
      const feels = typeof p?.weather?.feelsLike === 'number' ? p.weather.feelsLike : null
      if (!level && feels === null) {
        return toast.error('上游没回温度也没回档位 ⇒ 这一格还是空的，请自己选')
      }
      const isToday = draft.wear_date === todayISO()
      if (draft.wear_date && !isToday) {
        toast.message(
          `这是今天（${todayISO()}）${loc} 的天气，你记的是 ${draft.wear_date} ⇒ 没写进去`,
        )
        return
      }
      setDraft((prev) => ({
        ...prev,
        wear_date: prev.wear_date || todayISO(),
        weather_level: level ?? prev.weather_level,
        feels_like_c: feels === null ? prev.feels_like_c : String(feels),
      }))
      toast.success(level ? `今天${loc}：${level}` : `今天${loc}：体感 ${feels}℃`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '取天气失败，这一格自己填或直接留空')
    } finally {
      setFetchingWeather(false)
    }
  }

  const save = async () => {
    if (!draft.name.trim()) return toast.error('给这一套起个名字（比如"10-21 通勤"）')
    if (draft.item_ids.length === 0) return toast.error('至少选一件衣柜里的单品')
    // 体感那一格：填了就必须是个数（⛔ 不许把它悄悄洗成 null 当没事发生，那等于把脏数据吞了）
    const feelsRaw = draft.feels_like_c.trim()
    const feels = feelsRaw === '' ? null : Number(feelsRaw)
    if (feelsRaw !== '' && !Number.isFinite(feels)) return toast.error('体感温度得是个数字')
    setSaving(true)
    const payload: OutfitDraft = {
      name: draft.name.trim(),
      item_ids: draft.item_ids,
      occasion: draft.occasion,
      season: draft.season,
      rating: draft.rating,
      notes: draft.notes.trim() ? draft.notes.trim() : null,
      // 三格全走"传 null＝清空"那条口径（19 §三 第 5 条）：日期清空就是不记，⛔ 不拿今天兜底
      wear_date: draft.wear_date.trim() || null,
      weather_level: draft.weather_level,
      feels_like_c: feels,
    }
    try {
      if (editingId) await updateWardrobeOutfit(editingId, payload)
      else await createWardrobeOutfit(payload)
      toast.success(editingId ? '这一笔改好了' : '记下了')
      setOpen(false)
      setEditingId(null)
      await load()
    } catch (e: unknown) {
      // 后端的 400 话术（场合表外词／星级越界／衣物不属于本人）原样递出去，不吞成"保存失败"
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id?: number) => {
    if (!id) return
    try {
      await deleteWardrobeOutfit(id)
      toast.success('这一笔删了（衣柜里的衣服没动）')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const toggleFavorite = async (row: WardrobeOutfit) => {
    if (!row.id) return
    try {
      await updateWardrobeOutfit(row.id, { is_favorite: !row.is_favorite })
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '更新失败')
    }
  }

  const inputCls = 'form-input'
  const labelCls = 'section-title'

  return (
    <div className="glass-card p-3 mt-3 animate-fade-in">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span className={labelCls}>穿搭日记</span>
        <button
          className="ghost-btn"
          style={btnStyle(compact)}
          onClick={() => (open ? setOpen(false) : startAdd())}
        >
          {open ? '收起' : '＋ 记一笔'}
        </button>
      </div>

      <div style={{ color: 'var(--muted)', fontSize: '11px', lineHeight: 1.6, marginTop: '4px' }}>
        按你自己记下的搭配和那天的天气，把常穿的那一档稍微排前一点。
        这不是机器学习，也不替你猜天气：哪一天、冷不冷都得你自己填，样本不够时它一个字也不改你的排序。
      </div>

      {open && (
        <div
          className="glass-card"
          style={{ padding: '10px', background: 'var(--bg)', marginTop: '8px' }}
        >
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className={inputCls}
              style={{ flex: 1, minWidth: '140px' }}
              placeholder="这一套叫什么"
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            />
            <select
              className={inputCls}
              style={{ minWidth: '110px' }}
              value={draft.occasion ?? ''}
              disabled={occasions.length === 0}
              title={
                occasions.length === 0
                  ? '规则库里的场合词表还是空的 ⇒ 这一格先留空，等词表建好再补'
                  : '只收规则库在用的那几组场合词（表外词命不中任何规则 ⇒ 采了白采）'
              }
              onChange={(e) => setDraft((p) => ({ ...p, occasion: e.target.value || null }))}
            >
              <option value="">场合（可不填）</option>
              {occasions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              style={{ minWidth: '84px' }}
              value={draft.season ?? ''}
              onChange={(e) => setDraft((p) => ({ ...p, season: e.target.value || null }))}
            >
              <option value="">季节（可不填）</option>
              {SEASON_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {/* 🔴 10-22 X6（依据/22 §七 闸门）：「场合」这一格为什么能选/不能选，原来只有 hover
              才读到（手机没有 hover）⇒ 摊成行内一句。词表为空的口径照后端原话，⛔ 不在前端抄一份名单。 */}
          <div
            style={{ color: 'var(--muted)', fontSize: '11px', lineHeight: 1.6, marginTop: '4px' }}
          >
            {occasions.length === 0
              ? '「场合」的词表还是空的 ⇒ 这一格先留空，等词表建好再补。'
              : '「场合」只收规则库在用的那几组词——词表外的说法命不中任何规则，采了也白采。'}
          </div>

          <div className={labelCls} style={{ marginTop: '10px' }}>
            哪天穿的 · 那天什么天气
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              className={inputCls}
              style={{ minWidth: '140px' }}
              // 后端按东八区拦"未来的日期"（19 §三 第 2 条），这里同步挡在选框上：
              // 挡不住也照样会 400 说破，⛔ 不是把脏值悄悄改成今天
              max={todayISO()}
              value={draft.wear_date}
              onChange={(e) => setDraft((p) => ({ ...p, wear_date: e.target.value }))}
              title="这套是哪天穿的。清空＝不记这一天（⛔ 提交时不会拿今天替你兜底）"
            />
            <input
              className={inputCls}
              style={{ minWidth: '96px' }}
              inputMode="decimal"
              placeholder="体感℃（可不填）"
              value={draft.feels_like_c}
              onChange={(e) => setDraft((p) => ({ ...p, feels_like_c: e.target.value }))}
              title="那一天手上的温度计或天气页里的“体感”那一个数；不填就留空"
            />
            <input
              className={inputCls}
              style={{ flex: 1, minWidth: '110px' }}
              placeholder="城市名，如 北京"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              title="只有后端支持的那 10 个城市取得到；取不到就自己点下面那一排档"
            />
            <button
              className="ghost-btn"
              style={btnStyle(compact)}
              onClick={() => void fetchTodayWeather()}
              disabled={fetchingWeather}
              title="取今天这城市的天气（Open-Meteo 公共接口，无需密钥）。记的不是今天时它不会写进这一格"
            >
              {fetchingWeather ? <span className="spinner" /> : '取今天'}
            </button>
          </div>
          {/* 🔴 10-22 X6：这一排四个格子的"该怎么填"原来全是 hover-only（触屏读不到）⇒ 收成行内一句。
              ⛔ 内部写法不外露：原话里的「送 null 清空，不是送 0」是代码口径，改成顾客能懂的动作。 */}
          <div
            style={{ color: 'var(--muted)', fontSize: '11px', lineHeight: 1.6, marginTop: '4px' }}
          >
            日期清空＝这一笔不记那天（提交时不会自动拿今天替你填）；体感℃填那天天气页里"体感"那一个数，
            没有就留空；城市名只有系统认得的那 10 个能自动取到，取不到就自己点下面那一排档——
            那一排是那天自己觉得是哪一档，再点一下就取消。「取今天」走的是公共天气接口（Open-Meteo，不用密钥），
            记的不是今天时它不会写进这一格。
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {weatherLevels.length === 0 ? (
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
                天气档的词表还没从后端带回来 ⇒ 这一格先留空（⛔ 不在前端抄一份档位名单）。
              </span>
            ) : (
              weatherLevels.map((lv) => {
                const on = draft.weather_level === lv
                return (
                  <button
                    key={lv}
                    type="button"
                    disabled={saving}
                    title={on ? '再点一下取消这一档' : '那天自己觉得是哪一档'}
                    onClick={() =>
                      setDraft((p) => ({ ...p, weather_level: p.weather_level === lv ? null : lv }))
                    }
                    style={{
                      ...btnStyle(compact),
                      borderColor: on ? 'var(--accent)' : 'var(--line)',
                      color: on ? 'var(--accent)' : 'var(--muted)',
                      background: on ? 'rgba(255,255,255,0.06)' : 'transparent',
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {lv}
                  </button>
                )
              })
            )}
          </div>

          <div className={labelCls} style={{ marginTop: '10px' }}>
            今天穿了哪几件
          </div>
          {items.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
              衣柜还是空的 ⇒ 先回上面添几件衣服，日记要选的是衣柜里已有的单品。
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {items.map((it) => {
                const on = typeof it.id === 'number' && draft.item_ids.includes(it.id)
                return (
                  <button
                    key={it.id ?? it.name}
                    type="button"
                    onClick={() => toggleItem(it.id)}
                    style={{
                      ...btnStyle(compact),
                      borderColor: on ? 'var(--accent)' : 'var(--line)',
                      color: on ? 'var(--accent)' : 'var(--muted)',
                      background: on ? 'rgba(255,255,255,0.06)' : 'transparent',
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {it.name}
                    <span style={{ opacity: 0.6, marginLeft: '4px' }}>
                      {getWardrobeCategoryLabel(it.category)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: '10px',
            }}
          >
            <input
              className={inputCls}
              style={{ flex: 1, minWidth: '140px' }}
              placeholder="备注（可选，比如「今天下雨换的鞋」）"
              value={draft.notes}
              onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            />
            <DiaryStars
              value={draft.rating}
              disabled={saving}
              onPick={(v) => setDraft((p) => ({ ...p, rating: v }))}
            />
            <button
              className="ghost-btn"
              style={btnStyle(compact)}
              onClick={save}
              disabled={saving}
            >
              {saving ? <span className="spinner" /> : editingId ? '保存修改' : '记下来'}
            </button>
            <button
              className="ghost-btn"
              style={btnStyle(compact)}
              onClick={() => {
                setOpen(false)
                setEditingId(null)
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '8px' }}>读取中…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '8px' }}>
          还没有一笔记录。点右上「＋ 记一笔」开始。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {rows.map((row) => (
            <div
              key={row.id ?? row.name}
              className="glass-card"
              style={{ padding: '10px', background: 'var(--bg)' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                  {row.is_favorite ? '⭐ ' : ''}
                  {row.name}
                </span>
                <DiaryStars
                  value={row.rating ?? null}
                  disabled={saving}
                  onPick={async (v) => {
                    if (!row.id) return
                    try {
                      await updateWardrobeOutfit(row.id, { rating: v })
                      await load()
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : '更新失败')
                    }
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                {(row.item_ids ?? []).map((id) => (
                  <span key={id} className="pill-tag">
                    {nameById.get(id) ?? `#${id}（衣柜里已没有这件）`}
                  </span>
                ))}
                {row.occasion && <span className="pill-tag">{row.occasion}</span>}
                {row.season && <span className="pill-tag">{row.season}</span>}
                {/* 🔴 第十一阶段：哪天穿的＋那天什么天气，缺格只说"未记"（⛔ 不写"未知/常温"） */}
                <span className="pill-tag">穿的 {row.wear_date || '未记'}</span>
                <span className="pill-tag">天气 {weatherLabel(row)}</span>
                {row.notes && <span className="pill-tag">{row.notes}</span>}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button
                  className="ghost-btn"
                  style={btnStyle(compact)}
                  onClick={() => startEdit(row)}
                >
                  修改
                </button>
                <button
                  className="ghost-btn"
                  style={btnStyle(compact)}
                  onClick={() => void toggleFavorite(row)}
                >
                  {row.is_favorite ? '取消常用' : '设为常用'}
                </button>
                <button
                  className="ghost-btn"
                  style={btnStyle(compact)}
                  onClick={() => void remove(row.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

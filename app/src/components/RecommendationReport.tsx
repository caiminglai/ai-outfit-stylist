/** 建议报告页 - 门店/个人模式 + 天气/AI文案/星座/试穿增强功能 */
import { useEffect, useState } from 'react'
import type {
  CustomerProfile,
  EngineRecommendation,
  InventoryProduct,
  RuleRecommendationItem,
  WeatherData,
} from '../types'
import {
  deleteItemFeedback,
  deleteRuleFeedback,
  getItemFeedback,
  postItemFeedback,
  postRuleFeedback,
} from '../api'
import InventoryCard from './InventoryCard'
import AlgorithmAnalysisCard from './recommend/AlgorithmAnalysis'
import EnhancedTextCard from './recommend/EnhancedTextCard'
import EvidenceTag from './recommend/EvidenceTag'
import HoroscopeCard from './recommend/HoroscopeCard'
import { TAB_LABEL, TABS } from './recommend/RecommendTab'
import { FIELD_LABELS, HIDDEN_FIELDS } from './recommend/reportFields'
import TryonCard from './recommend/TryonCard'
import TopSpecCard from './recommend/TopSpecCard'
import WeatherCard from './recommend/WeatherCard'

/** 两把星的哪一把（10-19 第三阶段·模块三）：审美＝这套好不好看，合身＝上衣上身合不合身 */
type StarKind = 'aesthetic' | 'fit'

const STAR_LABELS: Record<StarKind, { label: string; note: string }> = {
  aesthetic: { label: '好看', note: '这套搭配整体好不好看（主要对着色彩那一维）' },
  fit: { label: '合身', note: '上衣穿在身上合不合身（主要对着廓形那一维）' },
}

/**
 * 一行五星。点同一颗最高的星＝取消这一把（送 null 清空，不是送 0——0 会被后端拦成 400）。
 * ⛔ 不用 <input type=range>：星级是离散的五档，滑条在手机上会给出"3.4 星"这种后端不收的值。
 */
function StarRow({
  kind,
  value,
  busy,
  onPick,
}: {
  kind: StarKind
  value: number | null
  busy: boolean
  onPick: (v: number | null) => void
}) {
  const shown = value ?? 0
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
      <span>{STAR_LABELS[kind].label}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={busy}
          className="star-btn"
          title={
            n === shown ? `再点一下取消这${STAR_LABELS[kind].label}的星` : STAR_LABELS[kind].note
          }
          onClick={() => onPick(n === shown ? null : n)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0 1px',
            fontSize: '14px',
            lineHeight: 1,
            cursor: busy ? 'default' : 'pointer',
            color: n <= shown ? 'var(--accent)' : 'var(--line)',
          }}
        >
          {n <= shown ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}

interface RecommendationReportProps {
  recommendation: EngineRecommendation
  profile: CustomerProfile
  mode: 'store' | 'personal'
  sessionId?: string
  onSync?: () => void
  onDelete?: () => void
  onBack?: () => void
  synced?: boolean
  syncing?: boolean
  compact?: boolean
  /** 🔴 §四·1：顾客在天气卡里选了哪个城市（上一份报告算的时候用的是哪一个） */
  weatherCity?: string | null
  /** 上一次生成时后端给的天气出处账：'live'＝按体感温度折了档；'failed'＝名单外或上游没取到 */
  weatherSource?: 'live' | 'failed' | null
  /** 'failed' 时后端那句人话（含可选城市名单回显），原样显示，⛔ 前端自己编第二句 */
  weatherNotice?: string | null
  /** 选了城市之后按这个城市重算一遍穿搭（⛔ 不自动定位，点了才算，`19` §一 已裁） */
  onRegenerate?: () => void
  /** 城市变了要通知上层：真正调 `/engine` 的在那里，本组件不自己发推荐请求 */
  onWeatherCityChange?: (c: string | null) => void
  /**
   * 🔴 10-22 第十四阶段·第一步 X8：后端随推荐结果一起带回的那句隐私声明（真相源见
   * `pages/ExhibitionHall.tsx` 的 `privacyNotice` 注释）。有就显示、没有就**整行不出现**，
   * ⛔ 显示"未知"、⛔ 前端自己补一句承诺。
   */
  privacyNotice?: string
}

export default function RecommendationReport({
  recommendation,
  profile,
  mode,
  sessionId,
  onSync,
  onDelete,
  onBack,
  synced,
  syncing,
  compact,
  weatherCity,
  weatherSource,
  weatherNotice,
  onRegenerate,
  onWeatherCityChange,
  privacyNotice,
}: RecommendationReportProps) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('穿搭')
  // 天气数据,供 AI 文案增强使用
  const [weather, setWeather] = useState<WeatherData | null>(null)
  // 🔴 §四·1：这张卡里当前选中的城市，要一起送进 /engine 当这一屏排序的输入
  const [city, setCity] = useState<string | null>(weatherCity ?? null)
  // 虚拟试穿面板展开状态
  const [tryonOpen, setTryonOpen] = useState(false)
  // "为什么推荐"展开状态(按 group_id 记录哪些卡片展开了)
  const [explainOpen, setExplainOpen] = useState<Record<number, boolean>>({})

  /** 切换某条推荐的"为什么推荐"展开/收起 */
  const toggleExplain = (groupId: number): void => {
    setExplainOpen((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  // 反馈:本次会话每条规则点成了什么(后端按人+规则覆盖,重复点不会累加)
  const [myFeedback, setMyFeedback] = useState<Record<number, 'useful' | 'inaccurate'>>({})
  /**
   * 第八阶段·一b（10-20）：只打星、没点👍/👎时提交的是 `signal='rated'`。
   * 这一格单独记——`myFeedback` 只表示"表过态"，把 rated 混进去会让👍/👎按钮亮起、
   * 让"已记录"这句话变成对用户没做的事的承诺（文案红线见 docs/依据/16 §一·1.1）。
   */
  const [ratedSaved, setRatedSaved] = useState<Record<number, boolean>>({})
  const [feedbackBusy, setFeedbackBusy] = useState(0)
  const [feedbackError, setFeedbackError] = useState('')
  /** 规则卡抹最后一颗星被挡回去时的提示落在哪一条上（与衣橱那路的 `itemClearHint` 同一形） */
  const [ruleClearHint, setRuleClearHint] = useState(0)
  /**
   * 两把星（10-19 第三阶段·模块三）：审美＝这套好不好看，合身＝上衣穿在身上合不合身。
   * 键不存在＝这一格这次没动（后端 undefined 契约），显式存 null＝要点成"清空"。
   */
  const [myStars, setMyStars] = useState<Record<number, Partial<Record<StarKind, number | null>>>>(
    {},
  )

  /**
   * 提交一条反馈。星级与打分快照跟着 signal 一起走：
   * 快照取这张卡自己的 `item.rank`（后端 rankDims 的出账结构），事后再查就是另一把尺子了。
   */
  const submitFeedback = async (
    groupId: number,
    signal: 'useful' | 'inaccurate' | 'rated',
    item: RuleRecommendationItem,
    /**
     * 点星那一路要显式把新值传进来：`setMyStars` 之后立刻提交时，闭包里的 `myStars`
     * 还是渲染时那份，读状态会少送一步（React 状态更新不是同步的）。
     */
    stars?: Partial<Record<StarKind, number | null>>,
  ): Promise<void> => {
    if (feedbackBusy !== 0) return
    setFeedbackBusy(groupId)
    setFeedbackError('')
    const st = stars ?? myStars[groupId] ?? {}
    const extras: Parameters<typeof postRuleFeedback>[3] = { rank: item.rank ?? null }
    // 没碰过的星不给键（undefined＝这次不动这一格），碰过的连"改成空"一起送
    if ('aesthetic' in st) extras.aesthetic_score = st.aesthetic ?? null
    if ('fit' in st) extras.fit_score = st.fit ?? null
    if (item.wardrobe_item_id != null) extras.wardrobe_item_id = item.wardrobe_item_id
    try {
      const back = await postRuleFeedback(groupId, activeTab, signal, extras)
      // rated 只记"星已存"，不写进 myFeedback（myFeedback 的语义是"表过态"，按钮高亮靠它）
      if (signal === 'rated') setRatedSaved((prev) => ({ ...prev, [groupId]: true }))
      else setMyFeedback((prev) => ({ ...prev, [groupId]: signal }))
      // 以库里回来的那份为准回填（越界值会被后端 400，这里拿到的一定是 1~5 或 null）
      setMyStars((prev) => ({
        ...prev,
        [groupId]: {
          ...(prev[groupId] || {}),
          aesthetic: back.aesthetic_score ?? null,
          fit: back.fit_score ?? null,
        },
      }))
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '反馈没存上，再点一次')
    } finally {
      setFeedbackBusy(0)
    }
  }

  /**
   * 点星：第八阶段·一b（10-20）起**立刻提交**，不再等用户点👍/👎。
   * 表过态就沿用自己的 signal 只补星；没表过态走 `rated`（后端 10-19 之前会把这种提交 400 掉，
   * 现在收这一档）。
   *
   * 🔴 10-22 第十四阶段·第一步 X4：抹掉最后一颗星＝整条撤销，这一种形态**不走 POST**。
   * POST 那一档 `rated` 硬性要求至少一把星（后端防空壳行），改前这里只要 `ratedSaved` 已为真
   * 就照样提交 ⇒ 顾客把刚打的两颗星都点掉，换来一条红字＋一条吐司，星还抹不回"没评过"。
   * 现在与衣橱那一路（下面 `pickItemStar`）**同形**：挡回去、给一句人话、让他点「清除评分」，
   * 那条按钮走 `DELETE /api/recommend/feedback/group`（`docs/依据/22` §五）。
   * ⛔ 不许改成"送两颗 null 给 POST"，那是撞守卫。
   */
  const pickStar = (
    groupId: number,
    kind: StarKind,
    value: number | null,
    item: RuleRecommendationItem,
  ): void => {
    const other: StarKind = kind === 'aesthetic' ? 'fit' : 'aesthetic'
    const prevStars = myStars[groupId] || {}
    const signal = myFeedback[groupId]
    // 表过态（👍/👎）时星清空是合法提交（signal 带着一维信息，不是空壳行），照旧走 POST
    if (value === null && prevStars[other] == null && !signal) {
      const next = { ...prevStars, [kind]: null }
      setMyStars((prev) => ({ ...prev, [groupId]: next }))
      setRuleClearHint(groupId)
      return
    }
    setRuleClearHint(0)
    const next = { ...prevStars, [kind]: value }
    setMyStars((prev) => ({ ...prev, [groupId]: next }))
    if (signal || ratedSaved[groupId] || Object.values(next).some((v) => v != null)) {
      void submitFeedback(groupId, signal ?? 'rated', item, next)
    }
  }

  /**
   * 清除这条规则上的整行反馈（10-22 第十四阶段·第一步 X4）。
   * 三条口径与后端同源（`docs/依据/22` §五）：只按自己的 `user_id` 删；
   * 本来就没评过也回成功（`deleted:0`，幂等）；删完两把星与👍/👎一律回未评态，
   * 规则的好评/差评数由后端从 `feedback_events` 现数重算（⛔ 前端自己做减法）。
   */
  const clearRuleStars = async (groupId: number): Promise<void> => {
    if (feedbackBusy !== 0) return
    setFeedbackBusy(groupId)
    setFeedbackError('')
    try {
      await deleteRuleFeedback(groupId)
      setMyStars((prev) => ({ ...prev, [groupId]: {} }))
      // 回到"没表过态"：`myFeedback` 的类型只有 'useful' | 'inaccurate'，
      // 所以是删键、不是写 undefined（写 undefined 在 tsc 下是另一套口径）
      setMyFeedback((prev) => {
        const rest = { ...prev }
        delete rest[groupId]
        return rest
      })
      setRatedSaved((prev) => ({ ...prev, [groupId]: false }))
      setRuleClearHint(0)
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '这条的评分没清掉，再点一次')
    } finally {
      setFeedbackBusy(0)
    }
  }

  /**
   * 衣橱那一路的两把星（10-21 第九阶段·第一步，`docs/依据/17` §五 第 4 条）。
   *
   * 🔴 键是 `wardrobe_item_id`，**不能**跟上面那套 `myStars`（键＝`group_id`）合用一张表：
   * 两个键都是数字，3 号规则和 3 号衣柜行会串成同一条。
   * 提交走 `POST /api/recommend/feedback/item`（人×衣服那本账），
   * ⛔ 不走 `postRuleFeedback`——那张表评"这条规则准不准"、会回写好评差评数，
   * 而衣橱这一路的 `group_id` 是 null，那张表连这一条都收不下（`schema.sql:301` 的 NOT NULL）。
   * 也没有👍/👎：那对按钮的语义是"规则准不准"，套在"这件衣服我穿得怎么样"上是两回事。
   */
  const [itemStars, setItemStars] = useState<
    Record<number, Partial<Record<StarKind, number | null>>>
  >({})
  const [itemBusy, setItemBusy] = useState(0)
  const [itemSaved, setItemSaved] = useState<Record<number, boolean>>({})
  /** 用户点了"取消最后一颗星"被挡回去时，在这一条下面说明白为什么挡（不静默、也不报接口错） */
  const [itemClearHint, setItemClearHint] = useState(0)

  const items: RuleRecommendationItem[] = recommendation[activeTab] || []

  // 这一屏里可以打分的衣柜行（后端把量过尺寸／选过版型的那几件混进候选池时才非空）
  const wardrobeIds = items
    .filter((it) => it.source === 'wardrobe' && it.wardrobe_item_id != null)
    .map((it) => it.wardrobe_item_id as number)
  // 依赖用拼好的串：数组每次渲染都是新的，直接进依赖数组会一遍一遍重发同一个请求
  const wardrobeIdsKey = wardrobeIds.join(',')

  /** 回填自己已有的星：只读自己的（后端的查询键就是 actor_key，跨人的读数压根不给） */
  useEffect(() => {
    const ids = wardrobeIdsKey ? wardrobeIdsKey.split(',').map(Number) : []
    if (ids.length === 0) return
    let alive = true
    void getItemFeedback(ids)
      .then((r) => {
        if (!alive) return
        for (const row of r.items || []) {
          setItemStars((prev) => ({
            ...prev,
            [row.wardrobe_item_id]: {
              ...(prev[row.wardrobe_item_id] || {}),
              aesthetic: row.aesthetic_score ?? null,
              fit: row.fit_score ?? null,
            },
          }))
          if (row.aesthetic_score != null || row.fit_score != null) {
            setItemSaved((prev) => ({ ...prev, [row.wardrobe_item_id]: true }))
          }
        }
      })
      .catch(() => {
        /* 读不回来只是星显示成空，打分照打：写路径自己会把 400/401 说破，这里不编故事 */
      })
    return () => {
      alive = false
    }
  }, [wardrobeIdsKey])

  /** 真的发一次：星级按 `undefined＝不动／null＝清空` 送，快照跟着这张卡自己的 `item.rank` */
  const submitItemFeedback = async (
    itemId: number,
    kind: StarKind,
    value: number | null,
    item: RuleRecommendationItem,
  ): Promise<void> => {
    if (itemBusy !== 0) return
    setItemBusy(itemId)
    setFeedbackError('')
    const next = { ...(itemStars[itemId] || {}), [kind]: value }
    setItemStars((prev) => ({ ...prev, [itemId]: next }))
    const extras: Parameters<typeof postItemFeedback>[1] = { rank: item.rank ?? null }
    if ('aesthetic' in next) extras.aesthetic_score = next.aesthetic ?? null
    if ('fit' in next) extras.fit_score = next.fit ?? null
    try {
      const back = await postItemFeedback(itemId, extras)
      setItemStars((prev) => ({
        ...prev,
        [itemId]: { aesthetic: back.aesthetic_score ?? null, fit: back.fit_score ?? null },
      }))
      setItemSaved((prev) => ({ ...prev, [itemId]: true }))
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '这件的分没存上，再点一次')
    } finally {
      setItemBusy(0)
    }
  }

  const pickItemStar = (
    itemId: number,
    kind: StarKind,
    value: number | null,
    item: RuleRecommendationItem,
  ): void => {
    const other: StarKind = kind === 'aesthetic' ? 'fit' : 'aesthetic'
    const prevStars = itemStars[itemId] || {}
    // 把最后一颗星也抹掉＝整条撤销，而 POST 那一路"不许写空壳行"（后端同样 400）。
    // 10-22 第十三阶段·§四·2 起撤销有专门的口了：下面那块「清除评分」走
    // `DELETE /api/recommend/feedback/item`，这里就把它指过去，不再回一句"只能改不能撤"。
    if (value === null && prevStars[other] == null) {
      setItemClearHint(itemId)
      return
    }
    setItemClearHint(0)
    void submitItemFeedback(itemId, kind, value, item)
  }

  /**
   * 清除这件衣服上的评分（10-22 第十三阶段·第一步 §四·2「衣橱的星可以撤」）。
   *
   * 三条口径与后端同源（`docs/依据/21` §四·2）：
   *  · 只按自己的 `actor_key` 删，删不到别人的行；库里回 `deleted:0` 也当成功（幂等）；
   *  · ⛔ 不回滚规则的好评差评数、⛔ 不动 `feedback_events`——那是"这条规则准不准"的另一层语义；
   *  · 点完两把星回未评态：本地那份读数直接抹掉，下一次进这一屏 `getItemFeedback` 也读不回来。
   */
  const clearItemStars = async (itemId: number): Promise<void> => {
    if (itemBusy !== 0) return
    setItemBusy(itemId)
    setFeedbackError('')
    try {
      await deleteItemFeedback(itemId)
      setItemStars((prev) => ({ ...prev, [itemId]: {} }))
      setItemSaved((prev) => ({ ...prev, [itemId]: false }))
      setItemClearHint(0)
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '这件的评分没清掉，再点一次')
    } finally {
      setItemBusy(0)
    }
  }

  const inventory: InventoryProduct[] = recommendation.inventory?.[activeTab] || []
  const analysis = recommendation.algorithm_analysis

  /**
   * 摘要卡那排药丸读的就是这 10 个字段（10-22 第十四阶段·第一步 X5 起，它们同时是诚实读数
   * 「本次量到 N／M 维」的**分母来源**——M 恒等于这张表的长度，⛔ 不是新算的维度、⛔ 不是算法里的权重）。
   * label 只用于"缺哪几维"这句话，措辞抄自 `PersonalProfileForm` 各分区与字段标题；
   * ⛔ 不参与任何计算，也不与后端 `profileArchive.js` 的档案标签混用（那是另一张表、另一个口径）。
   */
  const SUMMARY_FIELDS = [
    { key: 'gender', label: '性别' },
    { key: 'skin_tone', label: '肤色冷暖' },
    { key: 'skin_tone_detail', label: '肤色深浅' },
    { key: 'face_shape', label: '脸型' },
    { key: 'body_type', label: '体型' },
    { key: 'body_type_detail', label: '体型细节' },
    { key: 'scenario', label: '场景' },
    { key: 'occasion', label: '场合' },
    { key: 'preferred_style', label: '偏好风格' },
    { key: 'season', label: '季节' },
  ] as const
  const filledDims = SUMMARY_FIELDS.filter((f) => Boolean(profile[f.key]))
  const missingDims = SUMMARY_FIELDS.filter((f) => !profile[f.key])

  return (
    <div className="space-y-3">
      {/* 顾客档案摘要 */}
      <div className="glass-card p-3" style={{ borderColor: 'var(--accent)' }}>
        <div
          className="flex items-center justify-between mb-2 pb-2"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            形象建议报告
          </h2>
          <span
            className="pill-tag"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            {mode === 'store' ? '🏪 门店推荐' : '📱 个人深度分析'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUMMARY_FIELDS.map(
            (f) =>
              profile[f.key] && (
                <span key={f.key} className="pill-tag">
                  {profile[f.key]}
                </span>
              ),
          )}
        </div>
        {/* 四大身材标准·部位级标签（椰子胸/沙漏腰/母贝臀/酒杯腿） */}
        {profile.body_highlights && profile.body_highlights.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              身材优势部位
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.body_highlights.map((h) => (
                <span
                  key={h}
                  className="pill-tag"
                  style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                  title={profile.body_highlights_details?.[h]?.label}
                >
                  ✨ {h}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* 🔴 10-22 第十四阶段·第一步 X5（`docs/依据/22` §六）：把"这次到底算到几维"当面说清。
            改前顾客只填性别就能拿到满 8 条，可报告里到处是「没量到 ⇒ 没计入」「六格只量到 2 格」
            这类缺席说明 ⇒ 感受是"我什么都没填它说我没填"。硬规矩 2 的引申是**缺测要明说、不是拦着不出分**，
            所以这里只补读数、⛔ 不加门槛、⛔ 不编默认值。 */}
        <div className="text-[11px] mt-2" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          本次量到 {filledDims.length}／{SUMMARY_FIELDS.length} 维
          {missingDims.length > 0 && `（缺：${missingDims.map((f) => f.label).join('、')}）`}
          {missingDims.length > 0 && '——缺的那几维不算分、也不用猜，下面的建议只按量到的这些出。'}
          {missingDims.length === 0 && '——这 10 维全量到了。'}
        </div>
        {/* 🔴 10-22 第十四阶段·第一步 X8（`docs/依据/22` §九）：这句以前只在接口返回里、屏幕上一个字都没露。
            原样显示后端给的那一行，⛔ 空值时不许渲染成"未知"或补一句承诺。 */}
        {privacyNotice && (
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            🔒 {privacyNotice}
          </div>
        )}
      </div>

      {/* 四季色彩季型卡（后端 seasonColor.getSeasonType 输出；冷暖+深浅两轴都拿到才出） */}
      {profile.season_type && (
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              色彩季型
            </h2>
            <span
              className="pill-tag"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              {profile.season_type.season_name}
            </span>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--text)' }}>
            {profile.season_type.traits}
          </p>
          <div className="mb-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              推荐配色
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.season_type.palette.map((c, i) => (
                <div key={i} className="flex items-center gap-1" title={c.name}>
                  <span
                    className="inline-block w-4 h-4 rounded-full border"
                    style={{ backgroundColor: c.hex || '#ccc', borderColor: 'var(--line)' }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mb-2">
            <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
              尽量避开
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.season_type.avoid.map((c, i) => (
                <div key={i} className="flex items-center gap-1" title={c.name}>
                  <span
                    className="inline-block w-4 h-4 rounded-full border"
                    style={{ backgroundColor: c.hex || '#ccc', borderColor: 'var(--line)' }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            判据：{profile.season_type.basis}
            {profile.season_type.confidence < 0.9 && '（部分维度来自档名兜底，仅供参考）'}
          </div>
        </div>
      )}

      {/* 五维肤色框架（借鉴 HBN 蓝皮书：黑/黄/红/白/青） */}
      {profile.skin_five_dimensions && (
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              肤色五维（HBN）
            </h2>
            <span
              className="pill-tag"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              主：{profile.skin_five_dimensions.primary}
            </span>
          </div>
          <div className="space-y-1.5">
            {(['black', 'white', 'yellow', 'red', 'cyan'] as const).map((dim) => {
              const labels: Record<string, string> = {
                black: '黑',
                white: '白',
                yellow: '黄',
                red: '红',
                cyan: '青',
              }
              const val = profile.skin_five_dimensions![dim]
              return (
                <div key={dim} className="flex items-center gap-2">
                  <span className="text-xs w-8" style={{ color: 'var(--muted)' }}>
                    {labels[dim]}
                  </span>
                  <div className="flex-1 h-2 rounded" style={{ backgroundColor: 'var(--bg-soft)' }}>
                    <div
                      className="h-2 rounded"
                      style={{ width: `${val}%`, backgroundColor: 'var(--accent)' }}
                    />
                  </div>
                  <span className="text-xs w-8 text-right" style={{ color: 'var(--muted)' }}>
                    {val}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
            基于色相角与明度的五维倾向近似，非医学色度测量
          </div>
        </div>
      )}

      {/* 天气查询卡片（🔴 §四·1：这里选的城市会随下一次生成一起送进 /engine，⛔ 不落库、⛔ 不进长期档案） */}
      <WeatherCard
        onWeather={setWeather}
        onCity={(c) => {
          setCity(c)
          onWeatherCityChange?.(c)
        }}
      />
      {city && onRegenerate && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={onRegenerate} className="ghost-btn text-xs px-2 py-1">
            按「{city}」今天的天气重算这份穿搭
          </button>
          <span style={{ color: 'var(--muted)' }}>
            天气只当这一屏的输入，不会存进你的档案
            {weatherSource === 'live' && ' · 上一份是按体感温度算的'}
            {weatherSource === 'failed' && ' · 上一份没带天气档（名单外或暂时取不到）'}
          </span>
        </div>
      )}
      {weatherSource === 'failed' && weatherNotice && (
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {weatherNotice}
        </div>
      )}

      {/* 算法分析报告（B 节）：个人模式本来就有；付费那一路不论模式都出。
          🔴 第十二阶段·第一步 一g（真浏览器点验发现的第二个洞）：后端为一b 已经让门店档也算出
          `algorithm_analysis`（`services/recommendEngine.js` 的 `opts.deep_analysis`），但这一行的判据
          还只认 `mode === 'personal'` ⇒ 门店顾客付费领到的那份细账，屏幕上没有正文那一节。
          判据换成"这一份是不是付费领取出来的"（`paid_report` 只有 `GET /api/payment/my?report=…`
          那一路会写，见 `types/index.ts:635`），⛔ 免费屏（没有 `paid_report`）一个像素都不变。 */}
      {(mode === 'personal' || Boolean(recommendation.paid_report)) && analysis && (
        <AlgorithmAnalysisCard analysis={analysis} />
      )}

      {/* 分类 Tab */}
      <div className="flex gap-1 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 推荐内容 */}
      <div className="space-y-2.5">
        {/* 上衣处方卡：只按身材+肤色出规格，与规则结论、衣橱都无关，所以规则没命中时也要在 */}
        {activeTab === '穿搭' && recommendation.top_spec && (
          <TopSpecCard spec={recommendation.top_spec} skin={recommendation._computed} />
        )}

        {/* 衣橱搭配：从已有衣物中生成的搭配方案（借鉴 AI衣橱） */}
        {activeTab === '穿搭' && recommendation.衣橱搭配 && recommendation.衣橱搭配.length > 0 && (
          <div className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                👗 你衣橱里能搭出的
              </h3>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                共 {recommendation.衣橱搭配.length} 套
              </span>
            </div>
            <div className="space-y-2">
              {recommendation.衣橱搭配.map((outfit, i) => (
                <div key={i} className="p-2 rounded" style={{ backgroundColor: 'var(--bg-soft)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                      {outfit.items.map((it) => it.name).join(' + ')}
                    </span>
                    <span
                      className="pill-tag text-[10px]"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    >
                      协调度 {outfit.score}
                    </span>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
                    {outfit.reason}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
              仅基于你衣橱已有衣物的色彩与场合匹配，体型适配请看上方推荐
            </div>
          </div>
        )}
        {items.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>
            暂无{TAB_LABEL(activeTab)}推荐数据,请补充更多个人信息
          </div>
        ) : (
          items.map((item, i) => (
            <div key={`${activeTab}-${item.group_id ?? i}`} className="glass-card p-3">
              {item.group_name && (
                <div
                  className="flex items-center gap-2 mb-2 pb-2"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {item.group_name}
                  </span>
                  {item.score > 0 && (
                    <span
                      className="pill-tag"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    >
                      匹配度 {item.score}
                      {(item.feedback ?? 0) !== 0 &&
                        `（含反馈 ${item.feedback! > 0 ? '+' : ''}${item.feedback}）`}
                    </span>
                  )}
                  {/* 依据档位:这条建议是国标/实证/体系/命理哪一级撑起来的 */}
                  <EvidenceTag level={item.evidence_level} />
                </div>
              )}
              <div className="space-y-1.5">
                {Object.entries(item)
                  .filter(([k]) => !HIDDEN_FIELDS.includes(k))
                  .map(([key, val]) => {
                    const label = FIELD_LABELS[key] || key
                    const isAvoid = key === 'avoid'
                    return (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>
                          {label}
                        </span>
                        <span
                          className="flex-1"
                          style={{
                            color: isAvoid ? 'var(--danger)' : 'var(--text)',
                            lineHeight: '1.5',
                          }}
                        >
                          {String(val)}
                        </span>
                      </div>
                    )
                  })}
              </div>
              {/* 上衣贴合度:色度学量出来的"上衣代表色 vs 肤色锚点"相对差异,不是审美评分。
                  10-20 第六阶段·第一步：basis='lightness-band' 的那条只有"深色/浅色"一档亮度，
                  没有 hex 也没有色差可印——改前这里会把「ΔE00 null、明度差 null」直接打给顾客，
                  看着像系统坏了，实际是"这句结论压根没给具体色"。色块换成虚线框。 */}
              {item.color_fit && (
                <div
                  className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                  style={{ color: 'var(--muted)' }}
                >
                  <span
                    className="inline-block"
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      background: item.color_fit.top_hex || 'transparent',
                      border: item.color_fit.top_hex
                        ? '1px solid var(--line)'
                        : '1px dashed var(--muted)',
                    }}
                  />
                  <span>
                    上衣贴合度 {item.color_fit.score}/100 · {item.color_fit.top_label}
                    {item.color_fit.basis === 'lightness-band'
                      ? '（这句结论只给了深浅档位、没有具体色名，只按"衣装越暗脸越显白"这一条方向给分，不测色差）'
                      : `（与肤色的色差 ${item.color_fit.deltaE00}——这个数越小越接近、0 就是同色；色调相差 ${item.color_fit.dHue}°；明暗相差 ${item.color_fit.dL}）`}
                  </span>
                  {/* 🔴 10-21 第十三阶段·第一步 §二·3／§二·4：这个色不是上衣那一格自己写的 ⇒ 必须说破出处。
                      措辞红线（依据/21 §一·1）：⛔ 不许写成"系统识别出你的上衣是驼色"。
                      两条支路的说法不同：借配色串第一色 vs 顺着"跟谁同色"从另一格取。 */}
                  {item.color_borrowed === true && (
                    <span style={{ color: 'var(--muted)' }}>
                      {item.color_basis_source === 'relational'
                        ? `（上衣那一格没写自己的颜色，只写了"跟${item.color_relational_from || '另一件'}同色"——这个色是从${item.color_relational_from || '那一格'}那一格的结论取的（出处「${item.color_borrowed_from || '—'}」），不是识别出上衣自己的颜色 ⇒ 这一维说话的分量已减半）`
                        : `（上衣那一格没写具体颜色${item.color_top_band ? `，只写了"${item.color_top_band}"` : ''}——这个色按整套搭配的配色串取的第一色（出处「${item.color_borrowed_from || '—'}」），不是识别出上衣自己的颜色 ⇒ 这一维说话的分量已减半）`}
                    </span>
                  )}
                </div>
              )}
              {/* 身材贴合度:这件上衣的修形方向与这个人的比例偏差对不对得上;缺的尺寸不计入 */}
              {item.body_fit && (
                <div
                  className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                  style={{ color: 'var(--muted)' }}
                >
                  <span>
                    上衣身材适配度 {item.body_fit.score}/100（
                    {item.body_fit.axes
                      .map((a) => `${a.name_cn} ${Math.round(a.score * 100)}`)
                      .join(' / ')}
                    ）
                    {/* 🔴 10-21 第十三阶段·第一步 §三·4：这一档是**从这句建议文案的款式词认出来的**，
                        一格尺寸都没量。措辞红线（依据/21 §一·2）：⛔ 不许说成"量化了你的体型"。
                        所以这一行不许复用"六格只量到 X 格"那句——那句的前提是"你量过、只是没量全"。 */}
                    {item.body_fit.inferred_from === 'rule_text' ? (
                      <span style={{ color: 'var(--muted)' }}>
                        （这句建议没量过任何尺寸：版型档位是按它自己写的款式词
                        {(item.body_fit.inferred_words?.fit || [])
                          .concat(item.body_fit.inferred_words?.fabric || [])
                          .join('、')}
                        认出来的，松量按那一档的区间中值估 ⇒ <b>这不是你的身材数据</b>
                        ，只说明这句建议本身的松紧取向和你合不合
                        {item.body_fit.coverage != null && (
                          <>
                            （算到 {(item.body_fit.coverage * 6).toFixed(1)} 格 ⇒ 按可信度打折，
                            这一份乘 {item.body_fit.coverage_penalty}）
                          </>
                        )}
                        ）
                      </span>
                    ) : (
                      <>
                        {item.body_fit.axes_missing.length > 0 && (
                          <span style={{ color: 'var(--muted)' }}>
                            {item.body_fit.axes_missing.length} 维没量到 ⇒ 没计入
                          </span>
                        )}
                        {/* 10-19 第三阶段·模块二：量得越少扣得越狠，这一句要把扣在哪说破 */}
                        {item.body_fit.coverage != null && item.body_fit.coverage < 1 && (
                          <span style={{ color: 'var(--muted)' }}>
                            六格只量到 {(item.body_fit.coverage * 6).toFixed(1)} 格 ⇒ 按可信度打折，
                            这一份乘 {item.body_fit.coverage_penalty}
                          </span>
                        )}
                        {(item.body_fit.top.estimated || []).length > 0 && (
                          <span style={{ color: 'var(--muted)' }}>
                            （
                            {(item.body_fit.top.estimated || [])
                              .map(
                                (k) => item.body_fit!.axes.find((a) => a.key === k)?.name_cn || k,
                              )
                              .join('、')}
                            按版型估的，没实测）
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              )}
              {/* 可解释穿搭评估：逐维度冲突拆解（2026-11 借鉴邂逅时尚）。
                  只展示后端挂了 conflict_breakdown 的条目——没挂＝所有维度都贴合，没冲突可拆。
                  数据来自 color_fit／body_fit 的已有子分，⛔ 前端不重算、不猜。 */}
              {item.conflict_breakdown && item.conflict_breakdown.length > 0 && (
                <div
                  className="mt-2 space-y-1"
                  style={{ borderTop: '1px dashed var(--line)', paddingTop: '8px' }}
                >
                  <div className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    穿搭拆解
                  </div>
                  {item.conflict_breakdown.map((cb, idx) => {
                    const tone =
                      cb.level === 'good'
                        ? 'var(--good)'
                        : cb.level === 'medium'
                          ? 'var(--warning)'
                          : 'var(--danger)'
                    const label =
                      cb.level === 'good' ? '贴合' : cb.level === 'medium' ? '中等' : '冲突'
                    return (
                      <div key={idx} className="flex gap-2 text-xs items-start">
                        <span className="flex-shrink-0 w-16" style={{ color: 'var(--muted)' }}>
                          {cb.dimension}
                        </span>
                        <span className="flex-1" style={{ lineHeight: 1.5 }}>
                          <span style={{ color: tone }}>
                            {Math.round(cb.score)}分 · {label}
                          </span>
                          {cb.detail && (
                            <span style={{ color: 'var(--muted)' }}>（{cb.detail}）</span>
                          )}
                          {cb.suggestion && (
                            <span style={{ color: 'var(--text)' }}> —— {cb.suggestion}</span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* 综合排序分:这一条排在第几名就是它定的(10-19 第二阶段) */}
              {item.rank && (
                <div
                  className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                  style={{ color: 'var(--muted)' }}
                >
                  <span>
                    综合排序分 {item.rank.score}/100 ·{' '}
                    {item.rank.dims
                      .filter((d) => d.score !== null && d.weight > 0)
                      .map((d) => `${d.name_cn} ${Math.round(d.score ?? 0)}`)
                      .join(' + ')}
                    {/* 10-22 第十四阶段·第一步 X6（依据/22 §七）：乘子不写「⇒ ×0.9」，
                        固定映射是 乘子→「按可信度打折」；数值本身⛔ 不许删。 */}
                    {item.rank.coverage < 1 && (
                      <span>（没量全 ⇒ 按可信度打折，乘 {item.rank.factor}）</span>
                    )}
                  </span>
                </div>
              )}
              {item.explanation && item.explanation.命中条件.length > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px dashed var(--line)' }}>
                  <button
                    onClick={() => toggleExplain(item.group_id)}
                    className="text-xs flex items-center gap-1"
                    style={{
                      color: 'var(--accent)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{explainOpen[item.group_id] ? '▼' : '▶'}</span>
                    <span>💡 为什么推荐这个?</span>
                  </button>
                  {explainOpen[item.group_id] && (
                    <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <div>这条推荐命中了以下条件:</div>
                      {item.explanation.命中条件.map((cond, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1"
                          style={{ paddingLeft: '12px' }}
                        >
                          <span style={{ color: 'var(--accent)' }}>✓</span>
                          <span>{cond}</span>
                        </div>
                      ))}
                      <div className="mt-1" style={{ fontSize: '11px' }}>
                        匹配分: {item.explanation.匹配分} · 优先级: {item.explanation.优先级}
                      </div>
                      {/* 依据档位说明:只有 A/B 才够称"有量化依据",C/D 要说清是体系或命理 */}
                      <div className="mt-1">
                        <EvidenceTag level={item.evidence_level} withNote />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 反馈:唯一能回答"哪条规则用对了"的信号,兜底推荐没有规则号所以不显示。
                  🔴 10-21:这一条**只**管规则那一路（它写 feedback_events，那张表 group_id NOT NULL）。
                  衣柜那一路的星在下面那块，两块各走各的口，⛔ 不许合一块（键会撞:见下注释）。 */}
              {item.group_id > 0 && (
                <div
                  className="mt-2 pt-2 space-y-1.5"
                  style={{ borderTop: '1px dashed var(--line)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      这条建议准吗？
                    </span>
                    {(['useful', 'inaccurate'] as const).map((signal) => (
                      <button
                        key={signal}
                        onClick={() => void submitFeedback(item.group_id, signal, item)}
                        className="ghost-btn"
                        style={{
                          padding: '2px 8px',
                          fontSize: '11px',
                          color:
                            myFeedback[item.group_id] === signal ? 'var(--accent)' : 'var(--muted)',
                          borderColor:
                            myFeedback[item.group_id] === signal ? 'var(--accent)' : 'var(--line)',
                        }}
                      >
                        {signal === 'useful' ? '👍 有用' : '👎 不准'}
                      </button>
                    ))}
                    {myFeedback[item.group_id] && (
                      <span className="text-[10px]" style={{ color: 'var(--good)' }}>
                        已记录
                      </span>
                    )}
                  </div>
                  {/* 10-19 第三阶段·模块三：两把星 + 那一刻的综合分快照，是权重回归的样本。
                      🔴 10-20 第八阶段·一b：星不再等按钮——点星即以 `rated` 提交（没表过态时）。
                      这行文案原来写"点上面的👍/👎才会存进服务器"，那是把通路断点的现场描述当成了产品口径。 */}
                  <div className="flex flex-wrap items-center gap-3">
                    {(['aesthetic', 'fit'] as const).map((kind) => (
                      <StarRow
                        key={kind}
                        kind={kind}
                        value={myStars[item.group_id]?.[kind] ?? null}
                        busy={feedbackBusy === item.group_id}
                        onPick={(v) => pickStar(item.group_id, kind, v, item)}
                      />
                    ))}
                    {!myFeedback[item.group_id] && !ratedSaved[item.group_id] && (
                      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                        打个星就记下，不用点👍/👎
                      </span>
                    )}
                    {!myFeedback[item.group_id] && ratedSaved[item.group_id] && (
                      <span className="text-[10px]" style={{ color: 'var(--good)' }}>
                        星级已记录
                      </span>
                    )}
                    {/* 10-22 第十四阶段·第一步 X4：确实记过分了才出现这个按钮。
                        走 `DELETE /api/recommend/feedback/group`，⛔ 不是发两颗 null 给 POST。 */}
                    {(myFeedback[item.group_id] || ratedSaved[item.group_id]) && (
                      <button
                        onClick={() => void clearRuleStars(item.group_id)}
                        disabled={feedbackBusy === item.group_id}
                        className="opt-btn text-[10px]"
                        style={{ padding: '2px 8px', opacity: 0.75 }}
                      >
                        清除评分
                      </button>
                    )}
                  </div>
                  {ruleClearHint === item.group_id && (
                    <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      两颗星都清空等于没打，这条不能这么撤——请点右边的「清除评分」
                    </div>
                  )}
                </div>
              )}
              {/* 衣柜那一路的两把星（10-21 第九阶段·第一步）。这块是专门为它开的：
                  改前 `item.group_id > 0` 一挡，全仓**唯一带实测尺寸**的那几条候选反而一个星都点不了
                  （它们的 group_id 是 null），于是"量齐的衣服"和"能打分的路"永远碰不上，
                  权重回归那道门才卡在 0 条样本。现量与四条证据在 docs/依据/17 §一。 */}
              {item.source === 'wardrobe' && item.wardrobe_item_id != null && (
                <div
                  className="mt-2 pt-2 space-y-1.5"
                  style={{ borderTop: '1px dashed var(--line)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      这件你穿得怎么样？
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      记在这件衣服自己的账上，不动规则的好评差评
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {(['aesthetic', 'fit'] as const).map((kind) => (
                      <StarRow
                        key={kind}
                        kind={kind}
                        value={itemStars[item.wardrobe_item_id as number]?.[kind] ?? null}
                        busy={itemBusy === (item.wardrobe_item_id as number)}
                        onPick={(v) => pickItemStar(item.wardrobe_item_id as number, kind, v, item)}
                      />
                    ))}
                    {itemSaved[item.wardrobe_item_id as number] ? (
                      <span className="text-[10px]" style={{ color: 'var(--good)' }}>
                        已记录
                      </span>
                    ) : (
                      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                        打个星就记下
                      </span>
                    )}
                    {/* 第十三阶段·§四·2「衣橱的星可以撤」：只在确实记过分之后才出现。
                        走 DELETE 那一路，⛔ 不是发两颗 null（POST 的守卫会 400 掉空壳行）。 */}
                    {itemSaved[item.wardrobe_item_id as number] && (
                      <button
                        onClick={() => void clearItemStars(item.wardrobe_item_id as number)}
                        disabled={itemBusy === (item.wardrobe_item_id as number)}
                        className="opt-btn text-[10px]"
                        style={{ padding: '2px 8px', opacity: 0.75 }}
                      >
                        清除评分
                      </button>
                    )}
                  </div>
                  {itemClearHint === (item.wardrobe_item_id as number) && (
                    <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      两颗星都清空等于没打，这条不能这么撤——请点右边的「清除评分」
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {feedbackError && (
          <div className="text-xs" style={{ color: 'var(--danger)' }}>
            {feedbackError}
          </div>
        )}
      </div>

      {/* AI 文案增强 */}
      <EnhancedTextCard recommendation={recommendation} weather={weather} mode={mode} />

      {/* 库存匹配(门店模式) */}
      {mode === 'store' && inventory.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">📦</span>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              门店库存匹配
            </h3>
            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
              共 {inventory.length} 件
            </span>
          </div>
          <div className="space-y-2">
            {inventory.map((prod) => (
              <InventoryCard key={prod.id} product={prod} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {/* 星座运势卡片 */}
      <HoroscopeCard />

      {/* 操作按钮 */}
      <div className="flex gap-2 pt-2">
        {onBack && (
          <button onClick={onBack} className="ghost-btn flex-1 py-2.5 text-sm">
            ← 重新填写
          </button>
        )}
        {mode === 'store' && sessionId && onSync && (
          <button
            onClick={onSync}
            disabled={synced || syncing}
            className={`flex-1 py-2.5 text-sm ${synced ? 'ghost-btn' : 'gradient-btn'}`}
            style={synced ? { color: 'var(--good)', borderColor: 'var(--good)' } : {}}
          >
            {syncing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
                同步中...
              </span>
            ) : synced ? (
              '✓ 已同步门店'
            ) : (
              '☁ 同步到门店'
            )}
          </button>
        )}
        {mode === 'store' && sessionId && onDelete && (
          <button
            onClick={onDelete}
            className="ghost-btn flex-1 py-2.5 text-sm"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            🗑 删除我的数据
          </button>
        )}
        <button
          onClick={() => setTryonOpen(!tryonOpen)}
          className="ghost-btn flex-1 py-2.5 text-sm"
          style={tryonOpen ? { color: '#34d399', borderColor: '#34d399' } : {}}
        >
          {tryonOpen ? '✕ 收起试穿' : '👗 虚拟试穿'}
        </button>
      </div>

      {/* 虚拟试穿表单 */}
      {tryonOpen && <TryonCard />}
    </div>
  )
}

// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝规则引擎：命中条目／冲突拆解／后台浏览／上衣处方（TopSpec））。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。
import type { BodyFitScore, ColorFitScore, RankScore, RecommendationExplanation } from './scores'

/** 规则引擎推荐结果(单条) */
export interface RuleRecommendationItem {
  group_id: number
  group_name: string
  priority: number
  score: number
  /** 综合排序分:穿搭这一类由它定名次(妆容/发型/配饰/姿势暂未接入) */
  rank?: RankScore
  /** wardrobe = 这条来自顾客自己衣柜里量过成品尺寸的一件上衣(不是规则命中的) */
  source?: 'wardrobe'
  wardrobe_item_id?: number | null
  /** 反馈对这条规则得分的加减量(好评为正、不准为负,最多 ±3) */
  feedback?: number
  /** 依据档位:A 国标/国际标准 B 学术实证 C 行业体系 D 命理;null=未标注 */
  evidence_level?: 'A' | 'B' | 'C' | 'D' | null
  /** 可解释性说明:这条推荐命中了哪些规则条件(中文人话) */
  explanation?: RecommendationExplanation
  /** 色度学贴合分:仅上衣结论认得出色名且档案有肤色档时才有 */
  color_fit?: ColorFitScore
  /** 身材贴合分:仅上衣认得出修形信号且档案量到相关尺寸时才有 */
  body_fit?: BodyFitScore
  /** 🔴 第十三阶段·第一步 §二·3/§二·4：上衣那一格的色是"怎么来的"。
   *  top_text＝这句话自己写的色；combo_first＝它没写色、借本组配色串的第一色；
   *  relational＝它只写了"跟谁同色"（如"与鞋同色系"），色是从那一格取来的。 */
  color_basis_source?: 'top_text' | 'combo_first' | 'relational' | null
  /** 借来/取来的色 ⇒ true，色彩那一维的权重在这一层乘 0.5（rankDims 里唯一一处折扣） */
  color_borrowed?: boolean
  /** 借色出处：串里的原句（combo_first）或那一格的原句（relational） */
  color_borrowed_from?: string | null
  /** 借的是串里第几个色（relational 这条路不数位置，恒 null） */
  color_borrowed_position?: number | null
  /** 上衣那句话自己只写了深浅时留的档（'深色'/'浅色'…），写了具体色则 null */
  color_top_band?: string | null
  /** relational 那条：色是从哪一格的结论取来的（'鞋'/'下装'…） */
  color_relational_from?: string | null
  /** §二·4 的收口账，形如「下装←上衣(藏青)」：哪一格只写了"跟谁同色" */
  color_relational?: string | null
  /** §三·4：从文案认出的版型档／面料档（null＝这一句认不出，那一维继续缺席） */
  fit_type_inferred?: string | null
  fabric_weight_inferred?: string | null
  /** 可解释穿搭评估：逐维度冲突拆解（只在有非 good 维度时挂载）。
   *  从 color_fit／body_fit 的已有子分里归因，⛔ 不重新算分、不影响名次。 */
  conflict_breakdown?: ConflictBreakdownItem[]
  [key: string]: unknown
}

/** 可解释穿搭评估的单个维度条目 */
export interface ConflictBreakdownItem {
  /** 维度中文名，如「肤色对比」「松量」「腰线」 */
  dimension: string
  /** 0~100 分；body_fit 的轴分由 0~1 归一而来 */
  score: number
  /** good=贴合(≥70) / medium=中等(40~69) / conflict=冲突(<40) */
  level: 'good' | 'medium' | 'conflict'
  /** 改进建议（good 档为 null） */
  suggestion: string | null
  /** 可选的补充细节，如「色相差 12°」 */
  detail?: string | null
}

/**
 * 规则浏览器单条规则(后端 /api/rules/browse 返回)
 *
 * 字段名用中文,与后端 ruleExplainer.explainGroup 返回结构对齐,
 * 让普通人直接看懂"这条规则匹配哪些档案条件".
 */
export interface RuleBrowseItem {
  /** 规则组 ID */
  id: number
  /** 规则名称 */
  规则名称: string
  /** 推荐类别:穿搭/妆容/发型/配饰/姿势 */
  推荐类别: string
  /** 适用场景,如通勤/约会,null 表示不限 */
  适用场景: string | null
  /** 适用性别:女/男,null 表示不限 */
  适用性别: string | null
  /** 匹配条件的中文描述列表,如 ['性别:女', '脸型 属于 圆脸、方脸'] */
  匹配条件: string[]
  /** 规则说明(管理员填的 description) */
  规则说明: string
  /** 优先级,数字越大越优先 */
  优先级: number
  /** 依据档位一句话标签,如 'B 学术实证' */
  依据档位?: string
  /** 该档位的判据说明 */
  依据说明?: string
}

/** 规则浏览器查询参数 */
export interface RuleBrowseQuery {
  /** 模式:store(门店)/personal(个人),默认 store */
  mode?: 'store' | 'personal'
  /** 类别:穿搭/妆容/发型/配饰/姿势 */
  category?: string
  /** 性别:女/男 */
  gender?: string
  /** 场景:通勤/约会/面试/休闲/聚会 */
  scenario?: string
}

/** 完整推荐结果 */
/**
 * 上衣处方：只按身材 + 肤色出"上衣该选成什么样"，不读衣橱、不给购物建议。
 * 后端 services/topFromBody.js 的返回；轴只在"这个人量得出"时出现，缺的进 missing。
 */
export interface TopSpecAxis {
  key: 'shoulder' | 'waist' | 'ease' | 'length' | 'volume' | 'pattern'
  name_cn: string
  /** 该轴的偏差方向；ease 轴没有 want，用 side='window' 表达 */
  want: number | null
  side: number | 'window'
  /** 档位串：方向哪一档 + 刻度哪一档，全部要显示出来 */
  tier: string
  label: string
  prefer: string[]
  avoid: string[]
  /** 这条是按哪个实测数推出来的 */
  based_on?: string
  gated?: string
}

export interface TopSpecColorRow {
  name: string
  hex: string
  score: number
  deltaE00?: number
  dHue?: number
  dL?: number
  /** 这个分是两个肤色口径里更低的那个，记下短板口径（'深浅' | '冷暖'） */
  limit_field?: string
}

export interface TopSpecColour {
  present: boolean
  reason?: string
  skin_label?: string
  skin_lab?: { L: number; a: number; b: number }
  /** 照片色相角（度）：非 null ⇒ 冷暖那一格被实测角度顶掉；过不了闸恒 null */
  photo_hue?: number | null
  /** 顶掉冷暖锚点后实际进 colorFit 的那颗 Lab（L/C 仍出自 C 档锚点表，只有 h 是照片的） */
  photo_lab?: { L: number; a: number; b: number; h: number; C: number } | null
  /** 照片角度翻译出来的冷暖词（冷皮/自然/暖皮）；⛔ 不是"检测出的肤色" */
  photo_undertone?: string | null
  /** 认出来的肤色口径数（1=只有深浅或只有冷暖；2=两个都算取低分） */
  anchor_count?: number
  scoring?: 'min' | 'single'
  tier?: string
  prefer?: TopSpecColorRow[]
  avoid?: TopSpecColorRow[]
  note?: string
}

/** 第 0 层·合身：GB/T 1335 号型 + 四道部位判据（口径见 docs/依据/09） */
export interface TopSpecFitCheck {
  key: 'bust_ease' | 'shoulder_seam' | 'body_length' | 'sleeve'
  name_cn: string
  /** 本层没有"你这件不合格"——项目里没有成衣实测尺寸通道 */
  verdict: '可给目标值' | '判不了' | '不适用'
  target: Record<string, number | number[] | null> | null
  why: string
  tier: string
  missing_input: string | null
}

export interface TopSpecFit {
  present: boolean
  layer_cn?: string
  size_label?: string
  size?: {
    号: number
    型: number
    体型: string | null
    体型中文: string | null
    体型档: number[] | null
  }
  size_scope?: 'standard' | 'near'
  size_scope_note?: string | null
  /** 常用档系表列的出处（按性别分表，1335.1／1335.2-2008） */
  size_scope_ref?: string
  drop_cm?: number | null
  drop_reason?: string | null
  /** 胖瘦程度＝另一条轴（GB/T 31901-2024 附录 A 表 A.2，2026-12-01 实施 ⇒ 现为内部口径） */
  bmi?: number | null
  bmi_band?: { cn: string; band: (number | null)[] } | null
  bmi_band_note?: string
  target_finished_bust?: number[] | null
  ease_window_cm?: number[] | null
  checks?: TopSpecFitCheck[]
  /** present:false 时只有这三样：挡在门口的话、缺哪个数、怎么量 */
  blocking?: string[]
  missing_input?: string[]
  measure_guide?: string[]
  note: string
  evidence: string
}

export interface TopSpec {
  inputs: Record<string, unknown>
  /** 三层固定顺序：合身 → 修形 → 颜色，两段结论可以相反，不合并成一个分 */
  fit: TopSpecFit
  axes: TopSpecAxis[]
  colour: TopSpecColour
  missing: Array<{ key: string; name_cn: string; reason: string }>
  note: string
  evidence: string
  layer_order?: string[]
  axis_tiers?: Record<string, string>
}

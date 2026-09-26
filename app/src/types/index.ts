// ============================================================
// 通用 API 响应包装
// ============================================================

/** 统一 API 响应格式 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data: T
  error?: { code: string; message: string }
  message?: string
}

// ============================================================
// 顾客档案 + 规则引擎推荐 + 个人橱柜管理相关类型
// ============================================================

/** 后端按人存下来的形象标签(算出来的结论,不是本人填的条件) */
export interface ProfileTag {
  key: string
  label: string
  value: string
}

/** 顾客档案(手动填写) */
export interface CustomerProfile {
  // 基础信息
  nickname?: string
  gender?: '男' | '女'
  age?: number
  age_range?: '18-25' | '26-35' | '36-45' | '46+'
  height?: number
  height_range?: '150-160' | '160-170' | '170-180' | '180+'
  weight?: number
  bust?: number
  waist?: number
  hip?: number
  /** 腿长(cm,选填):档案表列名 leg_length_cm */
  leg_length?: number

  // 门店模式字段
  skin_tone?: '暖皮' | '冷皮' | '自然'
  face_shape?: '圆脸' | '方脸' | '心形脸' | '椭圆脸' | '长脸'
  body_type?: '标准' | '偏瘦' | '偏胖' | '梨形' | '苹果形'
  scenario?: '通勤' | '约会' | '面试' | '休闲' | '聚会'
  /** 拍照场景(选填):只影响"姿势"类推荐,不选则沿用主要场合 */
  photo_scene?: '日常街拍' | '职业照' | '旅行打卡' | '探店' | '户外写真' | '闺蜜合照' | '自拍'
  region?: '北方' | '南方'

  // 个人模式扩展字段(50+)
  skin_tone_detail?: '白皙' | '自然白' | '偏黄' | '小麦色' | '古铜色'
  /** 色彩纯度(选填):冷暖+深浅算出四季后再用这根轴细分到十二型;值与后端 CHROMA_LEVEL 键一致 */
  color_chroma?: '净亮' | '柔雾' | '中间'
  body_type_detail?: '沙漏型' | '梨形' | '苹果型' | '直筒型' | '倒三角型'
  bmi_level?: '偏瘦' | '正常' | '偏胖' | '肥胖'
  preferred_style?: string
  occasion?:
    '上班通勤' | '校园日常' | '居家休闲' | '约会聚会' | '商务正式' | '运动健身' | '婚礼宴会'
  main_goal?: string
  posture?: string
  height_wish?: '想显高' | '保持就好'
  weight_wish?: '想显瘦' | '想丰满一些' | '保持就好'
  neck_length?: '短' | '中' | '长'
  shoulder_type?: '窄肩' | '标准肩' | '宽肩'
  /** 骨架量感(选填):风格型第一轴;值与后端 FRAME_LEVEL 键一致 */
  frame_size?: '小巧' | '适中' | '大气'
  /** 线条倾向(选填):风格型第二轴;值与后端 LINE_LEVEL 键一致 */
  line_quality?: '偏直线' | '均衡' | '偏曲线'

  // 五官细节
  eye_size?: '大' | '中' | '小'
  eye_shape?: '圆眼' | '杏眼' | '丹凤眼' | '下垂眼'
  nose_height?: '高' | '中' | '低'
  lip_thickness?: '厚' | '中' | '薄'
  /** 三庭比例(纵向):额头/鼻/下巴三段谁偏长,驱动"三庭五眼比例"板块 */
  face_ratio?: '比例均衡' | '上庭偏长' | '中庭偏长' | '下庭偏长'
  /** 眼距(横向):两侧内眼角间距相对眼宽 */
  eye_spacing?: '眼距偏宽' | '眼距适中' | '眼距偏窄'

  // 偏好
  season?: '春' | '夏' | '秋' | '冬'
  budget?: '平价' | '中档' | '高端'
  allergy_metal?: string
  skin_type?: '干皮' | '油皮' | '混合' | '敏感'

  [key: string]: unknown
}

/** 顾客临时会话 */
export interface CustomerSession {
  session_id: string
  expires_at: string
  privacy_notice: string
  synced?: boolean
  synced_at?: string
  profile_data?: CustomerProfile
}

/** 推荐可解释性说明(为什么推荐这条,后端 ruleExplainer 生成) */
export interface RecommendationExplanation {
  命中条件: string[]
  匹配分: number
  优先级: number
  规则说明: string
}

/** 规则引擎推荐结果(单条) */
export interface RuleRecommendationItem {
  group_id: number
  group_name: string
  priority: number
  score: number
  /** 反馈对这条规则得分的加减量(好评为正、不准为负,最多 ±3) */
  feedback?: number
  /** 可解释性说明:这条推荐命中了哪些规则条件(中文人话) */
  explanation?: RecommendationExplanation
  [key: string]: unknown
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
export interface EngineRecommendation {
  穿搭: RuleRecommendationItem[]
  妆容: RuleRecommendationItem[]
  发型: RuleRecommendationItem[]
  配饰: RuleRecommendationItem[]
  姿势: RuleRecommendationItem[]
  inventory?: {
    穿搭?: InventoryProduct[]
    妆容?: InventoryProduct[]
    发型?: InventoryProduct[]
    配饰?: InventoryProduct[]
    姿势?: InventoryProduct[]
  }
  // 个人模式扩展
  algorithm_analysis?: AlgorithmAnalysis
  wardrobe_gaps?: WardrobeGapResult
  wishlist?: ShoppingWishlistItem[]
}

/** 算法分析结果 */
export interface AlgorithmAnalysis {
  /** 分析板块:体型/脸型/肤色/体态,每个板块是一句话建议列表 */
  sections: { title: string; advices: string[] }[]
  /** 数字摘要,如 "BMI 21.5(正常)"、"体型 沙漏型" */
  metrics: string[]
}

/** 库存商品 */
export interface InventoryProduct {
  id: number
  category_code: string
  category_name: string
  name: string
  brand?: string
  color?: string
  size?: string
  stock: number
  price?: number
  image_url?: string
  style_tags?: string[]
  color_tags?: string[]
  season_tags?: string[]
  description?: string
}

/** 隐私声明 */
export interface PrivacyNoticeData {
  title: string
  content: string[]
  highlight: string
}

// ============================================================
// 个人衣橱
// ============================================================

/** 个人衣橱单品 */
export interface WardrobeItem {
  id?: number
  name: string
  category: string
  sub_category?: string
  brand?: string
  color?: string
  size?: string
  price?: number
  image_url?: string
  style_tags?: string[]
  color_tags?: string[]
  season_tags?: string[]
  occasion_tags?: string[]
  body_type_fit?: string[]
  condition?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/** 衣橱搭配组合 */
export interface WardrobeOutfit {
  id?: number
  name: string
  item_ids: number[]
  occasion?: string
  season?: string
  rating?: number
  notes?: string
  created_at?: string
}

/** 购物心愿单 */
export interface ShoppingWishlistItem {
  id?: number
  category: string
  name: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  estimated_price?: number
  is_purchased?: boolean
  created_at?: string
}

/** 衣橱缺口分析 */
export interface WardrobeGapResult {
  gaps: WardrobeGap[]
  stats: WardrobeStats
  color_analysis?: WardrobeColorAnalysis
}

export interface WardrobeGap {
  type: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface WardrobeStats {
  total: number
  by_category: Record<string, number>
  by_season: Record<string, number>
  by_style: Record<string, number>
}

export interface WardrobeColorAnalysis {
  dominant_colors: string[]
  missing_colors: string[]
  color_distribution: Record<string, number>
}

/** 购物评估 */
export interface PurchaseEvaluation {
  worth_it: boolean
  score: number
  verdict: string
  reasons: string[]
  warnings: string[]
}

// ============================================================
// 个人化妆品柜
// ============================================================

/** 化妆品单品 */
export interface CosmeticItem {
  id?: number
  name: string
  brand?: string
  category: string
  sub_category?: string
  color_name?: string
  color_tone?: '冷' | '暖' | '中性'
  color_family?: string
  finish?: string
  skin_tone_fit?: string[]
  skin_type_fit?: string[]
  occasion_tags?: string[]
  style_tags?: string[]
  coverage?: string
  opened_date?: string
  expiry_months?: number
  remaining?: number
  condition?: string
  price?: number
  image_url?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/** 化妆品缺口分析 */
export interface CosmeticGapResult {
  gaps: CosmeticGap[]
  stats: CosmeticStats
  color_match?: CosmeticColorMatch
}

export interface CosmeticGap {
  type: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface CosmeticStats {
  total: number
  by_category: Record<string, number>
  expiring: number
  expired: number
}

export interface CosmeticColorMatch {
  skin_tone: string
  mismatches: number
  recommendations: string[]
}

// ============================================================
// 个人配饰柜
// ============================================================

/** 配饰单品 */
export interface AccessoryItem {
  id?: number
  name: string
  brand?: string
  category: string
  sub_category?: string
  material?: string
  metal_color?: string
  gemstone?: string
  face_shape_fit?: string[]
  neck_length_fit?: string[]
  skin_tone_fit?: string[]
  occasion_tags?: string[]
  style_tags?: string[]
  season_tags?: string[]
  allergy_safe?: boolean
  condition?: string
  price?: number
  image_url?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/** 配饰缺口分析 */
export interface AccessoryGapResult {
  gaps: AccessoryGap[]
  stats: AccessoryStats
  face_shape_advice?: FaceShapeAdvice
  metal_color_advice?: MetalColorAdvice
}

export interface AccessoryGap {
  type: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface AccessoryStats {
  total: number
  by_category: Record<string, number>
}

export interface FaceShapeAdvice {
  face_shape: string
  mismatches: number
  recommendations: string[]
}

export interface MetalColorAdvice {
  skin_tone: string
  recommended: string
  avoid: string
}

// ============================================================
// 跨柜联动推荐
// ============================================================

/** 跨柜联动推荐 */
export interface CrossCabinetRecommendation {
  occasion: string
  occasion_style: string
  outfit_advice: CabinetMatchResult
  cosmetic_advice: CabinetMatchResult
  accessory_advice: CabinetMatchResult
  cross_tips: string[]
  summary: {
    wardrobe_count: number
    cosmetic_count: number
    accessory_count: number
  }
  /** 三柜拼出来的一套（"今天这身"） */
  full_look?: FullLook
  /** 该配金还是银，没有可靠依据时后端不给这个字段 */
  metal?: { color: string; basis: string } | null
  /** 本次计算里长期档案的参与情况 */
  archive?: { used_fields: string[]; tags: ProfileTag[] }
}

/** 一套搭配里的单件 */
export interface FullLookPiece {
  /** 槽位：上装 / 下装 / 一件成套 / 外搭 / 底妆 / 唇色 / 颈饰 / 耳饰 */
  slot: string
  name: string
  category: string
  score?: number
  /** 这一件自己的入选依据 */
  why: string[]
}

/** 完整形象指导：三柜各出候选后拼成的一套 */
export interface FullLook {
  pieces: FullLookPiece[]
  occasion: string
  /** 件数够不够算一套 */
  complete: boolean
  /** 缺的是哪一类（柜子里没有这一类才会缺） */
  missing_parts: string[]
  note: string
}

/** 橱柜匹配项 */
export interface CabinetMatchedItem {
  name: string
  category?: string
  score?: number
  /** 得分依据,如 ['当季','场合匹配'] */
  reasons?: string[]
}

export interface CabinetMatchResult {
  style?: string
  matched: CabinetMatchedItem[]
  missing: string[]
  suggestion: string
}

/** 季节性提醒 */
export interface SeasonalReminder {
  current_season: string
  tips: {
    outfit: string
    cosmetic: string
    accessory: string
  }
  wardrobe: { total: number; season_items: number; need_attention: boolean }
  cosmetic: { total: number; tip: string }
  accessory: { total: number; season_items: number; need_attention: boolean }
}

/** 品牌偏好分析(后端实际返回结构) */
export interface BrandPreference {
  wardrobe_brands: BrandCount[]
  cosmetic_brands: BrandCount[]
  accessory_brands: BrandCount[]
  price_range: {
    wardrobe: { min: number; max: number; avg: number; count: number }
    cosmetic: { min: number; max: number; avg: number; count: number }
    accessory: { min: number; max: number; avg: number; count: number }
  }
  style_preferences: string[]
  summary: {
    wardrobe_count: number
    cosmetic_count: number
    accessory_count: number
  }
}

export interface BrandCount {
  brand: string
  count: number
}

/** 三柜健康检查(后端实际返回结构) */
export interface CabinetHealth {
  overall_score: number
  wardrobe_health: CabinetHealthDetail
  cosmetic_health: CabinetHealthDetail
  accessory_health: CabinetHealthDetail
  recommendations: string[]
}

export interface CabinetHealthDetail {
  score: number
  total: number
  categories: string[]
  missing_essentials: string[]
}

// ============================================================
// 天气数据
// ============================================================

/** 天气数据 */
export interface WeatherData {
  temperature: number
  feelsLike: number
  condition: string
  humidity: number
  windDir: string
  windScale: number
  location: string
}

/** 温度穿衣策略 */
export interface TemperatureProfile {
  level: string
  allowed_seasons: string[]
  advice: string
}

/** 天气 + 穿衣策略组合 */
export interface WeatherProfile {
  weather: WeatherData
  profile: TemperatureProfile
}

// ============================================================
// 衣服照片 AI 识别
// ============================================================

/** 衣服语义识别结果 */
export interface ClothingSemantics {
  category: string
  color: string
  style: string[]
  season: string[]
  usage: string[]
  item_name: string
}

/** 衣橱上传单品(含图片和AI识别结果) */
export interface ClothingItem {
  clothing_id: number
  filename: string
  image_url: string
  semantics: ClothingSemantics
}

// ============================================================
// LLM 文案增强
// ============================================================

/** LLM 文案增强响应 */
export interface EnhancedText {
  text: string
}

// ============================================================
// 星座运势
// ============================================================

/** 单个星座运势 */
export interface HoroscopeData {
  zodiac_sign: string
  zodiac_name: string
  mood: string
  lucky_color: string
  lucky_number: number
  summary: string
  suggestion: string
}

/** 运势概要列表项 */
export interface HoroscopeBrief {
  zodiac_sign: string
  zodiac_name: string
  mood: string
  lucky_color: string
}

/** 运势列表响应 */
export interface HoroscopeListData {
  date: string
  horoscopes: HoroscopeBrief[]
}

// ============================================================
// 虚拟试穿
// ============================================================

/** 虚拟试穿结果 */
export interface TryonResult {
  result_url: string
  category: string
  person_image: string
  garment_image: string
  /** true = 未接入试穿模型，result_url 就是原图 */
  degraded?: boolean
}

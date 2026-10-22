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
  /** 肩宽(cm,选填):档案表列名 shoulder_width_cm。量两侧肩峰点之间的直线距离,不量衣服肩线。
   *  没有这个数,肩宽比(21~24% 档位)和"倒三角 vs 苹果"都判不出来,系统不再用 38/162 兜底编值。 */
  shoulder?: number
  /** 出生日期(选填,YYYY-MM-DD):八字五行的输入;空串=主动撤销这条依据(undefined 序列化后会整个消失,带不了这个信号) */
  birth_date?: string
  /** 出生时辰(选填):档位取中点、不做真太阳时校正;选"不清楚"降级为三柱;空串=主动撤销 */
  birth_hour?:
    | '子时'
    | '丑时'
    | '寅时'
    | '卯时'
    | '辰时'
    | '巳时'
    | '午时'
    | '未时'
    | '申时'
    | '酉时'
    | '戌时'
    | '亥时'
    | '不清楚'
    | ''

  // 门店模式字段
  skin_tone?: '暖皮' | '冷皮' | '自然'
  /**
   * 肤色取色的色相角（度）。第十阶段·第一步，口径见 docs/依据/18 §2.4：
   * 🔴 只随单次请求走、⛔ 不落库；后端用它 + 深浅档锚点合成连续 Lab 送 colorFit。
   * ⛔ 这里刻意没有 skin_lab 这一格——客户端递不进连续明度，否则等于让曝光冒充肤色（18 §2.2 反例）。
   */
  skin_hue?: number
  /** 取样那块皮肤色的 '#rrggbb'，只为拆账与复现，⛔ 参与不了计算 */
  skin_hex?: string
  face_shape?: '圆脸' | '方脸' | '心形脸' | '椭圆脸' | '长脸'
  /**
   * 体型:五档，与后端引擎出的字一字一样。词表唯一出处 = backend/services/bodyTypes.js
   *（10-19 第一阶段统一:原来这里是「标准/偏瘦/偏胖/梨形/苹果形」，前三颗是 BMI 档、
   * 最后一颗与引擎的「苹果型」差一个字⇒门店 4 组穿搭规则永不命中;
   * 胖瘦那一维改由 bmi_level 承接，值与 backend/services/bmi.js 的 HEALTH_BANDS 同字）。
   */
  body_type?: '沙漏型' | '梨形' | '苹果型' | '直筒型' | '倒三角型'
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
  /** 依据档位一句话标签,如 'B 学术实证';未标注时后端给 'C 行业体系/经验' 口径 */
  依据档位?: string
  /** 该档位的判据说明(仅后台/规则浏览器接口 explainGroup 会给) */
  依据说明?: string
}

/**
 * 上衣 × 肤色 的色度学贴合分(后端 services/colorMetrics.js 算)
 * 换算与色差是 A 档(GB/T 7921 / ISO-CIE 11664),色相与明度效应是 B 档(两篇 DOI),
 * 三项合成的权重是 C 档手拍值 —— 所以这个分数只能讲"相对差异",不能讲"科学评分"。
 */
export interface ColorFitScore {
  /** 0~100 合成分 */
  score: number
  /** 上衣代表色,已归一成大写；⚠️ L5「只有深浅档」与 {L,a,b} 直传时为 null（没有 hex 可给） */
  top_hex: string | null
  /** 从结论文本里认出的色名,如 '雾霾蓝'；只有明度档时是 '深色'／'浅色' */
  top_label: string
  /** 与肤色的 CIEDE2000 色差；null ⇒ 这一条没有两个 Lab 可差（见 basis） */
  deltaE00: number | null
  /** 色相对比角 0~180,越小越同族；null 同上 */
  dHue: number | null
  /** 色相对比分量 0.5~1.0 = 0.5 + dHue/360;上衣衬脸按"对比越大越被偏好"给分(10-08 改) */
  hueContrast?: number
  /** false ⇒ 上衣属无彩色或只有明度档，色相这一轴按"没有信息"记 0.5，不参与总分 */
  hue_applies?: boolean
  /** 上衣明度 - 肤色明度(负=上衣更深,越显白)；null 同上 */
  dL: number | null
  /** 显白项 0~100 */
  brighten: number
  /** 上衣彩度 C*；null 同上 */
  chroma: number | null
  /** ΔE00 同色糊合闸门乘数(15~30 线性,见 colorMetrics.js FUSION_GATE)；L5 那档恒 1 */
  fusion_gate?: number
  /** 对比侧分(闸门后)与呼应侧分,总分是这两笔的 70/30；harmony_score null＝这一维缺数据 */
  contrast_score?: number
  harmony_score?: number | null
  /**
   * 这一分的来路(10-20 第六阶段·第一步)：hex／table-key／strip-color／add-color／synonym／
   * in-text／lab-object／lightness-band。'lightness-band'＝文案只说了"深色/浅色"，
   * 分数只有明度方向这一维，没有色差可言，展示层必须分开写。
   */
  basis?: string
  /** basis='synonym' 时是同义词库里的哪一个别名 */
  synonym_via?: string | null
  /** 色系软标签(红/橙/黄/绿/青/蓝/紫/粉/棕/无彩色)，只用于展示与"同色系"判，不进分 */
  family?: string | null
  /** 明度档：'深'／'中'／'浅'(L≤35／L≥65 语义切点) */
  band?: '深' | '中' | '浅' | null
  /** 依据档位说明 */
  evidence: string
}

/**
 * 身材适配分的单根轴(后端 services/topFitBody.js,六轴之一)
 * 缺席的轴不会出现在 axes 里(缺测就不算这一维),所以 score 恒有值且 0~1。
 */
export interface BodyFitAxis {
  key: 'shoulder' | 'waist' | 'ease' | 'length' | 'volume' | 'pattern'
  /** 轴的中文名,如 '松量' */
  name_cn: string
  /** 0~1:'上衣往哪修'与'这个人的比例偏差'对得上的程度 */
  score: number
  /** 手拍权重(标定中);总分按在场轴的权重归一化 */
  weight: number
  /** 这个人这一维的实测数或想往哪修(+加/−收) */
  person: number | string | null
  /** 这件上衣这一维的修形量;松量轴给的是实测松量 cm */
  garment: number | null
  /** 这一维的依据口径(B 方向 + C 刻度) */
  tier: string
  /** 这个数从哪一格算出来的(10-19 第二阶段：每一维都要能追到一格实测值) */
  based_on?: string
  /** 被闸门关掉时的说明(如条纹轴在 BMI≥25 时) */
  gated?: string
  /** 这一维是**估**出来的（10-19 第三阶段：没量 bust_cm、由版型档映射的区间中值） */
  estimated?: boolean
}

/** 上衣那一侧的"修形向量"（describeTop 的输出；null＝那一格没量到，不算这一维） */
export interface TopDescriptor {
  label: string
  /** 'wardrobe'＝这一件是衣柜里的一行，四格实测尺寸取得到；'no_row'＝只有规则结论那句文本 ⇒ 不打分 */
  source: 'wardrobe' | 'no_row'
  text?: string
  hex: string | null
  fit_style: string | null
  /** 版型档（10-19 第三阶段）：null＝没选或填的不是值域里的词 */
  fit_type?: string | null
  fabric_weight: string | null
  /** 这件衣服自己量到的四个数（cm）；null＝那格没填 */
  garment_cm?: {
    shoulder_cm: number | null
    bust_cm: number | null
    length_cm: number | null
    waistband_cm: number | null
  }
  /** 松量 cm：成品胸围 − 人体净胸围（实测口径）。没量 bust_cm 时改由版型档估（见 estimated） */
  ease: number | null
  shoulder: number | null
  waist: number | null
  length: number | null
  volume: number | null
  pattern: number | null
  /** 哪几维是估出来的（10-19 第三阶段：目前只有 ease 走版型映射） */
  estimated?: string[]
  /** 六格里量到几格（估的那格按半格计）；打分侧按它打折 */
  coverage?: number
  /** 认到了哪些线索(给用户看清分数不是凭空来的) */
  signals: string[]
}

/** 上衣 × 身体 的按人适配分(不看脸;脸侧那半在 ColorFitScore) */
export interface BodyFitScore {
  /** 0~100 合成分：在场轴加权归一后的分**再乘覆盖率惩罚因子**（10-19 第三阶段·模块二） */
  score: number
  /** 惩罚前的分（只在对内解释时用；对外一律报 score） */
  raw_score?: number
  /** 惩罚因子 = 0.5 + 0.5 × coverage */
  coverage_penalty?: number
  /** 这件上衣六格里量到几格（估的那格算半格） */
  coverage?: number
  axes: BodyFitAxis[]
  axes_present: string[]
  axes_missing: string[]
  top: TopDescriptor
  evidence: string
  /** 🔴 第十三阶段·第一步 §三·4：'rule_text'＝这一档不是量出来的，是**从这句建议文案自己
   *  的款式词/面料词认出来的离散档位**（修身/合身/宽松/廓形、薄/中/厚）。
   *  措辞红线（依据/21 §一·2）：⛔ 不许对顾客说成"量化了你的体型"，只能说"按这句话的款式词认的档"。 */
  inferred_from?: 'rule_text' | null
  /** 认档时命中了哪几个词，报告与前台要能指着它说"凭这两个词归的档" */
  inferred_words?: { fit: string[]; fabric: string[] }
}

/** 综合排序分的单个分量(2026-10-19 第二阶段「算法重排」) */
export interface RankDimension {
  /** rule 规则基础分 / color 色彩贴合分 / body 廓形贴合分 */
  key: 'rule' | 'color' | 'body'
  name_cn: string
  /** 0~100;null = 这一维没算出来(缺测) */
  score: number | null
  /** 实际生效权重:缺测为 0,body 那一维还要再乘这件衣服的实测覆盖率 */
  weight: number
  /** 仅 body 维带上:这件衣服的六格实测里量到几格 */
  coverage?: number
}

/** 决定这条推荐名次的综合分 = w1·规则 + w2·色彩 + w3·廓形(缺测退权后整体打折) */
export interface RankScore {
  score: number
  dims: RankDimension[]
  present: string[]
  missing: string[]
  /** 在场权重占满三分之几(0~1)。⚠️ 10-19 第三阶段起这一层只管"整维缺席"，
   *  廓形那一维"量到几格"的惩罚已经在身体层乘过了（BodyFitScore.coverage_penalty），这里不再折第二遍 */
  coverage: number
  /** 折扣系数 = FLOOR + (1−FLOOR)·coverage */
  factor: number
}

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

/**
 * 付费那份「深度细账」的回执（第十二阶段·第一步，`docs/依据/20` §三 E 节）。
 * 只有付费重放那一路会有这一块；免费路径的响应里这个键根本不出现。
 * 🔴 第十四阶段·第一步 C2：这里原来把价格写死成"99 元那份"——真价在 `app_settings.payment_amount_fen`
 * （`routes/payment.js:43-47` 现算），文案里那个数改一次价就变假话。⛔ 注释也不再写数。
 * ⛔ 前端不许据此"推算"任何没给的数——回执说什么就显示什么。
 */
export interface PaidReportReceipt {
  /** 🔴 C1：在线＝平台商户单号；人工凭证＝内部幂等键 `DEPOSIT-<id>`（⛔ 当单号展示） */
  out_trade_no: string
  amount_fen: number
  channel: 'wechat' | 'alipay' | 'manual'
  /** 到账事实来自哪张表：`online_order`＝`payment_orders`，`manual_deposit`＝已核凭证 */
  source?: 'online_order' | 'manual_deposit'
  deposit_id?: number | null
  /** 只有在线那一路 `out_trade_no` 真是平台单号；老数据没这个键时按在线单处理 */
  is_platform_order_no?: boolean
  /** 库里存的是 UTC 串，展示请用后端另给的 *_beijing 字段（权益接口里那一份） */
  paid_at: string | null
  granted_at: string
  report_no: number
  basis_log_id: number
  basis_input_at: string | null
  mode: 'store' | 'personal'
  /** 这份报告分几节交付：B 深度分析 / D 参数与口径 / E 回执 等，见规范 §三 */
  sections: string[]
}

/** 排在 Top 8 之外的那一尾（`_computed.ranking.beyond_top_n`，规范 §三 A 节） */
export interface BeyondTopN {
  count: number
  capped: boolean
  max: number
  rows: Array<{
    name: string
    source: string
    score: number | null
    present: string[]
    missing: string[]
    coverage: number | null
  }>
}

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
  /** 后端算出的派生字段(档案里没有的值);命理两块从这里取 */
  _computed?: {
    bazi?: BaziAnalysis
    bazi_today?: BaziDay
    favorable_element?: string
    unfavorable_element?: string
    /**
     * 这一轮色彩维吃的肤色从哪来（18 §2.4）：`photo_sample`＝这次角度真接管了色彩维／
     * `manual`＝只有档名／`null`＝肤色整格空着（色彩维必然缺席）。
     * ⛔ 只拆账，不是置信度、不进任何公式。
     * 🔴 落地实录订正：规范原写还有一种 `'archive'`，但路由在进引擎前已把档案并进 profile
     *（routes/recommend.js:151 mergeWithArchive），引擎内部分不出这一格是本次填的还是档案来的
     * ⇒ 这一档不实现，档案来的也记 `'manual'`。
     */
    skin_source?: 'photo_sample' | 'manual' | null
    /** 后端认下的那个色相角；没认 ⇒ null */
    skin_hue?: number | null
    /** 后端按同一把尺对那个角度现算的档名；角度越界 ⇒ null */
    skin_undertone?: '冷皮' | '自然' | '暖皮' | null
    [key: string]: unknown
  }
  wardrobe_gaps?: WardrobeGapResult
  wishlist?: ShoppingWishlistItem[]
  /** 上衣处方（身材+肤色）；六轴一个都算不出且肤色也认不出时整块缺席 */
  top_spec?: TopSpec
  /** 🔴 第十二阶段·第一步：只有付费领取那一路出现（`GET /api/payment/my?report=…`） */
  paid_report?: PaidReportReceipt
}

/** 八字五行分析(排盘来自 vendor/lunar,喜用神由本仓库算法推算) */
export interface BaziAnalysis {
  birthDate: string
  birthHour: string
  /** 四柱(填了时辰) / 三柱(时辰不清楚) */
  precision: '四柱' | '三柱'
  pillars: string[]
  day_master: string
  day_master_element: string
  strength: '身强' | '身弱' | '中和'
  /** 判定用的帮扶比值(含月支得令 +0.06),与 strength、后端 summary 同一口径、保留 3 位 */
  strength_ratio: number
  /** 冬月取火、夏月取水;为 null 表示本月不调候 */
  seasonal: string | null
  seasonal_applied: boolean
  scores: Record<string, number>
  missing: string[]
  strongest: string
  favorable: string[]
  unfavorable: string
  favorable_element: string
  unfavorable_element: string
  favorable_direction: string
  favorable_colors: string
  summary: string
}

/** 当日流日与个人喜用的关系 */
export interface BaziDay {
  date: string
  ganzhi: string
  element: string
  branch: string
  term: string
  tone: '顺' | '平' | '忌'
  note: string
  reason?: string
  colors?: string
}

/** 算法分析结果 */
export interface AlgorithmAnalysis {
  /** 分析板块:体型/脸型/肤色/体态/八字五行/今日参考,每个板块是一句话建议列表 */
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
  /**
   * 吊牌条码／店内编号（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
   * ⛔ 不建唯一约束：同一件衣服可以有两件、游客还共用会话 ⇒ "扫重了"由录入框查重时提醒，
   *    写入口不拦。NULL／不填＝这件不是扫来的。
   */
  sku?: string | null
  style_tags?: string[]
  color_tags?: string[]
  season_tags?: string[]
  occasion_tags?: string[]
  /** 花纹（选填）：条纹那一维只认这一格里的 竖条/竖条纹/横条/横条纹，认不出就不算这一维 */
  pattern?: string
  /**
   * 版型（旧列，10-19 第三阶段起**退役为只读展示标签**：两档值域撑不起四档松量，
   * 评分不再认它）。表单不再产生这一列，历史行的值原样留着显示。
   */
  fit_style?: '合体' | '宽松'
  /**
   * 版型四档（10-19 第三阶段·模块一）：上衣/外套/连衣裙**必选**。
   * 没量 bust_cm 时后端按这一档的放松量区间中值估松量（services/topFitBody.js 的 FIT_TYPE_EASE），
   * 且估出来的那一维在覆盖率里只按半格计 ⇒ 分数照样被惩罚折过，选版型买不到整格分数。
   * 量了 bust_cm ⇒ 只认实测，这一档一个分都不影响。
   */
  fit_type?: '修身' | '合身' | '宽松' | '廓形'
  /** 面料厚薄（选填）：决定同一件上衣的体量感，值域与后端 FABRIC_WEIGHT_VALUES 一致 */
  fabric_weight?: '薄' | '中' | '厚'
  /**
   * 成衣实测尺寸（cm，选填）——上衣打分的那四格（10-19 第二阶段「最后一公里」）。
   * 平铺在身上量：肩宽＝两肩缝点直线距离，胸围＝袖窿下方一周最宽处，
   * 衣长＝肩颈点到下摆，腰头高＝腰缝/收口带自身的高度（没有腰头就填 0）。
   * ⛔ 没填＝null＝这一维不参与打分，系统不会再从商品名里猜。
   */
  shoulder_cm?: number | null
  bust_cm?: number | null
  length_cm?: number | null
  waistband_cm?: number | null
  body_type_fit?: string[]
  condition?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/**
 * 这个人的"身材偏差向量"（后端 bodyDeviation）。
 * 数字项 null＝没量；want 项 null＝这一维不参与打分（缺测不出分，权重按在场轴归一）
 * want 的符号约定：+ 想往外加/强调，− 想往里收，0 这一维不推拉
 */
export interface BodyDeviation {
  bmi?: number
  shoulder_ratio?: number
  /** 肩宽÷净腰围（站内自建比值；Pazhoohi 2023 的 SHR 是肩围÷臀围，量不到肩围） */
  shoulder_waist_ratio?: number
  leg_ratio?: number
  bust_waist_diff?: number
  hip_waist_diff?: number
  bust_hip_diff?: number
  /** 腰沟 = min(胸腰差, 臀腰差)；胸围没量时只用臀腰差（后端 notes 会标 partial） */
  waist_groove_cm?: number
  wh_ratio?: number
  /** 按 BMI 定的松量合适区间（Liu 2006 方向 + Sakata 2020 区间先验） */
  ease_window_cm?: [number, number] | number[]
  want: {
    shoulder: number | null
    waist: number | null
    length: number | null
    volume: number | null
    pattern: number | null
  }
  notes: string[]
}

/** 衣橱上衣按身材打分的结果（POST /api/wardrobe/top-fit） */
export interface TopFitResult {
  person_deviation: BodyDeviation
  ranked: Array<{
    id?: number
    name: string
    score: number
    axes: BodyFitAxis[]
    axes_present: string[]
    axes_missing: string[]
    top: TopDescriptor
  }>
  unscored: Array<{ id?: number; name: string; reason: string }>
  top_count: number
  note: string
}

/**
 * 穿搭日记（`wardrobe_outfits` 一行）。
 * 2026-10-20 第八阶段·一d 接通写口后补上 `is_favorite`（后端 PUT 认这一格），
 * `user_id`/`session_id` 只读：身份归后端按请求头定，前端不许发（见 api.ts 的 OutfitDraft）。
 * `rating` 是"这套整体满意"的一把星 1~5；审美/合身两把星在推荐卡的反馈链上（`feedback_events`），
 * 日记这一格只有一列（本轮零迁移，没给它加列）。
 */
export interface WardrobeOutfit {
  id?: number
  session_id?: string | null
  user_id?: number | null
  name: string
  item_ids: number[]
  occasion?: string
  season?: string
  rating?: number
  notes?: string
  is_favorite?: boolean
  created_at?: string
  /**
   * 🔴 2026-10-21 第十一阶段·第一步（docs/依据/19 §二）：这套是**哪天穿的**。
   * `null`＝没记（⛔ 不是"今天"，也不拿 `created_at` 顶替——补记昨天的穿搭会被 created_at 记成今天，
   * 那是假数据不是缺数据）。格式 `YYYY-MM-DD`，按东八区日历日校验。
   */
  wear_date?: string | null
  /** 那天手选的天气档，词表唯一真相源在后端 `services/weatherService.js`（随 GET 一起带回来） */
  weather_level?: string | null
  /** 那天的体感温度（℃）；没填＝null，⛔ 不许用 0 冒充"没填" */
  feels_like_c?: number | null
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
  /** 后端为 category_* 缺口附带中文名(上衣/下装…);季节、色彩这类没有,前端用 type→中文兜底表 */
  label?: string
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
  /** 同 WardrobeGap:category_* 带中文名,过期/肤色这类靠前端兜底表 */
  label?: string
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
  /** 后端为 category_* 缺口附带中文名(项链/耳饰…);脸型、金属色这类没有,前端用 type→中文兜底表 */
  label?: string
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
  /** false = 图已生成但这次没进历史记录（后端落库失败，见 routes/tryon.js） */
  saved?: boolean
}

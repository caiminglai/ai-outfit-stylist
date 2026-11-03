// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝推荐卡上的两把分：色彩贴合（color_fit）与身体适配（body_fit）＋排序出账）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

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

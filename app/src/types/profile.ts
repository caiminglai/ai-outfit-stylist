// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝顾客档案与色彩四季型）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

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
  /**
   * 用户自选肤色深浅 0~100（连续值）。映射到华裔人群 L* P5(51)~P95(66)。
   * ⛔ 这是用户照镜子自选，不是照片明度，不违反"深浅只认档名锚点"那条硬规矩。
   */
  skin_lightness?: number
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
  /** 骨架量感连续值 0~100（0＝小巧，100＝大气），离散 label 由后端从该值推导 */
  frame_size_value?: number
  /** 线条倾向(选填):风格型第二轴;值与后端 LINE_LEVEL 键一致 */
  line_quality?: '偏直线' | '均衡' | '偏曲线'
  /** 线条曲直连续值 0~100（0＝偏直线，100＝偏曲线），离散 label 由后端从该值推导 */
  line_quality_value?: number

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
  /** 四季色彩体系计算结果（后端 seasonColor.getSeasonType 输出） */
  season_type?: SeasonType
  /** 五维肤色框架（HBN：黑/黄/红/白/青） */
  skin_five_dimensions?: SkinFiveDimensions
  budget?: '平价' | '中档' | '高端'
  allergy_metal?: string
  skin_type?: '干皮' | '油皮' | '混合' | '敏感'

  /** 四大身材标准·部位级标签（椰子胸/沙漏腰/母贝臀/酒杯腿），仅在量到对应围度时出 */
  body_highlights?: string[]
  body_highlights_details?: Record<string, { value: number; label: string }>

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

/** 四季色彩季型（后端 seasonColor.js 输出） */
export interface SeasonColor {
  name: string
  hex: string | null
}

/** 五维肤色框架（HBN 蓝皮书：黑/黄/红/白/青） */
export interface SkinFiveDimensions {
  black: number
  white: number
  yellow: number
  red: number
  cyan: number
  primary: string
}

export interface SeasonType {
  season: string
  season_name: string
  warmth: 'warm' | 'cool' | 'neutral'
  depth: 'light' | 'deep'
  traits: string
  palette: SeasonColor[]
  avoid: SeasonColor[]
  confidence: number
  basis: string
}

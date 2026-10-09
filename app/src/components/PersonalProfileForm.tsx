import { useState } from 'react'
import type { CustomerProfile } from '../types'

/**
 * 个人形象分析表单 - 深色科技风（50+ 维度）
 *
 * 使用 .opt-btn / .section-title / .gradient-btn 等深色主题组件类
 * 配色：var(--bg) 背景 + var(--accent) 青绿强调
 */

/* ── 选项常量 ── */

const GENDER_OPTIONS = [
  { value: '女', label: '女', icon: '👩' },
  { value: '男', label: '男', icon: '👨' },
] as const

const AGE_RANGE_OPTIONS = [
  { value: '18-25', label: '18-25' },
  { value: '26-35', label: '26-35' },
  { value: '36-45', label: '36-45' },
  { value: '46+', label: '46+' },
] as const

const HEIGHT_RANGE_OPTIONS = [
  { value: '150-160', label: '150-160' },
  { value: '160-170', label: '160-170' },
  { value: '170-180', label: '170-180' },
  { value: '180+', label: '180+' },
] as const

/** 冷暖调(底调):与门店表单 SKIN_TONE_OPTIONS 同一套值,两个口径合起来才能算色彩四季型 */
const SKIN_TONE_OPTIONS = [
  { value: '暖皮', label: '暖皮', icon: '🌼' },
  { value: '冷皮', label: '冷皮', icon: '❄️' },
  { value: '自然', label: '自然', icon: '🍃' },
] as const

const SKIN_TONE_DETAIL_OPTIONS = [
  { value: '白皙', label: '白皙' },
  { value: '自然白', label: '自然白' },
  { value: '偏黄', label: '偏黄' },
  { value: '小麦色', label: '小麦色' },
  { value: '古铜色', label: '古铜色' },
] as const

/** 纯度档:值与后端 CHROMA_LEVEL 一字一样,冷暖+深浅定出四季后再用这根轴细分到十二型 */
const COLOR_CHROMA_OPTIONS = [
  { value: '净亮', label: '净亮' },
  { value: '柔雾', label: '柔雾' },
  { value: '中间', label: '中间' },
] as const

const FACE_SHAPE_OPTIONS = [
  { value: '圆脸', label: '圆脸', icon: '⭕' },
  { value: '方脸', label: '方脸', icon: '⬜' },
  { value: '心形脸', label: '心形脸', icon: '❤️' },
  { value: '椭圆脸', label: '椭圆脸', icon: '🥚' },
  { value: '长脸', label: '长脸', icon: '▯' },
] as const

const BODY_TYPE_DETAIL_OPTIONS = [
  { value: '沙漏型', label: '沙漏型', icon: '⌛' },
  { value: '梨形', label: '梨形', icon: '🍐' },
  { value: '苹果型', label: '苹果型', icon: '🍎' },
  { value: '直筒型', label: '直筒型', icon: '📏' },
  { value: '倒三角型', label: '倒三角型', icon: '🔻' },
] as const

const SHOULDER_TYPE_OPTIONS = [
  { value: '窄肩', label: '窄肩' },
  { value: '标准肩', label: '标准肩' },
  { value: '宽肩', label: '宽肩' },
] as const

/** 骨架量感:值与后端 FRAME_LEVEL 一字一样,与线条倾向合起来才判得出风格型 */
const FRAME_SIZE_OPTIONS = [
  { value: '小巧', label: '小巧' },
  { value: '适中', label: '适中' },
  { value: '大气', label: '大气' },
] as const

/** 线条倾向:值与后端 LINE_LEVEL 一字一样 */
const LINE_QUALITY_OPTIONS = [
  { value: '偏直线', label: '偏直线' },
  { value: '均衡', label: '均衡' },
  { value: '偏曲线', label: '偏曲线' },
] as const

const NECK_LENGTH_OPTIONS = [
  { value: '短', label: '短' },
  { value: '中', label: '中' },
  { value: '长', label: '长' },
] as const

const EYE_SIZE_OPTIONS = [
  { value: '大', label: '大' },
  { value: '中', label: '中' },
  { value: '小', label: '小' },
] as const

const EYE_SHAPE_OPTIONS = [
  { value: '圆眼', label: '圆眼' },
  { value: '杏眼', label: '杏眼' },
  { value: '丹凤眼', label: '丹凤眼' },
  { value: '下垂眼', label: '下垂眼' },
] as const

const NOSE_HEIGHT_OPTIONS = [
  { value: '高', label: '高' },
  { value: '中', label: '中' },
  { value: '低', label: '低' },
] as const

const LIP_THICKNESS_OPTIONS = [
  { value: '厚', label: '厚' },
  { value: '中', label: '中' },
  { value: '薄', label: '薄' },
] as const

/** 三庭:发际线→眉心→鼻底→下巴底,看哪一段最长。值与后端 FACE_PROPORTION_GUIDE 键一致 */
const FACE_RATIO_OPTIONS = [
  { value: '比例均衡', label: '三段差不多' },
  { value: '上庭偏长', label: '额头高' },
  { value: '中庭偏长', label: '鼻子长' },
  { value: '下庭偏长', label: '下巴长' },
] as const

/** 眼距:两侧内眼角间距 vs 一只眼的宽度。值与后端 EYE_SPACING_GUIDE 键一致 */
const EYE_SPACING_OPTIONS = [
  { value: '眼距偏宽', label: '偏宽' },
  { value: '眼距适中', label: '适中' },
  { value: '眼距偏窄', label: '偏窄' },
] as const

const PREFERRED_STYLE_OPTIONS = [
  { value: '甜美风', label: '甜美风' },
  { value: '知性优雅', label: '知性优雅' },
  { value: '休闲运动', label: '休闲运动' },
  { value: '街头潮流', label: '街头潮流' },
  { value: '复古风', label: '复古风' },
  { value: '职场OL', label: '职场OL' },
  { value: '日系清新', label: '日系清新' },
  { value: '韩系时尚', label: '韩系时尚' },
] as const

const OCCASION_OPTIONS = [
  { value: '上班通勤', label: '上班通勤' },
  { value: '校园日常', label: '校园日常' },
  { value: '居家休闲', label: '居家休闲' },
  { value: '约会聚会', label: '约会聚会' },
  { value: '商务正式', label: '商务正式' },
  { value: '运动健身', label: '运动健身' },
  { value: '婚礼宴会', label: '婚礼宴会' },
] as const

/** 拍照场景:值与规则库"姿势"类规则的 scenario 条件值一一对应 */
const PHOTO_SCENE_OPTIONS = [
  { value: '日常街拍', label: '日常街拍' },
  { value: '职业照', label: '证件照/职业照' },
  { value: '旅行打卡', label: '旅行打卡' },
  { value: '探店', label: '探店咖啡馆' },
  { value: '户外写真', label: '户外写真' },
  { value: '闺蜜合照', label: '闺蜜合照' },
  { value: '自拍', label: '手机自拍' },
] as const

const MAIN_GOAL_OPTIONS = [
  { value: '脸型修饰', label: '脸型修饰' },
  { value: '发型改造', label: '发型改造' },
  { value: '身材比例', label: '身材比例' },
  { value: '穿搭提升', label: '穿搭提升' },
  { value: '妆容优化', label: '妆容优化' },
  { value: '肤色改善', label: '肤色改善' },
] as const

const HEIGHT_WISH_OPTIONS = [
  { value: '想显高', label: '想显高' },
  { value: '保持就好', label: '保持就好' },
] as const

const WEIGHT_WISH_OPTIONS = [
  { value: '想显瘦', label: '想显瘦' },
  { value: '想丰满一些', label: '想丰满一些' },
  { value: '保持就好', label: '保持就好' },
] as const

const POSTURE_OPTIONS = [
  { value: '圆肩', label: '圆肩' },
  { value: '驼背', label: '驼背' },
  { value: '骨盆前倾', label: '骨盆前倾' },
  { value: '高低肩', label: '高低肩' },
  { value: '无', label: '无' },
] as const

const SEASON_OPTIONS = [
  { value: '春', label: '春' },
  { value: '夏', label: '夏' },
  { value: '秋', label: '秋' },
  { value: '冬', label: '冬' },
] as const

const REGION_OPTIONS = [
  { value: '北方', label: '北方（寒冷干燥）', icon: '❄️' },
  { value: '南方', label: '南方（温暖潮湿）', icon: '🌧️' },
] as const

const BUDGET_OPTIONS = [
  { value: '平价', label: '平价' },
  { value: '中档', label: '中档' },
  { value: '高端', label: '高端' },
] as const

const SKIN_TYPE_OPTIONS = [
  { value: '干皮', label: '干皮' },
  { value: '油皮', label: '油皮' },
  { value: '混合', label: '混合' },
  { value: '敏感', label: '敏感' },
] as const

/** 时辰档位:value 必须与后端 SHICHEN 键一致,区间只写在 label 上 */
const BIRTH_HOUR_OPTIONS = [
  { value: '子时', label: '子时 23-1' },
  { value: '丑时', label: '丑时 1-3' },
  { value: '寅时', label: '寅时 3-5' },
  { value: '卯时', label: '卯时 5-7' },
  { value: '辰时', label: '辰时 7-9' },
  { value: '巳时', label: '巳时 9-11' },
  { value: '午时', label: '午时 11-13' },
  { value: '未时', label: '未时 13-15' },
  { value: '申时', label: '申时 15-17' },
  { value: '酉时', label: '酉时 17-19' },
  { value: '戌时', label: '戌时 19-21' },
  { value: '亥时', label: '亥时 21-23' },
  { value: '不清楚', label: '不清楚' },
] as const

/* ── Props ── */

interface PersonalProfileFormProps {
  initial?: Partial<CustomerProfile>
  onSubmit: (profile: CustomerProfile) => void
  /** 每改一项就回调整份当前值,上层拿它防抖存草稿 */
  onChange?: (profile: CustomerProfile) => void
  submitting?: boolean
  compact?: boolean
}

/* ── 组件 ── */

export default function PersonalProfileForm({
  initial,
  onSubmit,
  onChange,
  submitting,
  compact,
}: PersonalProfileFormProps) {
  const [profile, setProfile] = useState<CustomerProfile>({
    nickname: initial?.nickname || '',
    gender: initial?.gender,
    age_range: initial?.age_range,
    height_range: initial?.height_range,
    height: initial?.height,
    region: initial?.region,
    weight: initial?.weight,
    bust: initial?.bust,
    waist: initial?.waist,
    hip: initial?.hip,
    shoulder: initial?.shoulder,
    leg_length: initial?.leg_length,
    skin_tone: initial?.skin_tone,
    skin_tone_detail: initial?.skin_tone_detail,
    color_chroma: initial?.color_chroma,
    face_shape: initial?.face_shape,
    body_type_detail: initial?.body_type_detail,
    shoulder_type: initial?.shoulder_type,
    frame_size: initial?.frame_size,
    line_quality: initial?.line_quality,
    neck_length: initial?.neck_length,
    eye_size: initial?.eye_size,
    eye_shape: initial?.eye_shape,
    nose_height: initial?.nose_height,
    lip_thickness: initial?.lip_thickness,
    face_ratio: initial?.face_ratio,
    eye_spacing: initial?.eye_spacing,
    preferred_style: initial?.preferred_style,
    occasion: initial?.occasion,
    photo_scene: initial?.photo_scene,
    main_goal: initial?.main_goal,
    height_wish: initial?.height_wish,
    weight_wish: initial?.weight_wish,
    posture: initial?.posture,
    season: initial?.season,
    budget: initial?.budget,
    skin_type: initial?.skin_type,
    allergy_metal: initial?.allergy_metal,
    birth_date: initial?.birth_date,
    birth_hour: initial?.birth_hour,
  })

  const update = (key: keyof CustomerProfile, value: unknown) => {
    setProfile((prev) => ({ ...prev, [key]: value }))
    onChange?.({ ...profile, [key]: value })
  }

  const handleSubmit = () => {
    if (!profile.gender) return
    onSubmit(profile)
  }

  const gap = compact ? 'gap-2' : 'gap-3'
  const sectionClass = compact ? 'mb-4' : 'mb-5'
  const sectionStyle = {
    borderBottom: '1px solid var(--line)',
    paddingBottom: compact ? '10px' : '14px',
    marginBottom: compact ? '10px' : '14px',
  }
  const optBtnPad = compact
    ? { padding: '6px 8px', fontSize: '11px' }
    : { padding: '8px 10px', fontSize: '12px' }

  const requiredStar = <span style={{ color: 'var(--danger)', marginLeft: '2px' }}>*</span>

  /* ── 渲染辅助 ── */

  function renderOptBtns<T extends string>(
    options: ReadonlyArray<{ value: T; label: string; icon?: string }>,
    fieldKey: keyof CustomerProfile,
    gridCols?: string,
  ) {
    return (
      <div className={`grid ${gridCols || 'grid-cols-3'} ${gap}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => update(fieldKey, opt.value)}
            className={`opt-btn ${profile[fieldKey] === opt.value ? 'active' : ''}`}
            style={{ textAlign: 'center', ...optBtnPad }}
          >
            {opt.icon && <span className="mr-1">{opt.icon}</span>}
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  type NumberField = 'height' | 'weight' | 'bust' | 'waist' | 'hip' | 'leg_length' | 'shoulder'

  function renderNumberInput(key: NumberField, label: string, placeholder: string) {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          {label}
        </div>
        <input
          type="number"
          placeholder={placeholder}
          className="form-input"
          value={profile[key] ?? ''}
          onChange={(e) => update(key, e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {/* ── 分区1: 基本信息 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">基本信息{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          昵称
        </div>
        <input
          type="text"
          value={profile.nickname || ''}
          onChange={(e) => update('nickname', e.target.value)}
          placeholder="请输入您的昵称"
          className="opt-btn w-full mb-4"
          style={{
            padding: '8px 12px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        />

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          性别
        </div>
        <div className={`flex ${gap} mb-4`}>
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('gender', opt.value)}
              className={`opt-btn flex-1 ${profile.gender === opt.value ? 'active' : ''}`}
              style={optBtnPad}
            >
              <span className="mr-1">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            出生日期（选填）
          </span>
          {profile.birth_date && (
            <button
              onClick={() => {
                const next: CustomerProfile = { ...profile, birth_date: '', birth_hour: '' }
                setProfile(next)
                onChange?.(next)
              }}
              className="text-xs"
              style={{ color: 'var(--danger)' }}
            >
              填错了？清除
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <input
            type="date"
            className="form-input flex-1"
            value={profile.birth_date ?? ''}
            onChange={(e) => update('birth_date', e.target.value || '')}
          />
          <select
            className="form-select flex-1"
            style={{ paddingRight: '26px' }}
            value={profile.birth_hour ?? ''}
            disabled={!profile.birth_date}
            onChange={(e) => update('birth_hour', e.target.value || '')}
          >
            <option value="">{profile.birth_date ? '出生时辰' : '时辰（先填日期）'}</option>
            {BIRTH_HOUR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          填了才按你的喜用五行调整颜色、搭配与妆容；不填只按身体条件给建议。
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          年龄段{profile.birth_date ? '（已按出生日期算，不用再选）' : ''}
        </div>
        {profile.birth_date ? (
          <div className="opt-btn active text-center" style={{ ...optBtnPad, cursor: 'default' }}>
            按生日自动计算
          </div>
        ) : (
          renderOptBtns(AGE_RANGE_OPTIONS, 'age_range', 'grid-cols-4')
        )}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          身高范围
        </div>
        {renderOptBtns(HEIGHT_RANGE_OPTIONS, 'height_range', 'grid-cols-4')}

        <div className="flex gap-3 mt-4">
          {renderNumberInput('height', '具体身高', 'cm，如 165')}
          {renderNumberInput('weight', '体重', 'kg，如 55')}
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          所在地区
        </div>
        <div className={`flex ${gap} mb-4`}>
          {REGION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('region', opt.value)}
              className={`opt-btn flex-1 ${profile.region === opt.value ? 'active' : ''}`}
              style={optBtnPad}
            >
              <span className="mr-1">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          三围与腿长（选填，用于自动判断体型、腰臀比与上下身比例；腿长量髋骨到脚跟）
        </div>
        <div className="flex gap-3">
          {renderNumberInput('bust', '胸围', 'cm')}
          {renderNumberInput('waist', '腰围', 'cm')}
          {renderNumberInput('hip', '臀围', 'cm')}
          {renderNumberInput('leg_length', '腿长', 'cm')}
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          肩宽（选填，量两侧肩峰点之间的直线距离，不是衣服肩线）。
          <span style={{ color: 'var(--text)' }}>不填</span>
          ：肩宽比与「倒三角 / 苹果型」这两条判不了，系统不会替你猜一个数。
        </div>
        <div className="flex gap-3">
          {renderNumberInput('shoulder', '肩宽', 'cm，如 39')}
          <div className="flex-1 min-w-0" />
        </div>
      </section>

      {/* ── 分区2: 肤色与脸型 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">肤色与脸型{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          肤色冷暖（选填，与下面深浅一起用于判定色彩四季型）
        </div>
        <div className={`grid grid-cols-3 ${gap}`}>
          {SKIN_TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('skin_tone', opt.value)}
              className={`opt-btn ${profile.skin_tone === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', ...optBtnPad }}
            >
              <div className="text-base">{opt.icon}</div>
              <div className="text-[10px] mt-0.5">{opt.label}</div>
            </button>
          ))}
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          肤色细分
        </div>
        {renderOptBtns(SKIN_TONE_DETAIL_OPTIONS, 'skin_tone_detail', 'grid-cols-5')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          色彩纯度（选填，与冷暖·深浅合起来定到十二型）
        </div>
        <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>
          净亮＝穿饱和亮色更精神；柔雾＝穿灰调莫兰迪更耐看；拿不准选中间
        </div>
        {renderOptBtns(COLOR_CHROMA_OPTIONS, 'color_chroma')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          脸型
        </div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {FACE_SHAPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('face_shape', opt.value)}
              className={`opt-btn ${profile.face_shape === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', ...optBtnPad }}
            >
              <div className="text-base">{opt.icon}</div>
              <div className="text-[10px] mt-0.5">{opt.label}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ── 分区3: 体型分析 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">体型分析{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          体型分类
        </div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {BODY_TYPE_DETAIL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('body_type_detail', opt.value)}
              className={`opt-btn ${profile.body_type_detail === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', ...optBtnPad }}
            >
              <div className="text-base">{opt.icon}</div>
              <div className="text-[10px] mt-0.5">{opt.label}</div>
            </button>
          ))}
        </div>

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          肩型
        </div>
        {renderOptBtns(SHOULDER_TYPE_OPTIONS, 'shoulder_type')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          骨架量感（选填，与下面线条一起定风格型）
        </div>
        <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>
          看手腕与肩：骨点细窄＝小巧，匀称＝适中，宽厚＝大气
        </div>
        {renderOptBtns(FRAME_SIZE_OPTIONS, 'frame_size')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          身体线条（选填）
        </div>
        <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>
          肩平腰线直＝偏直线，有明显腰臀差＝偏曲线，两者都不突出＝均衡
        </div>
        {renderOptBtns(LINE_QUALITY_OPTIONS, 'line_quality')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          颈长
        </div>
        {renderOptBtns(NECK_LENGTH_OPTIONS, 'neck_length')}
      </section>

      {/* ── 分区4: 五官细节 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">五官细节{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          眼大小
        </div>
        {renderOptBtns(EYE_SIZE_OPTIONS, 'eye_size')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          眼型
        </div>
        {renderOptBtns(EYE_SHAPE_OPTIONS, 'eye_shape', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          眼距（两只内眼角之间的间距，和一只眼的宽度比一比）
        </div>
        {renderOptBtns(EYE_SPACING_OPTIONS, 'eye_spacing')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          鼻梁
        </div>
        {renderOptBtns(NOSE_HEIGHT_OPTIONS, 'nose_height')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          唇厚
        </div>
        {renderOptBtns(LIP_THICKNESS_OPTIONS, 'lip_thickness')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          三庭（发际线→眉心→鼻底→下巴底分三段，看哪段最长）
        </div>
        {renderOptBtns(FACE_RATIO_OPTIONS, 'face_ratio', 'grid-cols-4')}
      </section>

      {/* ── 分区5: 风格偏好 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">风格偏好{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          风格偏好
        </div>
        {renderOptBtns(PREFERRED_STYLE_OPTIONS, 'preferred_style', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          主要场合
        </div>
        {renderOptBtns(OCCASION_OPTIONS, 'occasion', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          拍照场景（选填，只影响姿势建议）
        </div>
        {renderOptBtns(PHOTO_SCENE_OPTIONS, 'photo_scene', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          主要目标
        </div>
        {renderOptBtns(MAIN_GOAL_OPTIONS, 'main_goal', 'grid-cols-3')}
      </section>

      {/* ── 分区6: 改善目标 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">改善目标{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          身高愿望
        </div>
        {renderOptBtns(HEIGHT_WISH_OPTIONS, 'height_wish', 'grid-cols-2')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          体重愿望
        </div>
        {renderOptBtns(WEIGHT_WISH_OPTIONS, 'weight_wish')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          体态问题
        </div>
        {renderOptBtns(POSTURE_OPTIONS, 'posture', 'grid-cols-5')}
      </section>

      {/* ── 分区7: 其他偏好 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">其他偏好{requiredStar}</div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          季节
        </div>
        {renderOptBtns(SEASON_OPTIONS, 'season', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          预算
        </div>
        {renderOptBtns(BUDGET_OPTIONS, 'budget')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          肤质
        </div>
        {renderOptBtns(SKIN_TYPE_OPTIONS, 'skin_type', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          过敏金属
        </div>
        <input
          type="text"
          placeholder="请输入过敏金属（如：镍、铬等），无则留空"
          className="form-input"
          value={profile.allergy_metal ?? ''}
          onChange={(e) => update('allergy_metal', e.target.value || undefined)}
        />
      </section>

      {/* ── 提交按钮 ── */}
      <section style={{ marginTop: '16px' }}>
        <button
          onClick={handleSubmit}
          disabled={!profile.gender || submitting}
          className="gradient-btn w-full py-2.5 text-sm"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner" style={{ width: '14px', height: '14px' }} />
              生成中...
            </span>
          ) : (
            '✨ 生成个人形象分析'
          )}
        </button>
      </section>
    </div>
  )
}

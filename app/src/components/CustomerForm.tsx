import { useState } from 'react'
import type { CustomerProfile } from '../types'
import SkinSampler from './SkinSampler'

/**
 * 顾客数据收集表单 - 深色科技风
 *
 * 使用 .opt-btn / .section-title 等深色主题组件类
 * 配色：var(--bg) 背景 + var(--accent) 青绿强调
 */

const GENDER_OPTIONS = [
  { value: '女', label: '女', icon: '👩' },
  { value: '男', label: '男', icon: '👨' },
] as const

const SKIN_TONE_OPTIONS = [
  { value: '暖皮', label: '暖皮', desc: '偏黄暖色调' },
  { value: '冷皮', label: '冷皮', desc: '偏粉冷色调' },
  { value: '自然', label: '自然', desc: '中性肤色' },
] as const

/** 深浅档:与个人表单 SKIN_TONE_DETAIL_OPTIONS 同一套值,冷暖+深浅合起来才能算色彩四季型 */
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

/**
 * 体型：五档与后端引擎出的字一字一样（词表在 backend/services/bodyTypes.js）。
 * 原来这里写的是「标准/偏瘦/偏胖/梨形/苹果形」——前三颗是 BMI 档不是体型，
 * 最后一颗「苹果形」与引擎的「苹果型」差一个字，导致门店这 4 组穿搭规则从写下起一次没命中过
 *（10-19 现量，判据见 bodyTypes.js 文件头）。偏瘦/偏胖这两档改由高矮胖瘦自动算的 bmi_level 接，
 * 表单这里只留真正看得出 silhouette 的五档。
 */
const BODY_TYPE_OPTIONS = [
  { value: '沙漏型', label: '沙漏型' },
  { value: '梨形', label: '梨形' },
  { value: '苹果型', label: '苹果型' },
  { value: '直筒型', label: '直筒型' },
  { value: '倒三角型', label: '倒三角型' },
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

const AGE_RANGE_OPTIONS = [
  { value: '18-25', label: '18-25' },
  { value: '26-35', label: '26-35' },
  { value: '36-45', label: '36-45' },
  { value: '46+', label: '46+' },
] as const

/** 值与规则库 region 条件取值一一对应(门店规则 6 组按南北分档) */
const REGION_OPTIONS = [
  { value: '北方', label: '北方', desc: '干冷、层级穿搭多' },
  { value: '南方', label: '南方', desc: '湿润、轻薄通透' },
] as const

const SCENARIO_OPTIONS = [
  { value: '通勤', label: '通勤', icon: '💼' },
  { value: '约会', label: '约会', icon: '💕' },
  { value: '面试', label: '面试', icon: '📋' },
  { value: '休闲', label: '休闲', icon: '☕' },
  { value: '聚会', label: '聚会', icon: '🎉' },
] as const

interface CustomerFormProps {
  initial?: Partial<CustomerProfile>
  onSubmit: (profile: CustomerProfile) => void
  submitting?: boolean
  compact?: boolean
}

/** 档案 → 表单初始值(挂载时铺一次,晚到的档案再按同一口径铺一次) */
function fromInitial(initial?: Partial<CustomerProfile>): CustomerProfile {
  return {
    nickname: initial?.nickname || '',
    gender: initial?.gender,
    age_range: initial?.age_range,
    region: initial?.region,
    height: initial?.height,
    weight: initial?.weight,
    bust: initial?.bust,
    waist: initial?.waist,
    shoulder: initial?.shoulder,
    skin_tone: initial?.skin_tone,
    skin_tone_detail: initial?.skin_tone_detail,
    skin_lightness: initial?.skin_lightness,
    color_chroma: initial?.color_chroma,
    face_shape: initial?.face_shape,
    body_type: initial?.body_type,
    frame_size: initial?.frame_size,
    frame_size_value: initial?.frame_size_value,
    line_quality: initial?.line_quality,
    line_quality_value: initial?.line_quality_value,
    scenario: initial?.scenario || '通勤',
  }
}

export default function CustomerForm({
  initial,
  onSubmit,
  submitting,
  compact,
}: CustomerFormProps) {
  // 没动过表单 ⇒ 界面直接跟着档案走。档案是在"选择模式"那一屏异步读的,他点得快时表单已经挂载、
  // 档案还没回;老代码只在挂载那一刻读一次 initial,晚到的那份就静默丢了(还得重新填一遍)。
  // 派生而不是 useEffect:不用effect就没级联渲染,也不会覆盖他正在打的字
  const [override, setOverride] = useState<CustomerProfile | null>(null)
  const profile = override ?? fromInitial(initial)

  const update = (key: keyof CustomerProfile, value: CustomerProfile[keyof CustomerProfile]) => {
    setOverride({ ...profile, [key]: value })
  }

  const handleSubmit = () => {
    if (!profile.gender) return
    onSubmit(profile)
  }

  const gap = compact ? 'gap-2' : 'gap-3'
  const sectionClass = compact ? 'mb-4' : 'mb-5'

  /** 选填的分类轴:一行标签 + 一句怎么自判的提示 + 三个按钮 */
  const renderTriRow = (
    label: string,
    hint: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    selected: string | undefined,
    onPick: (value: string) => void,
  ) => (
    <>
      <div className="text-xs mt-3 mb-2" style={{ opacity: 0.7 }}>
        {label}
      </div>
      <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>
        {hint}
      </div>
      <div className={`grid grid-cols-3 ${gap}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onPick(opt.value)}
            className={`opt-btn ${selected === opt.value ? 'active' : ''}`}
            style={{ textAlign: 'center', padding: '8px 4px', fontSize: '12px' }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  )

  return (
    <div className="space-y-1">
      {/* 昵称 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">昵称</div>
        <input
          type="text"
          value={profile.nickname || ''}
          onChange={(e) => update('nickname', e.target.value)}
          placeholder="请输入您的昵称"
          className="opt-btn w-full"
          style={{
            padding: '8px 12px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        />
      </section>

      {/* 性别 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">性别</div>
        <div className={`flex ${gap}`}>
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('gender', opt.value)}
              className={`opt-btn flex-1 ${profile.gender === opt.value ? 'active' : ''}`}
              style={{ padding: '8px 10px' }}
            >
              <span className="mr-1">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 年龄段 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">年龄段</div>
        <div className={`grid grid-cols-4 ${gap}`}>
          {AGE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('age_range', opt.value)}
              className={`opt-btn ${profile.age_range === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', padding: '8px 4px', fontSize: '12px' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 地区 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">常居地区</div>
        <div className={`flex ${gap}`}>
          {REGION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('region', opt.value)}
              className={`opt-btn flex-1 ${profile.region === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center' }}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              {!compact && (
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>
                  {opt.desc}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* 肤色 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">肤色冷暖</div>
        <div className={`flex ${gap}`}>
          {SKIN_TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('skin_tone', opt.value)}
              className={`opt-btn flex-1 ${profile.skin_tone === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center' }}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              {!compact && (
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>
                  {opt.desc}
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="text-xs mt-3 mb-2" style={{ opacity: 0.7 }}>
          深浅（选填，与冷暖一起判定色彩四季型）
        </div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {SKIN_TONE_DETAIL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('skin_tone_detail', opt.value)}
              className={`opt-btn ${profile.skin_tone_detail === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', padding: '8px 4px' }}
            >
              <div className="text-xs">{opt.label}</div>
            </button>
          ))}
        </div>
        {/* 肤色深浅连续滑块：0~100 映射到华裔 L* P5(51)~P95(66) */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px]" style={{ opacity: 0.7 }}>
              肤色深浅（连续值）
            </span>
            <span className="q-slider-val">{profile.skin_lightness ?? 50}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={profile.skin_lightness ?? 50}
            onChange={(e) => update('skin_lightness', Number(e.target.value))}
            className="q-slider"
            style={{
              background: `linear-gradient(to right, var(--accent) ${((profile.skin_lightness ?? 50) / 100) * 100}%, var(--line) ${((profile.skin_lightness ?? 50) / 100) * 100}%)`,
            }}
          />
          <div className="flex justify-between text-[10px] mt-1" style={{ opacity: 0.6 }}>
            <span>古铜</span>
            <span>白皙</span>
          </div>
        </div>
        {/* 取色（选填）：浏览器本机算，照片不出设备。口径见 docs/依据/18 §2.1/§2.4 */}
        <SkinSampler
          compact={compact}
          onConfirm={(undertone, sample) => {
            // ⛔ 只碰冷暖这一格：深浅那栏照片判不了明暗（18 §2.3），留给用户自己确认
            setOverride({
              ...profile,
              skin_tone: undertone,
              skin_hue: sample.h,
              skin_hex: sample.hex,
            })
          }}
          onClear={() => {
            // 第十三阶段·§四·3：只撤这一屏取出来的两个连续值（色相角 + 取样 hex），
            // ⛔ 不动 `skin_tone`——清掉后色彩侧要退回手选肤色档（18 §三 缺测降级链），
            // 把档位一起清了等于抹掉用户自己选的东西；也不发任何请求（库里没有取色结果可删）。
            setOverride({ ...profile, skin_hue: undefined, skin_hex: undefined })
          }}
        />
        {renderTriRow(
          '色彩纯度（选填，定到色彩十二型）',
          '净亮＝穿饱和亮色更精神；柔雾＝穿灰调莫兰迪更耐看；拿不准选中间',
          COLOR_CHROMA_OPTIONS,
          profile.color_chroma,
          (v) => update('color_chroma', v as CustomerProfile['color_chroma']),
        )}
      </section>

      {/* 脸型 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">脸型</div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {FACE_SHAPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('face_shape', opt.value)}
              className={`opt-btn ${profile.face_shape === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', padding: '8px 4px' }}
            >
              <div className="text-base">{opt.icon}</div>
              <div className="text-[10px] mt-0.5">{opt.label}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 体型 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">体型</div>
        <div className="text-xs mb-2" style={{ opacity: 0.7 }}>
          胸臀差不多又有腰＝沙漏型；胯比胸宽＝梨形；腰腹最粗＝苹果型；胸腰臀接近＝直筒型；肩宽胯窄＝倒三角型。拿不准就不选，胖瘦那一维由高矮体重自动算。
        </div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {BODY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('body_type', opt.value)}
              className={`opt-btn ${profile.body_type === opt.value ? 'active' : ''}`}
              style={{ padding: '8px 4px', fontSize: '12px' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {renderTriRow(
          '骨架量感（选填，定风格型）',
          '看手腕与肩：骨点细窄＝小巧，匀称＝适中，宽厚＝大气',
          FRAME_SIZE_OPTIONS,
          profile.frame_size,
          (v) => update('frame_size', v as CustomerProfile['frame_size']),
        )}
        <div className="mt-1.5">
          <input
            type="range"
            min={0}
            max={100}
            value={profile.frame_size_value ?? 50}
            onChange={(e) => update('frame_size_value', Number(e.target.value))}
            className="q-slider"
            style={{
              background: `linear-gradient(to right, var(--accent) ${((profile.frame_size_value ?? 50) / 100) * 100}%, var(--line) ${((profile.frame_size_value ?? 50) / 100) * 100}%)`,
            }}
          />
          <div className="flex justify-between text-[10px] mt-1" style={{ opacity: 0.6 }}>
            <span>小巧</span>
            <span>大气</span>
          </div>
        </div>
        {renderTriRow(
          '身体线条（选填）',
          '肩平腰线直＝偏直线，有明显腰臀差＝偏曲线，两者都不突出＝均衡',
          LINE_QUALITY_OPTIONS,
          profile.line_quality,
          (v) => update('line_quality', v as CustomerProfile['line_quality']),
        )}
        <div className="mt-1.5">
          <input
            type="range"
            min={0}
            max={100}
            value={profile.line_quality_value ?? 50}
            onChange={(e) => update('line_quality_value', Number(e.target.value))}
            className="q-slider"
            style={{
              background: `linear-gradient(to right, var(--accent) ${((profile.line_quality_value ?? 50) / 100) * 100}%, var(--line) ${((profile.line_quality_value ?? 50) / 100) * 100}%)`,
            }}
          />
          <div className="flex justify-between text-[10px] mt-1" style={{ opacity: 0.6 }}>
            <span>偏直线</span>
            <span>偏曲线</span>
          </div>
        </div>
      </section>

      {/* 身高体重与围度(选填,填了才有 BMI/体型数字与合身层) */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">身高体重与围度（选填）</div>
        <div className={`grid ${gap} grid-cols-2`}>
          <div className="min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              身高
            </div>
            <input
              type="number"
              placeholder="cm，如 165"
              className="form-input"
              value={profile.height ?? ''}
              onChange={(e) =>
                update('height', e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              体重
            </div>
            <input
              type="number"
              placeholder="kg，如 55"
              className="form-input"
              value={profile.weight ?? ''}
              onChange={(e) =>
                update('weight', e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              净胸围
            </div>
            <input
              type="number"
              placeholder="cm，如 92"
              className="form-input"
              value={profile.bust ?? ''}
              onChange={(e) => update('bust', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              净腰围
            </div>
            <input
              type="number"
              placeholder="cm，如 84"
              className="form-input"
              value={profile.waist ?? ''}
              onChange={(e) => update('waist', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              肩宽
            </div>
            <input
              type="number"
              placeholder="cm，如 39"
              className="form-input"
              value={profile.shoulder ?? ''}
              onChange={(e) =>
                update('shoulder', e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          围度量的是身体不是衣服：软尺水平绕一圈、贴皮不勒，取呼气末的数。净胸围过胸部最丰满处，
          净腰围在胯骨上端与肋骨下缘之间那条腰际线上绕一周（一般在肚脐上方一两指，别往下拉到肚脐，位置低了会把体型档判错），
          肩宽量两侧肩峰点之间的直线距离（需两人配合，从背面量）。
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          身高与净胸围决定上衣的号型与该买到的胸围，缺了这两格，「合身」那一段只会显示请先量；
          净腰围用来定 Y/A/B/C 分档。不填系统不会替你猜一个数。
        </div>
      </section>

      {/* 场景 */}
      <section
        className={sectionClass}
        style={{
          borderBottom: '1px solid var(--line)',
          paddingBottom: '14px',
          marginBottom: '14px',
        }}
      >
        <div className="section-title">穿着场景</div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {SCENARIO_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('scenario', opt.value)}
              className={`opt-btn ${profile.scenario === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center', padding: '8px 4px' }}
            >
              <div className="text-base">{opt.icon}</div>
              <div className="text-[10px] mt-0.5">{opt.label}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 提交按钮 */}
      <section style={{ marginTop: '16px' }}>
        <button
          onClick={handleSubmit}
          disabled={!profile.gender || submitting}
          className="gradient-btn w-full py-2.5 text-sm"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
              生成中...
            </span>
          ) : (
            '✨ 生成形象建议'
          )}
        </button>
      </section>
    </div>
  )
}

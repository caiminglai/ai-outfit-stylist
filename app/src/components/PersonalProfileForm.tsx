import { useState } from 'react'
import type { CustomerProfile } from '../types'
import { ProfileStepFields } from './profile/ProfileStepFields'

/**
 * 个人形象分析表单 - 深色科技风（50+ 维度）
 *
 * 使用 .opt-btn / .section-title / .gradient-btn 等深色主题组件类
 * 配色：var(--bg) 背景 + var(--accent) 青绿强调
 */

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

/** 档案 → 表单初始值(挂载时铺一次,晚到的档案再按同一口径铺一次) */
function fromInitial(initial?: Partial<CustomerProfile>): CustomerProfile {
  return {
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
    skin_lightness: initial?.skin_lightness,
    color_chroma: initial?.color_chroma,
    face_shape: initial?.face_shape,
    body_type_detail: initial?.body_type_detail,
    shoulder_type: initial?.shoulder_type,
    frame_size: initial?.frame_size,
    frame_size_value: initial?.frame_size_value,
    line_quality: initial?.line_quality,
    line_quality_value: initial?.line_quality_value,
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
  }
}

export default function PersonalProfileForm({
  initial,
  onSubmit,
  onChange,
  submitting,
  compact,
}: PersonalProfileFormProps) {
  // 没动过表单 ⇒ 界面直接跟着档案(含草稿)走。档案是在"选择模式"那一屏异步读的,他点得快时
  // 表单已经挂载、档案还没回;老代码只在挂载那一刻读一次 initial,晚到的那份就静默丢了。
  // 派生而不是 useEffect:不用 effect 就没级联渲染,也不会覆盖他正在打的字,也不会顺手多存一份草稿
  const [override, setOverride] = useState<CustomerProfile | null>(null)
  const profile = override ?? fromInitial(initial)

  const update = (key: keyof CustomerProfile, value: unknown) => {
    // setOverride 与 onChange 必须发同一个对象:老代码 setProfile 走 prev(functional)、
    // onChange 走 render 闭包里的 profile,两者在"父组件这拍又渲染了一次"或"同一拍连着改两个字段"时
    // 会分叉 ⇒ onChange 交出去的那份缺了刚改的字段,1.5s 防抖后写进草稿的就是丢字段的版本。
    // 这里一次算好 next,两边都用它,保证界面状态、上抛 payload、落库草稿三者一致。
    const next = { ...profile, [key]: value }
    setOverride(next)
    onChange?.(next)
  }

  /**
   * 一次改多个字段。⚠️ 需要它是因为上面那个 `update` 读的是 render 闭包里的 `profile`：
   * 同一拍连着调三次 `update`，每次都从同一份旧 `profile` 起步 ⇒ 只有最后一次活下来，
   * 而且 `onChange` 交出去的两份 payload 也各缺一个字段（草稿会存成缺字段的版本）。
   */
  const updateMany = (patch: Partial<CustomerProfile>) => {
    const next = { ...profile, ...patch }
    setOverride(next)
    onChange?.(next)
  }

  const handleSubmit = () => {
    if (!profile.gender) return
    onSubmit(profile)
  }

  return (
    <div className="space-y-1">
      <ProfileStepFields
        profile={profile}
        onUpdate={update}
        onUpdateMany={updateMany}
        onClearBirthDate={() => updateMany({ birth_date: '', birth_hour: '' })}
        compact={compact}
      />

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

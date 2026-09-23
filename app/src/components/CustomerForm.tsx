import { useState } from 'react';
import type { CustomerProfile } from '../types';

/**
 * 顾客数据收集表单 - 深色科技风
 *
 * 使用 .opt-btn / .section-title 等深色主题组件类
 * 配色：var(--bg) 背景 + var(--accent) 青绿强调
 */

const GENDER_OPTIONS = [
  { value: '女', label: '女', icon: '👩' },
  { value: '男', label: '男', icon: '👨' },
] as const;

const SKIN_TONE_OPTIONS = [
  { value: '暖皮', label: '暖皮', desc: '偏黄暖色调' },
  { value: '冷皮', label: '冷皮', desc: '偏粉冷色调' },
  { value: '自然', label: '自然', desc: '中性肤色' },
] as const;

const FACE_SHAPE_OPTIONS = [
  { value: '圆脸', label: '圆脸', icon: '⭕' },
  { value: '方脸', label: '方脸', icon: '⬜' },
  { value: '心形脸', label: '心形脸', icon: '❤️' },
  { value: '椭圆脸', label: '椭圆脸', icon: '🥚' },
  { value: '长脸', label: '长脸', icon: '▯' },
] as const;

const BODY_TYPE_OPTIONS = [
  { value: '标准', label: '标准' },
  { value: '偏瘦', label: '偏瘦' },
  { value: '偏胖', label: '偏胖' },
  { value: '梨形', label: '梨形' },
  { value: '苹果形', label: '苹果形' },
] as const;

const AGE_RANGE_OPTIONS = [
  { value: '18-25', label: '18-25' },
  { value: '26-35', label: '26-35' },
  { value: '36-45', label: '36-45' },
  { value: '46+', label: '46+' },
] as const;

/** 值与规则库 region 条件取值一一对应(门店规则 6 组按南北分档) */
const REGION_OPTIONS = [
  { value: '北方', label: '北方', desc: '干冷、层级穿搭多' },
  { value: '南方', label: '南方', desc: '湿润、轻薄通透' },
] as const;

const SCENARIO_OPTIONS = [
  { value: '通勤', label: '通勤', icon: '💼' },
  { value: '约会', label: '约会', icon: '💕' },
  { value: '面试', label: '面试', icon: '📋' },
  { value: '休闲', label: '休闲', icon: '☕' },
  { value: '聚会', label: '聚会', icon: '🎉' },
] as const;

interface CustomerFormProps {
  initial?: Partial<CustomerProfile>;
  onSubmit: (profile: CustomerProfile) => void;
  submitting?: boolean;
  compact?: boolean;
}

export default function CustomerForm({ initial, onSubmit, submitting, compact }: CustomerFormProps) {
  const [profile, setProfile] = useState<CustomerProfile>({
    nickname: initial?.nickname || '',
    gender: initial?.gender,
    age_range: initial?.age_range,
    region: initial?.region,
    height: initial?.height,
    weight: initial?.weight,
    skin_tone: initial?.skin_tone,
    face_shape: initial?.face_shape,
    body_type: initial?.body_type,
    scenario: initial?.scenario || '通勤',
  });

  const update = (key: keyof CustomerProfile, value: CustomerProfile[keyof CustomerProfile]) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    if (!profile.gender) return;
    onSubmit(profile);
  };

  const gap = compact ? 'gap-2' : 'gap-3';
  const sectionClass = compact ? 'mb-4' : 'mb-5';

  return (
    <div className="space-y-1">
      {/* 昵称 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">昵称</div>
        <input
          type="text"
          value={profile.nickname || ''}
          onChange={(e) => update('nickname', e.target.value)}
          placeholder="请输入您的昵称"
          className="opt-btn w-full"
          style={{ padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: '8px', fontSize: '13px' }}
        />
      </section>

      {/* 性别 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">性别</div>
        <div className={`flex ${gap}`}>
          {GENDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => update('gender', opt.value)}
              className={`opt-btn flex-1 ${profile.gender === opt.value ? 'active' : ''}`}
              style={{ padding: '8px 10px' }}
            >
              <span className="mr-1">{opt.icon}</span>{opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 年龄段 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">年龄段</div>
        <div className={`grid grid-cols-4 ${gap}`}>
          {AGE_RANGE_OPTIONS.map(opt => (
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
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">常居地区</div>
        <div className={`flex ${gap}`}>
          {REGION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => update('region', opt.value)}
              className={`opt-btn flex-1 ${profile.region === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center' }}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              {!compact && <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>{opt.desc}</div>}
            </button>
          ))}
        </div>
      </section>

      {/* 肤色 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">肤色基调</div>
        <div className={`flex ${gap}`}>
          {SKIN_TONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => update('skin_tone', opt.value)}
              className={`opt-btn flex-1 ${profile.skin_tone === opt.value ? 'active' : ''}`}
              style={{ textAlign: 'center' }}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              {!compact && <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>{opt.desc}</div>}
            </button>
          ))}
        </div>
      </section>

      {/* 脸型 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">脸型</div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {FACE_SHAPE_OPTIONS.map(opt => (
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
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">体型</div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {BODY_TYPE_OPTIONS.map(opt => (
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
      </section>

      {/* 身高体重(选填,填了才有 BMI/体型数字) */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">身高体重（选填）</div>
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>身高</div>
            <input
              type="number"
              placeholder="cm，如 165"
              className="form-input"
              value={profile.height ?? ''}
              onChange={(e) => update('height', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>体重</div>
            <input
              type="number"
              placeholder="kg，如 55"
              className="form-input"
              value={profile.weight ?? ''}
              onChange={(e) => update('weight', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        </div>
      </section>

      {/* 场景 */}
      <section className={sectionClass} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '14px' }}>
        <div className="section-title">穿着场景</div>
        <div className={`grid grid-cols-5 ${gap}`}>
          {SCENARIO_OPTIONS.map(opt => (
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
          ) : '✨ 生成形象建议'}
        </button>
      </section>
    </div>
  );
}

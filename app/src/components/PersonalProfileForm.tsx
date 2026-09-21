import { useState } from 'react';
import type { CustomerProfile } from '../types';

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
] as const;

const AGE_RANGE_OPTIONS = [
  { value: '18-25', label: '18-25' },
  { value: '26-35', label: '26-35' },
  { value: '36-45', label: '36-45' },
  { value: '46+', label: '46+' },
] as const;

const HEIGHT_RANGE_OPTIONS = [
  { value: '150-160', label: '150-160' },
  { value: '160-170', label: '160-170' },
  { value: '170-180', label: '170-180' },
  { value: '180+', label: '180+' },
] as const;

const SKIN_TONE_DETAIL_OPTIONS = [
  { value: '白皙', label: '白皙' },
  { value: '自然白', label: '自然白' },
  { value: '偏黄', label: '偏黄' },
  { value: '小麦色', label: '小麦色' },
  { value: '古铜色', label: '古铜色' },
] as const;

const FACE_SHAPE_OPTIONS = [
  { value: '圆脸', label: '圆脸', icon: '⭕' },
  { value: '方脸', label: '方脸', icon: '⬜' },
  { value: '心形脸', label: '心形脸', icon: '❤️' },
  { value: '椭圆脸', label: '椭圆脸', icon: '🥚' },
  { value: '长脸', label: '长脸', icon: '▯' },
] as const;

const BODY_TYPE_DETAIL_OPTIONS = [
  { value: '沙漏型', label: '沙漏型', icon: '⌛' },
  { value: '梨形', label: '梨形', icon: '🍐' },
  { value: '苹果型', label: '苹果型', icon: '🍎' },
  { value: '直筒型', label: '直筒型', icon: '📏' },
  { value: '倒三角型', label: '倒三角型', icon: '🔻' },
] as const;

const SHOULDER_TYPE_OPTIONS = [
  { value: '窄肩', label: '窄肩' },
  { value: '标准肩', label: '标准肩' },
  { value: '宽肩', label: '宽肩' },
] as const;

const NECK_LENGTH_OPTIONS = [
  { value: '短', label: '短' },
  { value: '中', label: '中' },
  { value: '长', label: '长' },
] as const;

const EYE_SIZE_OPTIONS = [
  { value: '大', label: '大' },
  { value: '中', label: '中' },
  { value: '小', label: '小' },
] as const;

const EYE_SHAPE_OPTIONS = [
  { value: '圆眼', label: '圆眼' },
  { value: '杏眼', label: '杏眼' },
  { value: '丹凤眼', label: '丹凤眼' },
  { value: '下垂眼', label: '下垂眼' },
] as const;

const NOSE_HEIGHT_OPTIONS = [
  { value: '高', label: '高' },
  { value: '中', label: '中' },
  { value: '低', label: '低' },
] as const;

const LIP_THICKNESS_OPTIONS = [
  { value: '厚', label: '厚' },
  { value: '中', label: '中' },
  { value: '薄', label: '薄' },
] as const;

const PREFERRED_STYLE_OPTIONS = [
  { value: '甜美风', label: '甜美风' },
  { value: '知性优雅', label: '知性优雅' },
  { value: '休闲运动', label: '休闲运动' },
  { value: '街头潮流', label: '街头潮流' },
  { value: '复古风', label: '复古风' },
  { value: '职场OL', label: '职场OL' },
  { value: '日系清新', label: '日系清新' },
  { value: '韩系时尚', label: '韩系时尚' },
] as const;

const OCCASION_OPTIONS = [
  { value: '上班通勤', label: '上班通勤' },
  { value: '校园日常', label: '校园日常' },
  { value: '居家休闲', label: '居家休闲' },
  { value: '约会聚会', label: '约会聚会' },
  { value: '商务正式', label: '商务正式' },
  { value: '运动健身', label: '运动健身' },
  { value: '婚礼宴会', label: '婚礼宴会' },
] as const;

const MAIN_GOAL_OPTIONS = [
  { value: '脸型修饰', label: '脸型修饰' },
  { value: '发型改造', label: '发型改造' },
  { value: '身材比例', label: '身材比例' },
  { value: '穿搭提升', label: '穿搭提升' },
  { value: '妆容优化', label: '妆容优化' },
  { value: '肤色改善', label: '肤色改善' },
] as const;

const HEIGHT_WISH_OPTIONS = [
  { value: '想显高', label: '想显高' },
  { value: '保持就好', label: '保持就好' },
] as const;

const WEIGHT_WISH_OPTIONS = [
  { value: '想显瘦', label: '想显瘦' },
  { value: '想丰满一些', label: '想丰满一些' },
  { value: '保持就好', label: '保持就好' },
] as const;

const POSTURE_OPTIONS = [
  { value: '圆肩', label: '圆肩' },
  { value: '驼背', label: '驼背' },
  { value: '骨盆前倾', label: '骨盆前倾' },
  { value: '高低肩', label: '高低肩' },
  { value: '无', label: '无' },
] as const;

const SEASON_OPTIONS = [
  { value: '春', label: '春' },
  { value: '夏', label: '夏' },
  { value: '秋', label: '秋' },
  { value: '冬', label: '冬' },
] as const;

const REGION_OPTIONS = [
  { value: '北方', label: '北方（寒冷干燥）', icon: '❄️' },
  { value: '南方', label: '南方（温暖潮湿）', icon: '🌧️' },
] as const;

const BUDGET_OPTIONS = [
  { value: '平价', label: '平价' },
  { value: '中档', label: '中档' },
  { value: '高端', label: '高端' },
] as const;

const SKIN_TYPE_OPTIONS = [
  { value: '干皮', label: '干皮' },
  { value: '油皮', label: '油皮' },
  { value: '混合', label: '混合' },
  { value: '敏感', label: '敏感' },
] as const;

/* ── Props ── */

interface PersonalProfileFormProps {
  initial?: Partial<CustomerProfile>;
  onSubmit: (profile: CustomerProfile) => void;
  submitting?: boolean;
  compact?: boolean;
}

/* ── 组件 ── */

export default function PersonalProfileForm({
  initial,
  onSubmit,
  submitting,
  compact,
}: PersonalProfileFormProps) {
  const [profile, setProfile] = useState<CustomerProfile>({
    nickname: initial?.nickname || '',
    gender: initial?.gender,
    age_range: initial?.age_range,
    height_range: initial?.height_range,
    region: initial?.region,
    weight: initial?.weight,
    skin_tone_detail: initial?.skin_tone_detail,
    face_shape: initial?.face_shape,
    body_type_detail: initial?.body_type_detail,
    shoulder_type: initial?.shoulder_type,
    neck_length: initial?.neck_length,
    eye_size: initial?.eye_size,
    eye_shape: initial?.eye_shape,
    nose_height: initial?.nose_height,
    lip_thickness: initial?.lip_thickness,
    preferred_style: initial?.preferred_style,
    occasion: initial?.occasion,
    main_goal: initial?.main_goal,
    height_wish: initial?.height_wish,
    weight_wish: initial?.weight_wish,
    posture: initial?.posture,
    season: initial?.season,
    budget: initial?.budget,
    skin_type: initial?.skin_type,
    allergy_metal: initial?.allergy_metal,
  });

  const update = (key: keyof CustomerProfile, value: unknown) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    if (!profile.gender) return;
    onSubmit(profile);
  };

  const gap = compact ? 'gap-2' : 'gap-3';
  const sectionClass = compact ? 'mb-4' : 'mb-5';
  const sectionStyle = {
    borderBottom: '1px solid var(--line)',
    paddingBottom: compact ? '10px' : '14px',
    marginBottom: compact ? '10px' : '14px',
  };
  const optBtnPad = compact
    ? { padding: '6px 8px', fontSize: '11px' }
    : { padding: '8px 10px', fontSize: '12px' };

  const requiredStar = <span style={{ color: 'var(--danger)', marginLeft: '2px' }}>*</span>;

  /* ── 渲染辅助 ── */

  function renderOptBtns<T extends string>(
    options: ReadonlyArray<{ value: T; label: string; icon?: string; }>,
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
    );
  }

  return (
    <div className="space-y-1">
      {/* ── 分区1: 基本信息 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">
          基本信息{requiredStar}
        </div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          昵称
        </div>
        <input
          type="text"
          value={profile.nickname || ''}
          onChange={(e) => update('nickname', e.target.value)}
          placeholder="请输入您的昵称"
          className="opt-btn w-full mb-4"
          style={{ padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: '8px', fontSize: '13px' }}
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

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          年龄段
        </div>
        {renderOptBtns(AGE_RANGE_OPTIONS, 'age_range', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          身高范围
        </div>
        {renderOptBtns(HEIGHT_RANGE_OPTIONS, 'height_range', 'grid-cols-4')}

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

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          体重
        </div>
        <input
          type="number"
          placeholder="请输入体重(kg)"
          className="form-input"
          value={profile.weight ?? ''}
          onChange={(e) => update('weight', e.target.value ? Number(e.target.value) : undefined)}
        />
      </section>

      {/* ── 分区2: 肤色与脸型 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">
          肤色与脸型{requiredStar}
        </div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          肤色细分
        </div>
        {renderOptBtns(SKIN_TONE_DETAIL_OPTIONS, 'skin_tone_detail', 'grid-cols-5')}

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
        <div className="section-title">
          体型分析{requiredStar}
        </div>

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
          颈长
        </div>
        {renderOptBtns(NECK_LENGTH_OPTIONS, 'neck_length')}
      </section>

      {/* ── 分区4: 五官细节 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">
          五官细节{requiredStar}
        </div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          眼大小
        </div>
        {renderOptBtns(EYE_SIZE_OPTIONS, 'eye_size')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          眼型
        </div>
        {renderOptBtns(EYE_SHAPE_OPTIONS, 'eye_shape', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          鼻梁
        </div>
        {renderOptBtns(NOSE_HEIGHT_OPTIONS, 'nose_height')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          唇厚
        </div>
        {renderOptBtns(LIP_THICKNESS_OPTIONS, 'lip_thickness')}
      </section>

      {/* ── 分区5: 风格偏好 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">
          风格偏好{requiredStar}
        </div>

        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          风格偏好
        </div>
        {renderOptBtns(PREFERRED_STYLE_OPTIONS, 'preferred_style', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          主要场合
        </div>
        {renderOptBtns(OCCASION_OPTIONS, 'occasion', 'grid-cols-4')}

        <div className="text-xs mb-2 mt-4" style={{ color: 'var(--muted)' }}>
          主要目标
        </div>
        {renderOptBtns(MAIN_GOAL_OPTIONS, 'main_goal', 'grid-cols-3')}
      </section>

      {/* ── 分区6: 改善目标 ── */}
      <section className={sectionClass} style={sectionStyle}>
        <div className="section-title">
          改善目标{requiredStar}
        </div>

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
        <div className="section-title">
          其他偏好{requiredStar}
        </div>

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
  );
}

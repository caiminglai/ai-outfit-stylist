/**
 * 规则浏览器组件
 *
 * 让普通人看懂规则引擎:展示所有启用的规则,每条规则带中文人话解释,
 * 用户能理解"我填什么档案能匹配到什么规则".
 *
 * 数据来源:后端 /api/rules/browse(无需登录),返回的匹配条件已是中文,
 * 如 ['性别:女', '脸型 属于 圆脸、方脸'],直接展示即可.
 *
 * 支持筛选:类别(穿搭/妆容/发型/配饰)、性别、场景,帮助用户聚焦相关规则.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { browseRules } from '../api';
import type { RuleBrowseItem, RuleBrowseQuery } from '../types';

interface RuleBrowserProps {
  /** 初始模式:store(门店)/personal(个人),默认 store */
  initialMode?: 'store' | 'personal';
  /** 初始类别筛选,如 '穿搭' */
  initialCategory?: string;
  /** 紧凑模式(窄屏隐藏部分说明文字) */
  compact?: boolean;
}

/** 类别筛选选项 */
const CATEGORY_OPTIONS = [
  { value: '', label: '全部类别' },
  { value: '穿搭', label: '👗 穿搭' },
  { value: '妆容', label: '💄 妆容' },
  { value: '发型', label: '💇 发型' },
  { value: '配饰', label: '💎 配饰' },
] as const;

/** 性别筛选选项 */
const GENDER_OPTIONS = [
  { value: '', label: '全部性别' },
  { value: '女', label: '女' },
  { value: '男', label: '男' },
] as const;

/** 场景筛选选项 */
const SCENARIO_OPTIONS = [
  { value: '', label: '全部场景' },
  { value: '通勤', label: '通勤' },
  { value: '约会', label: '约会' },
  { value: '面试', label: '面试' },
  { value: '休闲', label: '休闲' },
  { value: '聚会', label: '聚会' },
] as const;

/** 类别对应的主题色(与 Tab 配色一致) */
const CATEGORY_THEME: Record<string, { color: string; bg: string }> = {
  穿搭: { color: '#8ef5d8', bg: 'rgba(110, 231, 199, 0.12)' },
  妆容: { color: '#f9a8d4', bg: 'rgba(244, 114, 182, 0.12)' },
  发型: { color: '#c4b5fd', bg: 'rgba(167, 139, 250, 0.12)' },
  配饰: { color: '#fcd34d', bg: 'rgba(251, 191, 36, 0.12)' },
  姿势: { color: '#93c5fd', bg: 'rgba(96, 165, 250, 0.12)' },
};

export default function RuleBrowser({
  initialMode = 'store',
  initialCategory = '',
  compact = false,
}: RuleBrowserProps) {
  // 筛选状态
  const [category, setCategory] = useState<string>(initialCategory);
  const [gender, setGender] = useState<string>('');
  const [scenario, setScenario] = useState<string>('');

  // 数据状态
  const [rules, setRules] = useState<RuleBrowseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 加载规则数据(筛选变化时触发) */
  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: RuleBrowseQuery = { mode: initialMode };
      if (category) query.category = category;
      if (gender) query.gender = gender;
      if (scenario) query.scenario = scenario;
      const data = await browseRules(query);
      setRules(data.rules ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载规则失败');
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [initialMode, category, gender, scenario]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  /** 按类别分组(类别为空时归到 '其他'),便于分区展示 */
  const groupedRules = useMemo(() => {
    const groups: Record<string, RuleBrowseItem[]> = {};
    for (const rule of rules) {
      const key = rule.推荐类别 || '其他';
      (groups[key] ||= []).push(rule);
    }
    return groups;
  }, [rules]);

  /** 类别顺序:穿搭 → 妆容 → 发型 → 配饰 → 其他 */
  const categoryOrder = ['穿搭', '妆容', '发型', '配饰', '姿势', '其他'];
  const sortedCategories = Object.keys(groupedRules).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
  );

  return (
    <div className="space-y-3">
      {/* 顶部说明:告诉用户这里能看到什么 */}
      {!compact && (
        <div className="glass-card p-3 text-xs" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
          <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent)' }}>
            <span>💡</span>
            <span className="font-medium">这是什么?</span>
          </div>
          下面是系统内置的形象建议规则.每条规则列出了<strong style={{ color: 'var(--text)' }}>匹配条件</strong>_
          也就是你填档案时填的性别、肤色、脸型、体型等.当你的档案满足某条规则的所有条件,系统就会推荐对应建议.
          你可以筛选查看,提前了解"填什么能匹配到什么".
        </div>
      )}

      {/* 筛选区 */}
      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="filter-select"
          aria-label="筛选类别"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="filter-select"
          aria-label="筛选性别"
        >
          {GENDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          className="filter-select"
          aria-label="筛选场景"
        >
          {SCENARIO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {/* 结果计数 */}
        <span className="text-[11px] flex items-center" style={{ color: 'var(--muted)' }}>
          共 {rules.length} 条规则
        </span>
      </div>

      {/* 加载中 */}
      {loading && (
        <div className="text-center py-6" style={{ color: 'var(--muted)' }}>
          <div className="spinner mx-auto mb-2"></div>
          加载规则中...
        </div>
      )}

      {/* 错误提示 */}
      {error && !loading && (
        <div className="glass-card p-4 text-center text-sm" style={{ color: 'var(--danger)' }}>
          <div className="mb-2">⚠️ {error}</div>
          <button onClick={loadRules} className="ghost-btn text-xs px-3 py-1">重试</button>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && rules.length === 0 && (
        <div className="glass-card p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          <div className="text-2xl mb-2">🔍</div>
          没有匹配的规则.试试调整筛选条件,或选择"全部".
        </div>
      )}

      {/* 规则列表:按类别分组展示 */}
      {!loading && !error && sortedCategories.map((cat) => {
        const theme = CATEGORY_THEME[cat] || { color: 'var(--accent)', bg: 'rgba(110, 231, 199, 0.08)' };
        const items = groupedRules[cat];
        return (
          <div key={cat} className="space-y-2">
            {/* 类别标题 */}
            <div className="flex items-center gap-2 pt-1">
              <span
                className="pill-tag text-xs font-medium"
                style={{ color: theme.color, borderColor: theme.color, background: theme.bg }}
              >
                {cat}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{items.length} 条</span>
            </div>
            {/* 该类别的规则卡片 */}
            {items.map((rule) => (
              <RuleCard key={rule.id} rule={rule} theme={theme} compact={compact} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ============ 单条规则卡片 ============

interface RuleCardProps {
  rule: RuleBrowseItem;
  theme: { color: string; bg: string };
  compact: boolean;
}

/** 单条规则卡片:展示规则名称、匹配条件、适用范围、规则说明 */
function RuleCard({ rule, theme, compact }: RuleCardProps) {
  // 适用范围标签:场景 + 性别,null 表示不限
  const scopeTags: string[] = [];
  if (rule.适用场景) scopeTags.push(`场景:${rule.适用场景}`);
  if (rule.适用性别) scopeTags.push(`${rule.适用性别}士`);
  // 优先级标签:优先级 ≥ 5 标记为"高优先"
  const isHighPriority = rule.优先级 >= 5;

  return (
    <div className="glass-card p-3 transition-transform hover:scale-[1.005]">
      {/* 标题行:规则名 + 优先级 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>
          {rule.规则名称 || `规则 #${rule.id}`}
        </div>
        {isHighPriority && (
          <span
            className="pill-tag text-[10px] flex-shrink-0"
            style={{ color: 'var(--warning)', borderColor: 'var(--warning)', background: 'rgba(251, 191, 36, 0.1)' }}
          >
            ★ 高优先
          </span>
        )}
      </div>

      {/* 匹配条件:核心信息,告诉用户"填什么能命中这条规则" */}
      <div className="mb-2">
        <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>匹配条件(满足全部即推荐):</div>
        {rule.匹配条件.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {rule.匹配条件.map((cond, i) => (
              <span
                key={i}
                className="pill-tag text-[11px]"
                style={{ color: theme.color, borderColor: theme.color, background: theme.bg }}
              >
                {cond}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>无条件限制(默认推荐)</span>
        )}
      </div>

      {/* 适用范围 */}
      {scopeTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {scopeTags.map((tag, i) => (
            <span key={i} className="text-[10px]" style={{ color: 'var(--muted)' }}>· {tag}</span>
          ))}
        </div>
      )}

      {/* 规则说明(管理员填的描述),紧凑模式下隐藏 */}
      {!compact && rule.规则说明 && (
        <div className="text-[11px] mt-2 pt-2" style={{ color: 'var(--muted)', borderTop: '1px dashed var(--line)' }}>
          📝 {rule.规则说明}
        </div>
      )}
    </div>
  );
}

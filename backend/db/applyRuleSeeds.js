/**
 * 增量应用「带来源标记」的规则种子
 *
 * 为什么不走 seed.js：seed.js 是全删再全建，一删就把门店在后台手工加过、关过的规则一起清掉，
 * 而且顾客点过一次反馈之后 rule_groups 就有外键引用，整笔重建会直接报外键约束失败。
 * 所以新规则一律走这里：库里没有这条 key 才插，已存在的一律不动（后台改的优先级、关掉的开关都保留）。
 *
 * 种子文件约定（db/seed/rules-*.json）：
 *   { "rules": [ { "key": "唯一且不再改的英文标识", "name": "...", "mode": "all|store|personal",
 *                  "category": "穿搭|妆容|发型|配饰|姿势", "gender": null, "scenario": null,
 *                  "priority": 22, "enabled": 1, "description": "依据 + 档位说明",
 *                  "conditions": [{ "field": "...", "operator": "eq|in|ne", "value": "...", "weight": 3 }],
 *                  "actions": [{ "type": "...", "content": "..." }] } ] }
 *
 * 校验不合格的规则不入库：条件字段不在 FIELD_LABELS 里 = 这条规则永远命中不了，
 * 与其留一条死规则在库里，不如当场报出来。
 */

const fs = require('fs')
const path = require('path')
const { FIELD_LABELS, ACTION_LABELS } = require('../services/ruleExplainer')
const { evidenceOf } = require('../services/evidenceLevels')

const SEED_DIR = path.join(__dirname, 'seed')
const SEED_FILE_RE = /^rules-.*\.json$/
const VALID_OPERATORS = ['eq', 'in', 'ne']
const CATEGORY_CN = ['穿搭', '妆容', '发型', '配饰', '姿势']
const VALID_MODES = ['all', 'store', 'personal']

/** 把「偏短,标准」这类写法切成数组（与后台写入端 rules.js 的 splitList 同口径） */
function splitList(value) {
  return String(value)
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 归一化一条条件的存库值
 * 引擎取匹配值时认 {"<field>": ...} 这个形状，与后台新增条件的写法保持一致，
 * 这样这条规则以后在后台被编辑不会被写歪。
 * @returns {{value: string} | {error: string}}
 */
function normalizeCondition(cond) {
  const field = String(cond.field || '').trim()
  const operator = String(cond.operator || 'eq').trim()
  if (!FIELD_LABELS[field]) {
    return { error: `条件字段无效: ${field || '(空)'}` }
  }
  if (!VALID_OPERATORS.includes(operator)) {
    return { error: `条件操作符无效: ${operator}(只能用 ${VALID_OPERATORS.join('/')})` }
  }
  let value = cond.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = field in value ? value[field] : Object.values(value)[0]
  }
  if (value === null || value === undefined || String(value).trim() === '') {
    value = 'all'
  }
  const stored =
    operator === 'in'
      ? { [field]: Array.isArray(value) ? value : splitList(value) }
      : { [field]: Array.isArray(value) ? value.join('、') : String(value).trim() }
  if (operator === 'in' && stored[field].length === 0) {
    return { error: `条件「属于」缺少候选值: ${field}` }
  }
  const weight = Number(cond.weight) > 0 ? Number(cond.weight) : 3
  return { value: JSON.stringify(stored), weight }
}

/** 校验一条动作：动作类型必须有中文标签，否则前端会直接把英文键显示给顾客 */
function normalizeAction(action, idx) {
  const type = String(action.type || action.action_type || '').trim()
  const content = String(action.content || '').trim()
  if (!ACTION_LABELS[type]) {
    return { error: `第 ${idx + 1} 条动作类型没有中文标签: ${type || '(空)'}` }
  }
  if (!content) {
    return { error: `第 ${idx + 1} 条动作内容为空: ${type}` }
  }
  return { type, content }
}

/** 校验规则组的骨架，返回错误列表（空数组=合格） */
function validateGroup(rule) {
  const errors = []
  if (!rule.key || !String(rule.key).trim()) errors.push('缺少 key')
  if (!rule.name || !String(rule.name).trim()) errors.push('缺少 name')
  if (!CATEGORY_CN.includes(rule.category)) {
    errors.push(`category 只能是 ${CATEGORY_CN.join('/')}(当前: ${rule.category})`)
  }
  if (!VALID_MODES.includes(rule.mode)) {
    errors.push(`mode 只能是 ${VALID_MODES.join('/')}(当前: ${rule.mode})`)
  }
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) errors.push('至少要有 1 条动作')
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    errors.push('至少要有 1 条条件(无条件=所有人命中,会淹没现有规则)')
  }
  if (rule.gender !== null && rule.gender !== undefined && !['男', '女'].includes(rule.gender)) {
    errors.push(`gender 只能是 男/女/留空(当前: ${rule.gender})`)
  }
  return errors
}

/**
 * 应用种子目录里所有 rules-*.json
 * @param {import('better-sqlite3').Database} db
 * @returns {{inserted: number, existing: number, rejected: string[], checked: number}}
 */
function applyRuleSeeds(db) {
  const stat = { inserted: 0, existing: 0, rejected: [], checked: 0 }

  const files = fs
    .readdirSync(SEED_DIR)
    .filter((f) => SEED_FILE_RE.test(f))
    .sort()
  if (files.length === 0) return stat

  const findKey = db.prepare('SELECT id FROM rule_groups WHERE source_key = ?')
  const insertGroup = db.prepare(`
    INSERT INTO rule_groups (name, mode, gender, category, scenario, region, age_range,
                             description, priority, enabled, source_key, evidence_level)
    VALUES (@name, @mode, @gender, @category, @scenario, @region, @age_range,
            @description, @priority, @enabled, @source_key, @evidence_level)
  `)
  const insertCondition = db.prepare(
    'INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, ?, ?, ?, ?)',
  )
  const insertAction = db.prepare(
    'INSERT INTO rule_actions (group_id, action_type, content, sort_order) VALUES (?, ?, ?, ?)',
  )

  for (const file of files) {
    let data
    try {
      data = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf-8'))
    } catch (err) {
      stat.rejected.push(`${file}: JSON 解析失败 ${err.message}`)
      continue
    }
    const rules = Array.isArray(data.rules) ? data.rules : []

    for (const rule of rules) {
      stat.checked++
      const errors = validateGroup(rule)
      if (errors.length === 0) {
        for (const cond of rule.conditions) {
          const n = normalizeCondition(cond)
          if (n.error) {
            errors.push(n.error)
            break
          }
        }
      }
      if (errors.length === 0) {
        for (const [idx, action] of rule.actions.entries()) {
          const n = normalizeAction(action, idx)
          if (n.error) {
            errors.push(n.error)
            break
          }
        }
      }
      if (errors.length > 0) {
        stat.rejected.push(`${rule.key || rule.name || '(无 key)'}: ${errors.join('; ')}`)
        continue
      }

      if (findKey.get(rule.key)) {
        stat.existing++
        continue
      }

      const label = `${file} → ${rule.key}`
      try {
        db.transaction(() => {
          const info = insertGroup.run({
            name: String(rule.name).trim(),
            mode: rule.mode,
            gender: rule.gender ?? null,
            category: rule.category,
            scenario: rule.scenario ?? null,
            region: rule.region ?? null,
            age_range: rule.age_range ?? null,
            description: rule.description || '',
            priority: Number.isFinite(rule.priority) ? rule.priority : 5,
            enabled: rule.enabled === 0 ? 0 : 1,
            source_key: String(rule.key).trim(),
            evidence_level: evidenceOf(rule.key) || null,
          })
          const groupId = info.lastInsertRowid
          for (const cond of rule.conditions) {
            const n = normalizeCondition(cond)
            if (n.error) throw new Error(n.error)
            insertCondition.run(
              groupId,
              cond.field.trim(),
              cond.operator || 'eq',
              n.value,
              n.weight,
            )
          }
          rule.actions.forEach((action, idx) => {
            const n = normalizeAction(action, idx)
            insertAction.run(groupId, n.type, n.content, idx)
          })
        })()
        stat.inserted++
      } catch (err) {
        stat.rejected.push(`${label}: 写入失败 ${err.message}`)
      }
    }
  }

  // 依据分档回填：只补"有 source_key 但还没档位"的老种子行（本次加列之前插进去的那批）。
  // 后台手工建的规则 source_key 为 NULL，永远不会被这里碰到；已在后台改过档位的也不覆盖。
  try {
    const pending = db
      .prepare('SELECT id, source_key FROM rule_groups WHERE evidence_level IS NULL AND source_key IS NOT NULL')
      .all()
    const setLevel = db.prepare('UPDATE rule_groups SET evidence_level = ? WHERE id = ?')
    let filled = 0
    for (const row of pending) {
      const level = evidenceOf(row.source_key)
      if (!level) continue
      setLevel.run(level, row.id)
      filled++
    }
    if (filled) stat.evidence_backfilled = filled
  } catch (err) {
    // 老库还没补列（db/init.js 的 MISSING_COLUMNS 没跑）时不该整体炸掉启动
    stat.rejected.push(`依据分档回填失败: ${err.message}`)
  }

  return stat
}

module.exports = { applyRuleSeeds, normalizeCondition, normalizeAction, validateGroup }

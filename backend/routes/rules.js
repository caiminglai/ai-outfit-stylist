/**
 * 规则引擎管理路由模块
 * 对应 Python: app/routes/rules.py
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { toEnabledBit, ownValue, asNumber, asFilters, asId } = require('../utils/common')
const { adminLoginRequired } = require('../middleware/auth')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')
const {
  explainGroup,
  FIELD_LABELS,
  OPERATOR_LABELS,
  ACTION_LABELS,
} = require('../services/ruleExplainer')
const { buildRecommendation } = require('../services/recommendEngine')
const { EVIDENCE_LEVELS, VALUES: EVIDENCE_VALUES } = require('../services/evidenceLevels')

const router = express.Router()

// ============================================================
// 条件/动作的校验与归一化
// 引擎 checkSingleCondition 取匹配值时要求 value 是 {"<field>": ...} 形状,
// 键名对不上就永远不命中,所以写入端必须强制归一成这个形状。
// ============================================================

/** 规则条件可用字段:直接取自可解释性模块的字段标签表(单一数据源,避免三处写歪) */
const CONDITION_FIELDS = Object.keys(FIELD_LABELS)

const CONDITION_OPERATORS = ['eq', 'in', 'ne']

/**
 * 依据分档写入端归一：只认 A/B/C/D，认不出的一律落 NULL(未标注)，
 * 绝不在这里做二次判断——判档规则的唯一实现处是 services/evidenceLevels.js
 */
function normalizeEvidence(value) {
  const v = String(value ?? '')
    .trim()
    .toUpperCase()
  return EVIDENCE_VALUES.includes(v) ? v : null
}

/** 把用户填的值切成候选列表(支持中英文逗号/顿号) */
function splitList(value) {
  return String(value)
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 规则来源体系：种子文件给每条规则带了 source_key（wuxing_mu_outfit / kibbe-gamine-outfit），
 * 后台手工新建的没有。分隔符两种混用，取首个 _ 或 - 之前的那一段。
 */
const TAG_EXPR = `CASE WHEN source_key IS NULL OR source_key = '' THEN '' ELSE substr(source_key, 1, CASE
    WHEN instr(source_key, '_') > 0 AND instr(source_key, '-') > 0 THEN MIN(instr(source_key, '_'), instr(source_key, '-')) - 1
    WHEN instr(source_key, '_') > 0 THEN instr(source_key, '_') - 1
    WHEN instr(source_key, '-') > 0 THEN instr(source_key, '-') - 1
    ELSE length(source_key)
  END) END`

/** 「后台自建」这一档在查询串里的取值（空串要被当成"未选"，不能当选项值） */
const TAG_NONE = 'none'

const TAG_LABELS = {
  wuxing: '八字五行',
  color12: '十二季型色彩',
  color: '四季色彩',
  kibbe: 'Kibbe 风格型',
  proportion: '身材比例',
  dresscode: '场合着装',
  metal: '金属色适配',
  [TAG_NONE]: '后台自建',
}

/**
 * 校验并归一化一条条件
 * @returns {{ok: true, row: object} | {ok: false, error: string}}
 */
function normalizeCondition(input, idx) {
  // 数组里的每一项都得是对象：10-13 现量 `{"conditions":[null]}` 原来在这一行读
  // input.field 当场 TypeError ⇒ POST /groups 回 500，而这是"请求体写错了"、该 400。
  // null 尤其真得起来：前端删条件时按 null 占位、JSON 一序列化就是 [null]。
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `第 ${idx + 1} 条条件不是对象` }
  }
  const field = String(input.field || '').trim()
  const operator = String(input.operator || 'eq').trim()
  const weight = Number(input.weight) > 0 ? Number(input.weight) : 1

  if (!CONDITION_FIELDS.includes(field)) {
    return { ok: false, error: `第 ${idx + 1} 条条件字段无效: ${field || '(空)'}` }
  }
  if (!CONDITION_OPERATORS.includes(operator)) {
    return {
      ok: false,
      error: `第 ${idx + 1} 条条件操作符无效: ${operator}(只能用 ${CONDITION_OPERATORS.join('/')})`,
    }
  }

  let value = input.value
  // 已经是 {field: x} 形状的对象直接采用
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = field in value ? value[field] : Object.values(value)[0]
  }
  if (value === null || value === undefined || String(value).trim() === '') {
    value = 'all'
  }

  let stored
  if (operator === 'in') {
    const list = Array.isArray(value) ? value : splitList(value)
    if (list.length === 0) return { ok: false, error: `第 ${idx + 1} 条条件"属于"缺少候选值` }
    stored = { [field]: list }
  } else {
    stored = { [field]: Array.isArray(value) ? value.join('、') : String(value).trim() }
  }

  return { ok: true, row: { field, operator, value: JSON.stringify(stored), weight } }
}

/** 校验并归一化一条动作 */
function normalizeAction(input, idx, sortOrder) {
  const actionType = String(input.action_type || '').trim()
  const content = String(input.content ?? '').trim()
  if (!actionType) return { ok: false, error: `第 ${idx + 1} 条动作缺少类型` }
  if (!(actionType in ACTION_LABELS)) {
    return {
      ok: false,
      error: `第 ${idx + 1} 条动作类型无效: ${actionType}(前台不认这个键,需先在后端加中文标签)`,
    }
  }
  if (!content) return { ok: false, error: `第 ${idx + 1} 条动作(${actionType})内容为空` }
  return {
    ok: true,
    row: {
      action_type: actionType,
      content,
      sort_order: Number.isFinite(input.sort_order) ? input.sort_order : sortOrder,
    },
  }
}

/**
 * 整体替换某规则组的条件与动作
 * 调用方必须在事务内使用
 */
function replaceChildren(groupId, conditions, actions) {
  db.prepare('DELETE FROM rule_conditions WHERE group_id = ?').run(groupId)
  db.prepare('DELETE FROM rule_actions WHERE group_id = ?').run(groupId)

  const insCond = db.prepare(
    'INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, ?, ?, ?, ?)',
  )
  const insAct = db.prepare(
    'INSERT INTO rule_actions (group_id, action_type, content, sort_order) VALUES (?, ?, ?, ?)',
  )
  for (const c of conditions) insCond.run(groupId, c.field, c.operator, c.value, c.weight)
  for (const a of actions) insAct.run(groupId, a.action_type, a.content, a.sort_order)
}

/**
 * 读回某个规则组现有的条件/动作行，形状和 replaceChildren 需要的行一致。
 * value 列在库里就是 JSON 文本（normalizeCondition 里 JSON.stringify 出来的），
 * 原样读出来再原样写回去即可，不需要再序列化一次。
 */
function loadChildren(groupId) {
  return {
    conditions: db
      .prepare(
        'SELECT field, operator, value, weight FROM rule_conditions WHERE group_id = ? ORDER BY id',
      )
      .all(groupId),
    actions: db
      .prepare(
        'SELECT action_type, content, sort_order FROM rule_actions WHERE group_id = ? ORDER BY sort_order, id',
      )
      .all(groupId),
  }
}

/** 校验条件+动作数组,全部合法才返回 {conditions, actions},否则返回 error */
function validateChildren(body) {
  const conditions = []
  const actions = []
  const rawConds = Array.isArray(body.conditions) ? body.conditions : []
  const rawActs = Array.isArray(body.actions) ? body.actions : []

  for (const [i, raw] of rawConds.entries()) {
    // conditions:[null] / ["abc"] 这类畸形项原来直接进 normalizeCondition 读 .field ⇒ 500。
    // 非对象在这里就判掉，与"字段无效"同一口径回 400。
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: `第 ${i + 1} 条条件不是对象` }
    }
    const r = normalizeCondition(raw, i)
    if (!r.ok) return { error: r.error }
    conditions.push(r.row)
  }
  for (const [i, raw] of rawActs.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: `第 ${i + 1} 条动作不是对象` }
    }
    const r = normalizeAction(raw, i, i)
    if (!r.ok) return { error: r.error }
    actions.push(r.row)
  }
  return { conditions, actions }
}

/**
 * 后台编辑器元数据
 * 下拉项全部由后端给出(字段/动作标签表 + 库里实际用到的类别和场景),
 * 避免前端写死一版、后端另一版,保存时静默改坏数据。
 */
router.get('/schema', adminLoginRequired, (req, res) => {
  try {
    const categories = db
      .prepare(
        'SELECT DISTINCT category FROM rule_groups WHERE category IS NOT NULL ORDER BY category',
      )
      .all()
      .map((r) => r.category)
    const scenarios = db
      .prepare(
        'SELECT DISTINCT scenario FROM rule_groups WHERE scenario IS NOT NULL ORDER BY scenario',
      )
      .all()
      .map((r) => r.scenario)

    // 来源体系：只报现库真有的，条数为 0 的不进下拉；「后台自建」固定排最后
    const tagRows = db
      .prepare(`SELECT ${TAG_EXPR} AS value, COUNT(*) AS count FROM rule_groups GROUP BY value`)
      .all()
    const tags = tagRows
      .filter((t) => t.value !== '')
      .sort((a, b) => b.count - a.count)
      .concat(tagRows.filter((t) => t.value === ''))
      .map((t) => {
        const key = t.value === '' ? TAG_NONE : t.value
        return {
          value: key,
          // 标签名是从库里读出来的自由文本：ownValue 保证 label 只会是标签表里的中文，
          // 不会在 key 恰好是 constructor/toString 时变成一个函数（JSON 里整个字段消失）
          label: ownValue(TAG_LABELS, key) || key,
          count: t.count,
        }
      })

    // 部位/结论类型：动作表里在用的 action_type，中文名直接取可解释性那张标签表
    const parts = db
      .prepare(
        'SELECT action_type AS value, COUNT(*) AS count FROM rule_actions GROUP BY value ORDER BY count DESC',
      )
      .all()
      .map((p) => ({
        value: p.value,
        label: ownValue(ACTION_LABELS, p.value) || p.value,
        count: p.count,
      }))

    return sendSuccess(res, {
      fields: CONDITION_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] })),
      operators: CONDITION_OPERATORS.map((o) => ({
        value: o,
        label: OPERATOR_LABELS[o] || '等于',
      })),
      actionTypes: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
      categories,
      scenarios,
      tags,
      parts,
      // 依据分档：下拉项与条数同样后端下发，前端不写死（与 tags/parts 一个口径）
      evidenceLevels: EVIDENCE_LEVELS.map((l) => ({
        ...l,
        count: db
          .prepare('SELECT COUNT(*) AS c FROM rule_groups WHERE evidence_level = ?')
          .get(l.value).c,
      })).concat([
        {
          value: 'none',
          label: '未标注(按 C 档对待)',
          // 口径与 services/evidenceLevels.js 一致：只有"没带 source_key"才落 NULL；
          // 前缀认不出来的 key（如 height-f-170-180）按 C 兜底，不进这一档。
          // 原来这句写"或种子前缀认不出来的规则"，与实现相反，后台按它数出来的
          // "未标注 264 条"里其实一条前缀认不出的都没有。
          note: '后台手工建的规则（种子里没带 key 的那些）',
          count: db
            .prepare('SELECT COUNT(*) AS c FROM rule_groups WHERE evidence_level IS NULL')
            .get().c,
        },
      ]),
    })
  } catch (err) {
    logErr('[规则] 统计读取失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 获取规则组列表(管理员) */
router.get('/groups', adminLoginRequired, (req, res) => {
  try {
    // 会绑进 SQL 的筛选项一律先过 asFilters：`?tag[]=x&tag[]=y` 之类的数组查询串
    // 原样 push 进 params 会让 better-sqlite3 抛 RangeError ⇒ 规则列表整页 500。
    // enabled / hit 只做字面量比较、不绑参，保持原样。
    const { mode, category, gender, scenario, tag, part, evidence } = asFilters(req.query, [
      'mode',
      'category',
      'gender',
      'scenario',
      'tag',
      'part',
      'evidence',
    ])
    const { enabled, hit } = req.query
    let sql = `SELECT *, ${TAG_EXPR} AS tag FROM rule_groups WHERE 1=1`
    const params = []

    // 依据分档筛选：'none' 对应库里 NULL；其余值（含认不出来的）一律落进 WHERE，
    // 非法档位筛出 0 行、不报错——与 tag/part 同口径。悄悄返回全量会让人以为"筛过了"。
    if (evidence === 'none') {
      sql += ' AND evidence_level IS NULL'
    } else if (evidence) {
      sql += ' AND evidence_level = ?'
      params.push(String(evidence).toUpperCase())
    }

    // mode='all'(门店+个人通用)在两边都算命中——与 recommendEngine.matchRules 的口径一致，
    // 否则筛 store 时那 97 条 all 的种子规则会凭空消失（列表页、顾客端同一个坑）。
    if (mode) {
      sql += " AND (mode = ? OR mode = 'all')"
      params.push(mode)
    }
    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }
    if (gender) {
      sql += ' AND gender = ?'
      params.push(gender)
    }
    if (scenario) {
      sql += ' AND scenario = ?'
      params.push(scenario)
    }
    if (tag === TAG_NONE) {
      sql += " AND (source_key IS NULL OR source_key = '')"
    } else if (tag) {
      sql += ` AND ${TAG_EXPR} = ?`
      params.push(tag)
    }
    if (part) {
      sql +=
        ' AND EXISTS (SELECT 1 FROM rule_actions ra WHERE ra.group_id = rule_groups.id AND ra.action_type = ?)'
      params.push(part)
    }
    if (enabled !== undefined && enabled !== '') {
      sql += ' AND enabled = ?'
      params.push(enabled === 'true' || enabled === '1' ? 1 : 0)
    }
    if (hit === 'never') {
      sql += ' AND hit_count = 0'
    }

    sql += ' ORDER BY priority DESC, created_at DESC'
    const groups = db.prepare(sql).all(...params)

    // 批量挂载条件与动作(列表页要显示命中条件,编辑弹窗也直接用这份数据)
    if (groups.length > 0) {
      const ids = groups.map((g) => g.id)
      const ph = ids.map(() => '?').join(',')
      const conds = db
        .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${ph}) ORDER BY id`)
        .all(...ids)
      const acts = db
        .prepare(`SELECT * FROM rule_actions WHERE group_id IN (${ph}) ORDER BY sort_order`)
        .all(...ids)
      const condMap = {}
      const actMap = {}
      for (const c of conds) (condMap[c.group_id] ||= []).push(c)
      for (const a of acts) (actMap[a.group_id] ||= []).push(a)
      for (const g of groups) {
        g.conditions = condMap[g.id] || []
        g.actions = actMap[g.id] || []
      }
    }

    return sendSuccess(res, { groups, total: groups.length })
  } catch (err) {
    logErr('[规则] 分组列表读取失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 获取单个规则组详情(含条件和动作,管理员) */
router.get('/groups/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const group = db.prepare('SELECT * FROM rule_groups WHERE id = ?').get(id)
    if (!group) {
      return sendError(res, '规则组不存在', 404)
    }

    const conditions = db.prepare('SELECT * FROM rule_conditions WHERE group_id = ?').all(id)
    const actions = db
      .prepare('SELECT * FROM rule_actions WHERE group_id = ? ORDER BY sort_order')
      .all(id)

    return sendSuccess(res, { group, conditions, actions })
  } catch (err) {
    logErr('[规则] 分组详情读取失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 创建规则组(管理员) */
router.post('/groups', adminLoginRequired, (req, res) => {
  try {
    const {
      name,
      mode,
      gender,
      category,
      scenario,
      region,
      age_range,
      description,
      priority,
      enabled,
      evidence_level,
    } = req.body || {}

    if (!name || !category) {
      return sendError(res, '规则名称和分类不能为空', 400)
    }

    // 与 PUT 同一套形状校验：这些列要么 NOT NULL 要么直接绑参，
    // 传对象/数组会在 .run() 当场 RangeError，传 null/空串撞 NOT NULL ⇒ 都回成 500，
    // 而它们本质是"这个字段写错了"，该 400。
    for (const [label, v, required] of [
      ['name', name, true],
      // mode 可以不带（下面按 'store' 兜底），带了就必须是文本
      ['mode', mode, false],
      ['category', category, true],
    ]) {
      if (v === undefined || v === null) {
        if (required) return sendError(res, `${label} 须为非空文本`, 400)
        continue
      }
      if (typeof v !== 'string' || !v.trim()) {
        return sendError(res, `${label} 须为非空文本`, 400)
      }
    }
    for (const [label, v] of [
      ['gender', gender],
      ['scenario', scenario],
      ['region', region],
      ['age_range', age_range],
      ['description', description],
      ['priority', priority],
      ['evidence_level', evidence_level],
    ]) {
      if (v !== undefined && v !== null && typeof v === 'object') {
        return sendError(res, `${label} 类型不正确`, 400)
      }
    }

    const children = validateChildren(req.body || {})
    if (children.error) return sendError(res, children.error, 400)
    if (children.conditions.length === 0) {
      return sendError(res, '至少需要一条命中条件', 400)
    }
    if (children.actions.length === 0) {
      return sendError(res, '至少需要一条推荐动作', 400)
    }

    // priority 落在 INTEGER 列，原来只挡对象/数组，字符串原样绑进去：
    // SQLite 排序里 TEXT 恒大于 INTEGER ⇒ `ORDER BY priority DESC`(:313) 整体失真，
    // 一条 "priority":"abc" 的脏数据就能把门店端的建议顺序永远顶到最前。
    const priorityNum =
      priority === undefined || priority === null || priority === ''
        ? 0
        : Math.trunc(asNumber(priority, NaN))
    if (!Number.isFinite(priorityNum)) return sendError(res, 'priority 只能是整数', 400)

    const createGroup = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO rule_groups
        (name, mode, gender, category, scenario, region, age_range, description, priority, enabled, evidence_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          mode || 'store',
          gender || null,
          category,
          scenario || null,
          region || null,
          age_range || null,
          description || null,
          priorityNum,
          toEnabledBit(enabled, 1),
          normalizeEvidence(evidence_level),
        )
      replaceChildren(info.lastInsertRowid, children.conditions, children.actions)
      return info.lastInsertRowid
    })

    const groupId = createGroup()
    return sendCreated(res, { id: groupId }, `${req.baseUrl}/groups/${groupId}`)
  } catch (err) {
    logErr('[规则] 创建失败:', err)
    return sendError(res, '创建失败', 500)
  }
})

/** 更新规则组(管理员) */
router.put('/groups/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const body = req.body || {}
    const existing = db.prepare('SELECT * FROM rule_groups WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, '规则组不存在', 404)
    }

    // 契约与 POST 对齐:name/mode/category 是真必填(NOT NULL),这里要挡三种打回 500 的写法——
    // ① 传 null(绑进 NOT NULL 列)、② 传对象/数组(better-sqlite3 抛 RangeError)、③ 传空串。
    // 之前的 pick() 会把这些原样塞进 UPDATE ⇒ 后台/脚本一个坏请求就 500。
    for (const f of ['name', 'mode', 'category']) {
      if (body[f] !== undefined && (typeof body[f] !== 'string' || !body[f].trim())) {
        return sendError(res, `${f} 须为非空文本`, 400)
      }
    }
    // 可空标量列:允许 null(清空),但对象/数组同样会 RangeError ⇒ 拒掉。
    for (const f of [
      'gender',
      'scenario',
      'region',
      'age_range',
      'description',
      'priority',
      'evidence_level',
    ]) {
      const v = body[f]
      if (v !== undefined && v !== null && typeof v === 'object') {
        return sendError(res, `${f} 类型不正确`, 400)
      }
    }

    const pick = (key) => (body[key] !== undefined ? body[key] : existing[key])
    // priority 与 POST 走同一个口径：绑进 INTEGER 列的值必须是整数，
    // 否则 SQLite 排序里 TEXT 恒大于 INTEGER ⇒ 一条 "priority":"abc" 就能把门店端建议顺序永久顶乱。
    const priorityRaw = pick('priority')
    const priorityNum =
      priorityRaw === undefined || priorityRaw === null || priorityRaw === ''
        ? 0
        : Math.trunc(asNumber(priorityRaw, NaN))
    if (!Number.isFinite(priorityNum)) {
      return sendError(res, 'priority 只能是整数', 400)
    }
    const fields = {
      name: pick('name'),
      mode: pick('mode'),
      gender: pick('gender'),
      category: pick('category'),
      scenario: pick('scenario'),
      region: pick('region'),
      age_range: pick('age_range'),
      description: pick('description'),
      priority: priorityNum,
      enabled: toEnabledBit(body.enabled, existing.enabled),
      evidence_level:
        body.evidence_level === undefined
          ? existing.evidence_level
          : normalizeEvidence(body.evidence_level),
    }

    // 只有请求真的带了条件/动作数组时才整体替换,避免部分更新把子表清空
    const hasChildren = Array.isArray(body.conditions) || Array.isArray(body.actions)
    let children = { conditions: [], actions: [] }
    if (hasChildren) {
      const validated = validateChildren(body)
      if (validated.error) return sendError(res, validated.error, 400)
      // 条件和动作**分侧各判**：原来只带 conditions 不带 actions 时，validateChildren
      // 把缺省的那侧当空数组 ⇒ 直接 400，PUT 的"部分更新"契约在子表上根本不成立
      // （后台想只改一条条件，必须把整份动作列表一起回传）。
      // 现在没带的那侧沿用库里现有的行，带了的侧仍然要求至少一条（空数组＝想清空，照拒）。
      const kept = loadChildren(id)
      children = {
        conditions: Array.isArray(body.conditions) ? validated.conditions : kept.conditions,
        actions: Array.isArray(body.actions) ? validated.actions : kept.actions,
      }
      if (children.conditions.length === 0) {
        return sendError(res, '至少需要一条命中条件', 400)
      }
      if (children.actions.length === 0) {
        return sendError(res, '至少需要一条推荐动作', 400)
      }
    }

    const updateGroup = db.transaction(() => {
      db.prepare(
        `UPDATE rule_groups SET
        name=?, mode=?, gender=?, category=?, scenario=?,
        region=?, age_range=?, description=?, priority=?, enabled=?, evidence_level=?
       WHERE id=?`,
      ).run(
        fields.name,
        fields.mode,
        fields.gender || null,
        fields.category,
        fields.scenario || null,
        fields.region || null,
        fields.age_range || null,
        fields.description || null,
        fields.priority,
        fields.enabled,
        fields.evidence_level,
        id,
      )
      if (hasChildren) replaceChildren(id, children.conditions, children.actions)
    })

    updateGroup()
    return sendSuccess(res, null)
  } catch (err) {
    logErr('[规则] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除规则组(管理员) */
router.delete('/groups/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    // 原来直接三连 DELETE 且不判存在:删不存在的 id 也回 200「成功」,三条 DELETE 又没包事务,
    // 中间抛错会留下"子表删了、主表还在"的孤儿。⇒ 先查、再事务、删空算 404。
    const existing = db.prepare('SELECT id FROM rule_groups WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, '规则组不存在', 404)
    }
    // feedback_events.group_id 是 NOT NULL 外键指向 rule_groups(id)（schema.sql:301），
    // 而 db/init.js:44 开着 `PRAGMA foreign_keys = ON` ⇒ 有人点过"有用/不准"的规则
    // 直接 DELETE 必抛约束失败，页面只回一句"删除失败"，而且永远删不掉。
    // 这里不改成"连反馈一起删"：那是顾客的评价数据，删规则的正当出口是下面那条 toggle（enabled=0）。
    const rated = db
      .prepare('SELECT COUNT(*) AS n FROM feedback_events WHERE group_id = ?')
      .get(id).n
    if (rated > 0) {
      return sendError(
        res,
        `这条规则已有 ${rated} 条用户反馈，删掉会把反馈一起断掉。要停用请点"禁用"（列表里的开关），规则会保留但不再命中。`,
        409,
      )
    }
    const removeGroup = db.transaction(() => {
      db.prepare('DELETE FROM rule_actions WHERE group_id = ?').run(id)
      db.prepare('DELETE FROM rule_conditions WHERE group_id = ?').run(id)
      db.prepare('DELETE FROM rule_groups WHERE id = ?').run(id)
    })
    removeGroup()
    return sendSuccess(res, null)
  } catch (err) {
    logErr('[规则] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

/** 切换规则组启用/禁用状态(管理员) */
router.post('/groups/:id/toggle', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    // 与 models.js 的 toggle 同一个竞态：先 SELECT 后按读到的值写回，
    // 连点两下可能两个请求都读到同一个 enabled ⇒ 净效果是没翻转。
    // 翻转交给 SQLite 在这笔写里自己算，非 1 的值（NULL／脏值）一律收回 1。
    const info = db
      .prepare(
        `UPDATE rule_groups SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?`,
      )
      .run(id)
    if (info.changes === 0) {
      return sendError(res, '规则组不存在', 404)
    }
    const after = db.prepare('SELECT enabled FROM rule_groups WHERE id = ?').get(id)
    return sendSuccess(res, { enabled: after && after.enabled === 1 })
  } catch (err) {
    logErr('[规则] 切换状态失败:', err)
    return sendError(res, '操作失败', 500)
  }
})

/** 预览规则匹配(管理员) */
router.post('/preview', adminLoginRequired, (req, res) => {
  try {
    const { profile, mode } = req.body || {}
    if (!profile) {
      return sendError(res, '缺少用户画像数据', 400)
    }

    // 直接调用推荐引擎(已修复 category 映射 bug + 带可解释性说明 explanation)
    // 修复原 /preview 的 bug:原逻辑用 operator '==' 但数据库存的是 'eq',且未解析 value JSON
    // ⛔ 第四个参数（隐性偏好身份）这里**故意不传**：后台预览看的是"这条规则会推出什么"，
    // 混进某个管理员/某个顾客自己的日记偏爱，预览出来的名次就不是规则的本来的样子。
    const recommendation = buildRecommendation(profile, mode || 'store', false)

    const total =
      (recommendation.穿搭?.length || 0) +
      (recommendation.妆容?.length || 0) +
      (recommendation.发型?.length || 0) +
      (recommendation.配饰?.length || 0) +
      (recommendation.姿势?.length || 0)

    return sendSuccess(res, { recommendation, total })
  } catch (err) {
    logErr('[规则] 预览失败:', err)
    return sendError(res, '预览失败', 500)
  }
})

/**
 * 浏览规则(面向普通用户,带中文解释,无需登录)
 *
 * 让用户看懂规则引擎:返回所有启用的规则组,每条带中文人话解释,
 * 用户能理解"我填什么档案能匹配到什么规则".
 *
 * 查询参数:
 *   - mode: store(门店)/personal(个人),默认 store
 *   - category: 穿搭/妆容/发型/配饰/姿势
 *   - gender: 女/男
 *   - scenario: 通勤/约会/...
 */
router.get('/browse', (req, res) => {
  try {
    // 与 /groups 同一把闸门：顾客端这页同样会把筛选值绑进 SQL，数组查询串会 500
    const { mode, category, gender, scenario } = asFilters(req.query, [
      'mode',
      'category',
      'gender',
      'scenario',
    ])
    let sql = 'SELECT * FROM rule_groups WHERE enabled = 1'
    const params = []

    // 顾客端这一页的用途是"看懂引擎会怎么用这些规则"，所以 mode 的口径必须跟
    // recommendEngine.matchRules 一模一样：mode='all' 两边都算命中。
    if (mode) {
      sql += " AND (mode = ? OR mode = 'all')"
      params.push(mode)
    }
    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }
    if (gender) {
      sql += ' AND (gender = ? OR gender IS NULL)'
      params.push(gender)
    }
    if (scenario) {
      sql += ' AND (scenario = ? OR scenario IS NULL)'
      params.push(scenario)
    }

    sql += ' ORDER BY category, priority DESC, created_at DESC'
    const groups = db.prepare(sql).all(...params)

    if (groups.length === 0) {
      return sendSuccess(res, { rules: [], total: 0 })
    }

    // 批量加载所有条件(避免 N+1 查询)
    const groupIds = groups.map((g) => g.id)
    const placeholders = groupIds.map(() => '?').join(',')
    const allConditions = db
      .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${placeholders})`)
      .all(...groupIds)

    const conditionsByGroup = {}
    for (const c of allConditions) {
      ;(conditionsByGroup[c.group_id] ||= []).push(c)
    }

    // 用 explainGroup 生成中文概览,让普通人看懂规则
    const rules = groups.map((g) => {
      const conds = conditionsByGroup[g.id] || []
      const overview = explainGroup(g, conds)
      return {
        id: g.id,
        ...overview,
      }
    })

    return sendSuccess(res, { rules, total: rules.length })
  } catch (err) {
    logErr('[规则] 浏览失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

module.exports = router

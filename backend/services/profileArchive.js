/**
 * 长期档案读写层
 *
 * 解决的是"每次推荐都从零填表"这个问题：
 *   - 计算前先把这个人身上已有的条件读出来（loadArchive）
 *   - 当次表单只覆盖他这次真的填了的项（mergeWithArchive）
 *   - 算完把这次新填的写回档案（saveArchive）
 *   - 每次推荐落一条样本，能查到是谁（writeRecommendationLog）
 *   - 下次进表单页时，把上次填的整份表单读回来预填（loadLastForm）
 *   - 填了一半没点生成的，也按人存一份草稿（saveDraft / loadDraft）
 *   - 给用户查阅"我们替你记了什么"时，把字段名换成中文（describeProfile）
 *
 * 词表约定：列名一律用规则引擎在用的条件字段名（如 nose_bridge），
 * 入库即命中规则，不再维护第二套名字。
 */

const db = require('../db/init')
const { FIELD_LABELS } = require('./ruleExplainer')
const { asText, asNumber, ownValue, stripIdentityFields } = require('../utils/common')

/**
 * 身体数字项的中文名（只用于给用户看）
 * 这些不是规则条件字段，放进 FIELD_LABELS 会混进后台"新增规则条件"下拉，而引擎不支持数值条件
 */
const ARCHIVE_LABELS = {
  height: '身高',
  weight: '体重',
  bust: '胸围',
  waist: '腰围',
  hip: '臀围',
  shoulder: '肩宽',
  // 八字五行的输入:不是规则条件字段,只给用户看名字
  birth_date: '出生日期',
  birth_hour: '出生时辰',
}

/**
 * 计算结果标签：key 与引擎返回的 _computed 键一字一样，换 key 等于换列名
 * 这些是算出来的结论，不是用户填的条件，所以不进 FIELD_LABELS
 */
const TAG_DEFS = [
  { key: 'bmi', label: 'BMI' },
  { key: 'bmi_level', label: 'BMI 档位' },
  { key: 'body_shape', label: '体型（算出）' },
  { key: 'wh_ratio', label: '腰臀比' },
  { key: 'leg_ratio', label: '腿身比' },
  { key: 'shoulder_ratio', label: '肩宽比' },
  { key: 'color_match', label: '适合色系' },
  { key: 'color_avoid', label: '回避色系' },
  { key: 'color_season', label: '色彩四季型（算出）' },
  { key: 'color_season_12', label: '色彩十二型（算出）' },
  { key: 'kibbe_type', label: '风格型（算出）' },
]

/** profile 字段 ⇄ 身体档案列；kind 决定校验方式 */
const BODY_FIELDS = [
  { key: 'height', column: 'height_cm', kind: 'num', min: 50, max: 250 },
  { key: 'weight', column: 'weight_kg', kind: 'num', min: 20, max: 300 },
  { key: 'bust', column: 'bust_cm', kind: 'num', min: 40, max: 200 },
  { key: 'waist', column: 'waist_cm', kind: 'num', min: 30, max: 200 },
  { key: 'hip', column: 'hip_cm', kind: 'num', min: 40, max: 220 },
  { key: 'shoulder', column: 'shoulder_width_cm', kind: 'num', min: 20, max: 80 },
  { key: 'leg_length', column: 'leg_length_cm', kind: 'num', min: 30, max: 160 },
  { key: 'neck_length', column: 'neck_length', kind: 'text' },
  { key: 'shoulder_type', column: 'shoulder_type', kind: 'text' },
  { key: 'body_type', column: 'body_type', kind: 'text' },
  { key: 'frame_size', column: 'frame_size', kind: 'text' },
  { key: 'line_quality', column: 'line_quality', kind: 'text' },
  { key: 'birth_date', column: 'birth_date', kind: 'text' },
  { key: 'birth_hour', column: 'birth_hour', kind: 'text' },
]

/** profile 字段 ⇄ 面容档案列；source 是该字段在表单里的多个可能名字 */
const FACE_FIELDS = [
  { key: 'skin_tone', column: 'skin_tone', source: ['skin_tone', 'skin_tone_detail'] },
  { key: 'skin_tone_detail', column: 'skin_tone_detail', source: ['skin_tone_detail'] },
  { key: 'color_chroma', column: 'color_chroma', source: ['color_chroma'] },
  { key: 'skin_type', column: 'skin_type', source: ['skin_type'] },
  { key: 'face_shape', column: 'face_shape', source: ['face_shape'] },
  { key: 'face_ratio', column: 'face_ratio', source: ['face_ratio'] },
  { key: 'eye_spacing', column: 'eye_spacing', source: ['eye_spacing'] },
  { key: 'eye_size', column: 'eye_size', source: ['eye_size'] },
  { key: 'eye_shape', column: 'eye_shape', source: ['eye_shape'] },
  { key: 'nose_bridge', column: 'nose_bridge', source: ['nose_bridge', 'nose_height'] },
  { key: 'lip_thickness', column: 'lip_thickness', source: ['lip_thickness'] },
]

/**
 * 允许用户主动清掉的选填项
 * 出生日期填错了又想撤掉这条依据时，光把输入框清空不够：档案里的旧值会被当成"这次没填"填回来，
 * 照旧算八字与年龄。这两项传空串就代表"我要撤掉"，其余字段仍按"只增不清"处理。
 */
const CLEARABLE_KEYS = ['birth_date', 'birth_hour']

/** 判断"这次真的填了"：空串、null、undefined、NaN 都算没填 */
function isFilled(val) {
  if (val === null || val === undefined) return false
  if (typeof val === 'string') return val.trim() !== ''
  if (typeof val === 'number') return !isNaN(val)
  // 空数组＝多选/标签类字段被清空：这算"没填"，让档案里的旧值接管。
  // 原来直接 return true ⇒ 表单把某项清成 [] 时档案值既不采用也不覆盖，
  // 这一维本次推荐就当它不存在（而注释承诺的是"空即未填"）。
  if (Array.isArray(val)) return val.length > 0
  if (typeof val === 'object') return Object.keys(val).length > 0
  return true
}

/** 数值列校验，越界或非法当没填 */
function cleanNum(val, min, max) {
  const n = Number(val)
  if (isNaN(n)) return null
  if (n < min || n > max) return null
  return n
}

/** 文本列校验：只留短字符串，挡掉脚本塞进来的长垃圾 */
function cleanText(val) {
  if (typeof val !== 'string') return null
  const s = val.trim()
  if (!s || s.length > 40) return null
  return s
}

/** 从 profile 里取该列对应的值（按 source 顺序取第一个填了的） */
function pick(profile, field) {
  const names = field.source || [field.key]
  for (const name of names) {
    if (isFilled(profile[name])) {
      return field.kind === 'num'
        ? cleanNum(profile[name], field.min, field.max)
        : cleanText(profile[name])
    }
  }
  return null
}

/**
 * 读出这个人的长期档案，形状与 profile 一致，可直接喂给引擎
 * @param {number} userId
 * @returns {object} 只含档案里确实有值的字段
 */
function loadArchive(userId) {
  const archive = {}
  if (!userId) return archive

  const body = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(userId)
  if (body) {
    for (const field of BODY_FIELDS) {
      const val = body[field.column]
      if (isFilled(val)) archive[field.key] = val
    }
  }

  const face = db.prepare('SELECT * FROM face_profiles WHERE user_id = ?').get(userId)
  if (face) {
    for (const field of FACE_FIELDS) {
      const val = face[field.column]
      if (isFilled(val)) archive[field.key] = val
    }
  }

  const user = db.prepare('SELECT gender FROM users WHERE id = ?').get(userId)
  if (user && isFilled(user.gender)) archive.gender = user.gender

  return archive
}

/**
 * 读这个人上一次填的完整表单（最近一条个人模式样本的输入快照）
 * 档案表只存身体/面容那二十几项，场合、预算、主要目标、风格偏好这些只留在快照里，
 * 不拿快照打底，用户每次回来都得把它们重填一遍。
 * @param {number} userId
 * @returns {object} 快照里的字段；没填过返回空对象
 */
function loadLastForm(userId) {
  if (!userId) return {}
  const row = db
    .prepare(
      `SELECT input_snapshot FROM recommendation_logs
       WHERE user_id = ? AND mode = 'personal' AND input_snapshot IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(userId)
  if (!row) return {}
  try {
    return JSON.parse(row.input_snapshot) || {}
  } catch {
    return {}
  }
}

/**
 * 读这个人的表单草稿（填了一半、还没点生成的那一份）
 * @param {number} userId
 * @returns {object} 草稿里的字段；没存过返回空对象
 */
function loadDraft(userId) {
  if (!userId) return {}
  const row = db.prepare('SELECT form_json FROM profile_drafts WHERE user_id = ?').get(userId)
  if (!row) return {}
  try {
    return JSON.parse(row.form_json) || {}
  } catch {
    return {}
  }
}

/**
 * 存草稿：整份表单原样留下，永远只有最新一份
 * 与档案一样只增不清——清空某个字段不会把库里的旧值抹掉，要抹走"删除我的形象档案与记录"
 * @param {number} userId
 * @param {object} form 表单当前值
 * @returns {number} 存进去的字段数
 */
function saveDraft(userId, form) {
  if (!userId) return 0
  const draft = {}
  for (const [key, val] of Object.entries(form || {})) {
    if (key === 'nickname' || key === 'phone') continue
    if (!isFilled(val)) continue
    draft[key] = typeof val === 'string' ? val.slice(0, 200) : val
  }
  const columns = Object.keys(draft)
  if (columns.length === 0) return 0
  db.prepare(
    `INSERT INTO profile_drafts (user_id, form_json) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       form_json = excluded.form_json, updated_at = datetime('now')`,
  ).run(userId, JSON.stringify(draft))
  return columns.length
}

/**
 * 把表单字段变成给用户看的中文清单
 * 数字项取 ARCHIVE_LABELS，分类项取 FIELD_LABELS，两个表都不认的原样留 key（宁可露一个英文，不可露一个错译）
 * @param {object} profile 合并后的档案
 * @returns {Array<{key: string, label: string, value: string}>}
 */
function describeProfile(profile) {
  return Object.entries(profile || {})
    .filter(([, val]) => isFilled(val))
    .map(([key, val]) => ({
      key,
      // ownValue：key 来自用户自己存的表单草稿，'constructor'/'toString' 这类
      // 原型键直接查表会拿到函数，序列化进响应后前端读到的 label 是空的。
      label: ownValue(ARCHIVE_LABELS, key) || ownValue(FIELD_LABELS, key) || key,
      // 只认文本/数字两类值：草稿里混进来的对象、数组 String() 出来是
      // "[object Object]"，直接当档案值展示给用户看就是错的。
      value:
        typeof val === 'number'
          ? String(val)
          : Array.isArray(val)
            ? val
                .map((v) => String(v))
                .join('、')
                .slice(0, 200)
            : typeof val === 'object'
              ? ''
              : String(val).slice(0, 200),
    }))
    .filter((f) => f.value !== '')
}

/**
 * 拼出"下次回来该预填的东西"：上次填过的样本打底 → 最近的草稿覆盖 → 身体面容档案收尾
 * 档案排在最后，因为它是校验过的列值；草稿只负责把档案没有的场合、预算这类字段带回来
 * @param {number} userId
 * @returns {object}
 */
function loadPrefill(userId) {
  const prefill = { ...loadLastForm(userId), ...loadDraft(userId), ...loadArchive(userId) }
  // 档案里已撤销的选填项要连样本快照里那份旧值一起压掉，否则清空了下次进来又冒出来
  if (userId) {
    const body = db
      .prepare('SELECT birth_date, birth_hour FROM body_metrics WHERE user_id = ?')
      .get(userId)
    if (body) {
      for (const field of BODY_FIELDS) {
        if (CLEARABLE_KEYS.includes(field.key) && !isFilled(body[field.column])) {
          delete prefill[field.key]
        }
      }
    }
  }
  return prefill
}

/**
 * 档案打底，当次表单覆盖
 * @param {object} profile 本次提交
 * @param {object} archive loadArchive 的结果
 * @returns {{profile: object, used: string[]}} used 是沿用了档案的字段中文名
 */
function mergeWithArchive(profile, archive) {
  const merged = { ...profile }
  const used = []
  const cleared = new Set(CLEARABLE_KEYS.filter((key) => merged[key] === ''))
  for (const key of cleared) delete merged[key]
  for (const [key, val] of Object.entries(archive || {})) {
    if (cleared.has(key)) continue
    if (!isFilled(merged[key])) {
      merged[key] = val
      used.push(ownValue(ARCHIVE_LABELS, key) || ownValue(FIELD_LABELS, key) || key)
    }
  }
  return { profile: merged, used }
}

/**
 * 把本次新填的条件写回档案（没填的不动，不会被清空）
 * @param {number} userId
 * @param {object} profile 本次提交（原始，未合并档案）
 * @returns {{body: number, face: number}} 各表写入的字段数
 */
function saveArchive(userId, profile) {
  const saved = { body: 0, face: 0 }
  if (!userId) return saved

  const bodyRow = {}
  for (const field of BODY_FIELDS) {
    const val = pick(profile, field)
    if (val !== null) bodyRow[field.column] = val
  }
  // 体型允许只填细分（个人表单）：body_type 为空时拿 body_type_detail 补上
  if (!bodyRow.body_type && isFilled(profile.body_type_detail)) {
    bodyRow.body_type = cleanText(profile.body_type_detail)
  }
  // 主动撤销的选填项（空串）：档案里已有这一行时把列清成 NULL
  const clearCols = BODY_FIELDS.filter(
    (field) => CLEARABLE_KEYS.includes(field.key) && profile[field.key] === '',
  ).map((field) => field.column)

  const columns = Object.keys(bodyRow)
  if (columns.length > 0 || clearCols.length > 0) {
    const existing = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(userId)
    if (existing) {
      const sets = [...columns.map((c) => `${c} = ?`), ...clearCols.map((c) => `${c} = NULL`)]
      db.prepare(
        `UPDATE body_metrics SET ${sets.join(', ')},
         updated_at = datetime('now') WHERE user_id = ?`,
      ).run(...columns.map((c) => bodyRow[c]), userId)
    } else if (columns.length > 0) {
      db.prepare(
        `INSERT INTO body_metrics (user_id, ${columns.join(', ')})
         VALUES (?, ${columns.map(() => '?').join(', ')})`,
      ).run(userId, ...columns.map((c) => bodyRow[c]))
    }
    saved.body = columns.length + (existing ? clearCols.length : 0)
  }

  const faceRow = {}
  for (const field of FACE_FIELDS) {
    const val = pick(profile, field)
    if (val !== null) faceRow[field.column] = val
  }
  if (Object.keys(faceRow).length > 0) {
    const existing = db.prepare('SELECT * FROM face_profiles WHERE user_id = ?').get(userId)
    const columns = Object.keys(faceRow)
    if (existing) {
      db.prepare(
        `UPDATE face_profiles SET ${columns.map((c) => `${c} = ?`).join(', ')},
         updated_at = datetime('now') WHERE user_id = ?`,
      ).run(...columns.map((c) => faceRow[c]), userId)
    } else {
      db.prepare(
        `INSERT INTO face_profiles (user_id, ${columns.join(', ')})
         VALUES (?, ${columns.map(() => '?').join(', ')})`,
      ).run(userId, ...columns.map((c) => faceRow[c]))
    }
    saved.face = columns.length
  }

  if (isFilled(profile.gender)) {
    db.prepare('UPDATE users SET gender = ? WHERE id = ? AND (gender IS NULL OR gender = ?)').run(
      cleanText(profile.gender),
      userId,
      '',
    )
  }

  return saved
}

/**
 * 落一条样本：输入快照 + 输出 + 是谁 + 哪家店
 * 快照里不留昵称与手机号：样本要长期留存，身份信息不需要
 * @returns {number|null} 日志 id
 */
function writeRecommendationLog({ sessionId, userId, storeId, mode, profile, result }) {
  const sid = asText(sessionId)
  // session_id 这列是 NOT NULL（db/schema.sql:285）。没有归属就写不进去：
  // 与其绑一个 null 让 INSERT 抛错、再被下面的 catch 吞成"一行都没落"，
  // 不如在这里把原因说清楚。补一个兜底串更不行——预填是按 session_id 查的，
  // 大家共用同一个兜底值就等于把别人的画像回给下一个人。
  if (!sid) {
    console.warn('[档案] 推荐样本未落库：缺少 session_id，无法归属到人')
    return null
  }
  try {
    // 身份字段递归剥：原来只 delete 顶层 nickname/phone 两笔，而门店端实测把手机号写成
    // contact.phone 这种嵌套位置（10-13 现量：input_snapshot 里能直接搜到 11 位号码）。
    // 样本是要长期留存、还会拿去训练/复盘的，"不留身份"这句承诺必须覆盖整份快照。
    const snapshot = stripIdentityFields(profile || {})
    // 四个标量列都过 asText/asNumber：调用方传进来的 session_id、mode 是从请求体一路带上来的，
    // 是对象/数组时绑参当场抛错，被下面的 catch 吞成"写样本失败"⇒ 客户端照样回 200，
    // 但 recommendation_logs 一行都不落，前端"上次填的表单"预填从此悄悄失效。
    const info = db
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, store_id, mode, input_snapshot, result)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sid,
        asNumber(userId, null),
        asNumber(storeId, null),
        asText(mode) || 'store',
        JSON.stringify(snapshot),
        JSON.stringify(result || {}),
      )
    return Number(info.lastInsertRowid)
  } catch (err) {
    // 样本写不进去不能带崩推荐
    console.error('[档案] 推荐样本写入失败:', err.message)
    return null
  }
}

/**
 * 读这个人的标签（按 TAG_DEFS 顺序，库里没有的键不会出现）
 * @param {number} userId
 * @returns {Array<{key: string, label: string, value: string}>}
 */
function loadTags(userId) {
  if (!userId) return []
  const rows = db
    .prepare('SELECT tag_key, tag_value FROM profile_tags WHERE user_id = ?')
    .all(userId)
  const found = new Map(rows.map((r) => [r.tag_key, r.tag_value]))
  return TAG_DEFS.filter((def) => found.has(def.key)).map((def) => ({
    key: def.key,
    label: def.label,
    value: found.get(def.key),
  }))
}

/**
 * 把本次算出来的结论标签按人存下来（每人每标签一行，再算一次就覆盖）
 * 写标签失败不能带崩推荐，所以整段兜住
 * @param {number} userId
 * @param {object} result 引擎返回，只读它的 _computed
 * @returns {Array<{key, label, value}>} 落库后从库里读回来的标签
 */
function saveTags(userId, result) {
  if (!userId) return []
  const computed = (result && result._computed) || {}
  try {
    const upsert = db.prepare(
      `INSERT INTO profile_tags (user_id, tag_key, tag_value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, tag_key) DO UPDATE SET
         tag_value = excluded.tag_value, updated_at = datetime('now')`,
    )
    for (const def of TAG_DEFS) {
      if (!isFilled(computed[def.key])) continue
      upsert.run(userId, def.key, String(computed[def.key]).slice(0, 200))
    }
    return loadTags(userId)
  } catch (err) {
    console.error('[档案] 标签写入失败:', err.message)
    return []
  }
}

module.exports = {
  loadArchive,
  loadLastForm,
  loadDraft,
  saveDraft,
  describeProfile,
  loadPrefill,
  mergeWithArchive,
  saveArchive,
  writeRecommendationLog,
  loadTags,
  saveTags,
}

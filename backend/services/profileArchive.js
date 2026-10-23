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
const { strictNum, limitOf } = require('./bodyLimits')
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

/**
 * profile 字段 ⇄ 身体档案列；kind 决定校验方式
 * ⚠️ `kind: 'num'` 的项**不带自己的 min/max**：界一律从 `bodyLimits.js` 按列名取（DR1，10-23 第六十四轮）。
 * 改前这张表自带一套 50~250／20~300 的松界，而前端 `saveProfileArchive()` 走的正是这条路
 * （全仓 0 处调 `/analysis/body`，10-23 现量），于是 `/body` 收紧了、真正写库的那条没收紧。
 * 在这里再写一份数字＝把第二把尺子请回来。
 */
const BODY_FIELDS = [
  { key: 'height', column: 'height_cm', kind: 'num' },
  { key: 'weight', column: 'weight_kg', kind: 'num' },
  { key: 'bust', column: 'bust_cm', kind: 'num' },
  { key: 'waist', column: 'waist_cm', kind: 'num' },
  { key: 'hip', column: 'hip_cm', kind: 'num' },
  { key: 'shoulder', column: 'shoulder_width_cm', kind: 'num' },
  { key: 'leg_length', column: 'leg_length_cm', kind: 'num' },
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

/**
 * 数值列校验（界从 `bodyLimits.js` 按列名取，DR1，10-23 第六十四轮）
 * 改前这里越界直接 `return null`——保存草稿的人不知道哪一格被扔，而且它握着一把比
 * `/analysis/body` 松得多的界（身高 50~250 vs 140~220）。现在两个入口共用一份界，
 * 但本条路径**不能回 400**：它是前端 1.5 秒防抖的自动保存（`ExhibitionHall.tsx:178`），
 * 400 会把整份表单打回去、并且每次 keystroke 都响一次。所以这里的口径是
 * 「这一格不写 + 在返回里点名」，由 `saveArchive` 汇成 `rejected` 数组回吐给调用方。
 * ⛔ 在这里另写一份 min/max——那等于把第二把尺子请回来。
 */
function cleanNum(column, val) {
  const r = strictNum(column, val)
  if (r.absent) return { value: null, reason: null }
  if (r.error) return { value: null, reason: r.error }
  return { value: r.value, reason: null }
}

/** 文本列校验：只留短字符串，挡掉脚本塞进来的长垃圾 */
function cleanText(val) {
  if (typeof val !== 'string') return null
  const s = val.trim()
  if (!s || s.length > 40) return null
  return s
}

/**
 * 从 profile 里取该列对应的值（按 source 顺序取第一个填了的）
 * 传了 `rejected` 数组时，数值格被拒会往里推一条 `{key,label,input,reason}`；
 * 没传（面容列那条循环，全是文本）行为与改前一样，只是数值界换成了共用的那份。
 */
function pick(profile, field, rejected) {
  const names = field.source || [field.key]
  for (const name of names) {
    if (!isFilled(profile[name])) continue
    if (field.kind !== 'num') return cleanText(profile[name])
    const r = cleanNum(field.column, profile[name])
    if (r.reason && rejected) {
      const raw = profile[name]
      rejected.push({
        key: field.key,
        label: (limitOf(field.column) || {}).label || field.column,
        input: typeof raw === 'number' || typeof raw === 'string' ? String(raw).slice(0, 40) : null,
        reason: r.reason,
      })
    }
    return r.value
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
 * 从一份"要展示给顾客看的表单视图"里挑出**填了但因为不合界而没进档案**的数值格
 * （DR1 追加，10-23 第六十四轮）。
 *
 * 为什么 `GET /archive` 需要它：`loadPrefill` 的契约是"把上次填的表单原样回吐"，
 * 草稿与快照列存的是**输入**，所以身高 300 这种被拒的值也会照样出现在
 * "我们替你记了什么"那张清单里——库里 `height_cm` 是 NULL，页面却说记了 300
 * （10-23 真实例现量：`PUT /archive` 收 300 ⇒ 库里 NULL，同一条会话 `GET /archive` 回 `"height":300`）。
 *
 * 本轮的口径：⛔ 动 `fields`（那是顾客端已在渲染的清单，砍掉一行＝悄悄丢数据，
 * 而且"为什么少了身高"这种话术要靠前端才讲得清），改成**追加**一条 `not_recorded`。
 * 待办记在 §12.15：顾客端把这条数组显示成"这一项没被记下，因为…"。
 *
 * @param {object} profile 展示视图（通常就是 `loadPrefill` 的返回值）
 * @returns {Array<{key,label,input,reason}>} 被尺子拒掉、因而不在档案里的数值格
 */
function unrecordedNumCells(profile) {
  const out = []
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return out
  for (const field of BODY_FIELDS) {
    if (field.kind !== 'num') continue
    pick(profile, field, out)
  }
  return out
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
 * @returns {{body: number, face: number, rejected: Array}} 各表写入的字段数；
 *   `rejected` ＝ 这次**填了但因为不合界而没写进档案**的数值格，每条
 *   `{key, label, input, reason}`（DR1，10-23 第六十四轮）。
 *   改前这些格子被 `cleanNum` 静默抹成 null，顾客看到"已保存"，库里却什么都没变；
 *   本条路径不能回 400（它是自动保存的草稿），所以改成"不写 + 点名"，
 *   由调用方决定要不要把 `reason` 显示出来（顾客端当前只读 `body`/`face`，⛔ 本轮不动前端）。
 */
function saveArchive(userId, profile) {
  const saved = { body: 0, face: 0, rejected: [] }
  if (!userId) return saved

  const bodyRow = {}
  for (const field of BODY_FIELDS) {
    const val = pick(profile, field, saved.rejected)
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
 * S6（10-19 蓝图短期项，10-23 落）：免费场样本不再整存 result JSON（现量平均 6,236 B/行，
 * 10 万用户一年 21 GB 就是这么来的），只存两样：
 *   shown —— 每个品类这一屏实际展示的名单（按展示序；规则行记 group_id，衣橱行记 w<衣橱行id>）
 *   snap  —— 每品类前 3 条的 rank 三维分快照（score/coverage/dims），够回答"当时为什么排这个位次"
 *            ⚠️ 10-23 现量：rank 只挂在穿搭（`rankAndTruncate` 只重排那一类，引擎 :1683），
 *            其余四类的条目没有 rank ⇒ snap 今天只有穿搭那几条。这是**行为的如实记录**，
 *            不是丢数据：名单 shown 五类都在，回归要的三个数只在穿搭那一维存在。
 * ⛔ 付费报告行不走这里（paidReport.js 自己插整份 result——那是交付物本体，replay 要原样回放）。
 * 判据来源：蓝图 §3.4 结论三 + `21` §rankDims 的三维出账形状。
 */
const LOG_SNAP_CATEGORIES = ['穿搭', '妆容', '发型', '配饰', '姿势']
const LOG_SNAP_MAX = 3

function _slimLogResult(result) {
  const shown = {}
  const snap = []
  const src = result && typeof result === 'object' ? result : {}
  for (const cat of LOG_SNAP_CATEGORIES) {
    const arr = Array.isArray(src[cat]) ? src[cat] : []
    const ids = []
    arr.forEach((raw, idx) => {
      const it = raw && typeof raw === 'object' ? raw : {}
      const who =
        it.group_id != null
          ? it.group_id
          : it.wardrobe_item_id != null
            ? `w${it.wardrobe_item_id}`
            : null
      if (who !== null) ids.push(who)
      if (idx < LOG_SNAP_MAX && it.rank && typeof it.rank === 'object') {
        const dims = {}
        for (const d of Array.isArray(it.rank.dims) ? it.rank.dims : []) {
          if (d && typeof d.key === 'string') dims[d.key] = d.score ?? null
        }
        snap.push({
          c: cat,
          g: who,
          s: it.rank.score ?? null,
          cov: it.rank.coverage ?? null,
          d: dims,
        })
      }
    })
    if (ids.length > 0) shown[cat] = ids
  }
  return { _log_slim: 2, shown, snap }
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
        // S6（10-23）：这里存的是**瘦身样本**（名单＋名次快照），不是整份 result。
        // 整份 result 只有付费那一行需要（交付物），那条走 paidReport.js 自己的 INSERT。
        JSON.stringify(_slimLogResult(result)),
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
  unrecordedNumCells,
  mergeWithArchive,
  saveArchive,
  writeRecommendationLog,
  loadTags,
  saveTags,
}

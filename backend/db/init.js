/**
 * 数据库初始化模块
 *
 * 使用 better-sqlite3 同步 API 连接 SQLite(与项目1统一)
 * 1. 打开/创建数据库(WAL 模式)
 * 2. 执行 schema.sql 建表
 * 3. 检查并导入种子数据
 * 4. 初始化管理员账号
 * 5. 清理过期顾客会话
 * 6. 启动 WAL 定时 checkpoint(避免 -wal 文件无限增长)
 */

const path = require('path')
const fs = require('fs')
const bcrypt = require('bcryptjs')
const Database = require('better-sqlite3')
const {
  SOURCE_MAP,
  ICON_MAP,
  findPmxFiles,
  parseFolderName,
  shouldSkipDir,
  BROKEN_DIR_NAME,
} = require('../utils/model-utils')
// ownValue：这里查表的键是 parseFolderName 从目录名里切出来的一截，属于自由文本。
// 今天 parseFolderName 已经把认不出的都归成 '其他'（那是本轮在 model-utils 里修的），
// 但 ICON_MAP['constructor'] 这类顺原型链取值不该靠上游保证——一旦有别的调用方把原始
// 目录名送进来，图标列就会写进一个函数。
const { ownValue } = require('../utils/common')

// 数据库路径唯一出口是 ./paths(在这里再拼一次属于历史遗留,拼错会静默开一个空库)
const { DB_PATH } = require('./paths')
const SCHEMA_PATH = path.join(__dirname, 'schema.sql')

// 打开数据库(同时设置 WAL 模式)
const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA foreign_keys = ON')

// WAL checkpoint 定时器句柄(由 server.js 在退出时清理)
let walCheckpointTimer = null
let sessionCleanupTimer = null

/**
 * 执行 WAL checkpoint
 * @param {'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'} mode
 *   - PASSIVE: 不阻塞读写,可能留下部分 WAL
 *   - TRUNCATE: 强制截断 WAL 到 0(用于退出时彻底清理)
 * @returns {object} { busy, log, checkpointed }
 */
function checkpointWAL(mode = 'PASSIVE') {
  try {
    const row = db.pragma(`wal_checkpoint(${mode})`)
    return row
  } catch (err) {
    console.error('[数据库] WAL checkpoint 失败:', err.message)
    return { busy: 1, log: -1, checkpointed: -1 }
  }
}

/**
 * 启动 WAL 定时 checkpoint
 * 默认每 5 分钟跑一次 PASSIVE 模式,把 WAL 写回主库
 * @param {number} intervalMs 间隔毫秒,默认 300000(5 分钟)
 */
function startWalCheckpointTimer(intervalMs = 5 * 60 * 1000) {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer)
  }
  walCheckpointTimer = setInterval(() => {
    const r = checkpointWAL('PASSIVE')
    if (r.checkpointed > 0) {
      console.log(`[数据库] WAL 周期 checkpoint 完成: 写回 ${r.checkpointed} 页`)
    }
  }, intervalMs)
  // 让 timer 不阻塞进程退出
  if (walCheckpointTimer.unref) {
    walCheckpointTimer.unref()
  }
  console.log(`[数据库] WAL 定时 checkpoint 已启动(每 ${intervalMs / 1000}s 一次)`)
}

/**
 * 停止 WAL 定时 checkpoint(进程退出前调用)
 * 做 TRUNCATE 模式 checkpoint,把 WAL 文件截断到 0
 */
function stopWalCheckpointTimer() {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer)
    walCheckpointTimer = null
  }
  const r = checkpointWAL('TRUNCATE')
  console.log('[数据库] WAL 退出 checkpoint(TRUNCATE) 完成:', r)
}

/**
 * 执行建表 SQL
 */
function initSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  db.exec(sql)
  console.log('[数据库] Schema 初始化完成')
}

/**
 * 给已存在的表补新列
 * schema.sql 的 CREATE TABLE IF NOT EXISTS 不会改动已建好的表,
 * 老库(本机/服务器)只能靠这里补列,否则引用新列的查询会直接报错。
 */
const MISSING_COLUMNS = [
  ['rule_groups', 'last_hit_at', 'TEXT'],
  ['rule_groups', 'feedback_up', 'INTEGER'],
  ['rule_groups', 'feedback_down', 'INTEGER'],
  ['rule_groups', 'source_key', 'TEXT'],
  // 依据分档(判档规则见 services/evidenceLevels.js)；不设 DEFAULT，NULL 就是"未标注"
  ['rule_groups', 'evidence_level', 'TEXT'],
  ['recommendation_logs', 'input_snapshot', 'TEXT'],
  ['recommendation_logs', 'user_id', 'INTEGER'],
  ['recommendation_logs', 'store_id', 'INTEGER'],
  ['customer_sessions', 'store_id', 'INTEGER'],
  ['body_metrics', 'leg_length_cm', 'REAL'],
  ['body_metrics', 'shoulder_type', 'TEXT'],
  ['body_metrics', 'frame_size', 'TEXT'],
  ['body_metrics', 'line_quality', 'TEXT'],
  ['face_profiles', 'color_chroma', 'TEXT'],
  // 衣橱单品的版型与面料厚薄:上衣打分要吃的两格,老库不补列就只能判色名判不了剪裁
  ['user_wardrobe', 'fit_style', 'TEXT'],
  ['user_wardrobe', 'fabric_weight', 'TEXT'],
  // 八字五行(第二条判定依据)的输入;不填则整条依据缺席
  ['body_metrics', 'birth_date', 'TEXT'],
  ['body_metrics', 'birth_hour', 'TEXT'],
  // 管理员改密码后作废旧 Token 的锚点;老库不补列的话 verifyAdminToken 查它会直接报错
  ['admin_users', 'password_changed_at', 'INTEGER'],
  // 会话滚动活跃时间:users 原来只有 created_at,拿它判"过期"会把所有老账号一起踢掉,
  // 所以新加一列从现在开始记活跃(见 middleware/auth.js 的 getCurrentUser)。
  // 不设 DEFAULT:NULL＝"本轮迁移后还没观测过活跃",执法只能等下一轮数据攒够再开。
  ['users', 'last_active_at', 'TEXT'],
]

function initMissingColumns() {
  for (const [table, column, type] of MISSING_COLUMNS) {
    const exists = db
      .prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
      .get(table, column)
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      console.log(`[数据库] ${table} 已补列 ${column}`)
    }
  }
  // 新列的索引必须等补列完成后再建(schema.sql 跑在这之前)
  db.exec(
    'CREATE INDEX IF NOT EXISTS ix_recommendation_logs_user_id ON recommendation_logs(user_id)',
  )
  db.exec('CREATE INDEX IF NOT EXISTS ix_customer_sessions_store_id ON customer_sessions(store_id)')
  db.exec(
    'CREATE INDEX IF NOT EXISTS ix_recommendation_logs_store_id ON recommendation_logs(store_id)',
  )
  // 种子靠这个唯一标记判断"库里有没有这条规则";手工建的规则是 NULL,SQLite 允许 NULL 重复
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ix_rule_groups_source_key ON rule_groups(source_key)')
}

/**
 * 检查并导入种子数据
 */
function initSeedData() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM rule_groups').get()
  if (count.cnt > 0) {
    console.log(`[种子数据] 已有 ${count.cnt} 条规则组,跳过导入`)
    return
  }

  const seedPath = path.join(__dirname, 'seed.js')
  if (fs.existsSync(seedPath)) {
    try {
      const { seedAll } = require('./seed')
      seedAll(db)
      console.log('[种子数据] 导入完成')
    } catch (err) {
      console.error('[种子数据] 导入失败:', err.message)
    }
  } else {
    console.warn('[种子数据] seed.js 不存在,请运行 npm run seed')
  }
}

/**
 * 启动期增量应用新规则种子(db/seed/rules-*.json)
 * 只补库里没有的规则;后台改过优先级、关掉的规则一律不动。
 * 拉代码 + 重启即生效,不用碰库文件,也不需要跑全删重建的 seed.js。
 */
function initRuleSeedIncrement() {
  try {
    const { applyRuleSeeds } = require('./applyRuleSeeds')
    const stat = applyRuleSeeds(db)
    if (stat.checked === 0) return
    console.log(
      `[规则种子] 核对 ${stat.checked} 条:新增 ${stat.inserted} 条,已存在不动 ${stat.existing} 条` +
        (stat.rejected.length ? `,不合格未入库 ${stat.rejected.length} 条` : ''),
    )
    for (const reason of stat.rejected) {
      console.warn(`[规则种子] ✗ ${reason}`)
    }
  } catch (err) {
    console.error('[规则种子] 增量应用失败(不影响启动):', err.message)
  }
}

/**
 * 初始化管理员账号
 * 从环境变量 ADMIN_PASSWORD 读取密码
 */
function initAdminUser() {
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('admin')
  const password = process.env.ADMIN_PASSWORD

  if (!admin) {
    if (!password) {
      console.warn('[初始化] 未配置 ADMIN_PASSWORD,管理员账号未创建')
      return
    }
    const hash = bcrypt.hashSync(password, 10)
    db.prepare(
      'INSERT INTO admin_users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
    ).run('admin', hash, 'superadmin')
    console.log('[初始化] 已创建默认管理员账号 (admin)')
  } else if (password) {
    // 如果环境变量有密码且与当前不同,自动更新
    if (!bcrypt.compareSync(password, admin.password_hash)) {
      const hash = bcrypt.hashSync(password, 10)
      const changedAt = Math.floor(Date.now() / 1000)
      db.prepare(
        'UPDATE admin_users SET password_hash = ?, password_changed_at = ? WHERE username = ?',
      ).run(hash, changedAt, 'admin')
      console.log('[初始化] 已从环境变量更新管理员密码,签发早于此刻的旧 Token 全部作废')
    }
  }
}

/**
 * 扫描 models 目录,将新发现的 3D 模型自动入库
 */
function initModelConfigs() {
  const modelsDir = path.join(__dirname, '..', '..', 'models')
  if (!fs.existsSync(modelsDir)) {
    console.log('[模型初始化] models 目录不存在,跳过')
    return
  }

  const topDirs = fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !shouldSkipDir(d.name))

  let newCount = 0
  let total = 0
  let skipped = 0

  for (const dir of topDirs) {
    const { name, source } = parseFolderName(dir.name)
    const pmxFiles = findPmxFiles(path.join(modelsDir, dir.name), dir.name)

    for (const pmx of pmxFiles) {
      total++
      const existing = db
        .prepare('SELECT id FROM model_configs WHERE folder = ? AND file = ?')
        .get(pmx.relPath, pmx.fileName)

      if (!existing) {
        db.prepare(
          `INSERT INTO model_configs (name, icon, description, folder, file, source, enabled, exposure, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0.3, ?)`,
        ).run(
          name,
          ownValue(ICON_MAP, source) || '🎭',
          source + ' · ' + name,
          pmx.relPath,
          pmx.fileName,
          source,
          total,
        )
        newCount++
      } else {
        skipped++
      }
    }
  }

  console.log(`[模型初始化] 扫描完成:共 ${total} 个模型,新增 ${newCount} 个,已存在 ${skipped} 个`)
}

/**
 * 清理失效模型记录
 * 删除两类记录:
 * 1. folder 路径以 "残缺模型/" 开头(用户已手动归集到残缺文件夹)
 * 2. .pmx 文件实际不存在(用户已删除文件但数据库还有残留记录)
 *
 * @returns {{ removedBroken: number, removedMissing: number }}
 */
function cleanupMissingModels() {
  const modelsDir = path.join(__dirname, '..', '..', 'models')
  let removedBroken = 0
  let removedMissing = 0

  // 目录整体缺失时不能往下走:下面的逐行判定会把每一条记录都算成"文件缺失",
  // 一次启动就把 model_configs 删空。缺目录只可能是挂载没挂上或模型没搬过来,
  // 属于环境问题而不是数据脏,所以直接跳过并原样返回计数的形状。
  if (!fs.existsSync(modelsDir)) {
    console.log('[模型清理] models 目录不存在,跳过清理(不删除任何记录)')
    return { removedBroken, removedMissing }
  }

  // 1. 删除已归入"残缺模型"文件夹的记录
  const brokenRows = db
    .prepare(`SELECT id, name, folder FROM model_configs WHERE folder = ? OR folder LIKE ?`)
    .all(BROKEN_DIR_NAME, BROKEN_DIR_NAME + '/%')
  if (brokenRows.length > 0) {
    const delBroken = db.prepare(
      `DELETE FROM model_configs WHERE id IN (${brokenRows.map(() => '?').join(',')})`,
    )
    delBroken.run(...brokenRows.map((r) => r.id))
    removedBroken = brokenRows.length
    console.log(`[模型清理] 已删除 ${removedBroken} 条残缺模型记录:`)
    brokenRows.forEach((r) => console.log(`  - ${r.name} (${r.folder})`))
  }

  // 2. 删除 .pmx 文件实际不存在的记录
  const allRows = db.prepare('SELECT id, name, folder, file FROM model_configs').all()
  const missingIds = []
  for (const row of allRows) {
    const fullPath = path.join(modelsDir, row.folder, row.file)
    if (!fs.existsSync(fullPath)) {
      missingIds.push(row.id)
      console.log(`  - 文件缺失: ${row.name} (${row.folder}/${row.file})`)
    }
  }
  if (missingIds.length > 0) {
    const delMissing = db.prepare(
      `DELETE FROM model_configs WHERE id IN (${missingIds.map(() => '?').join(',')})`,
    )
    delMissing.run(...missingIds)
    removedMissing = missingIds.length
    console.log(`[模型清理] 已删除 ${removedMissing} 条文件缺失记录`)
  }

  if (removedBroken === 0 && removedMissing === 0) {
    console.log('[模型清理] 无需清理,所有记录均有效')
  }

  return { removedBroken, removedMissing }
}

/**
 * 清理过期的顾客临时会话数据(隐私保护)
 */
function cleanupExpiredSessions() {
  const now = new Date().toISOString()
  const result = db
    .prepare(`DELETE FROM customer_sessions WHERE expires_at < ? AND synced = 0`)
    .run(now)
  if (result.changes > 0) {
    console.log(`[隐私清理] 已删除 ${result.changes} 条过期顾客会话数据`)
  }
}

/**
 * 启动过期会话定时清理
 * 隐私声明承诺"超时后自动清除",只在启动时清一次等于没清(进程不重启就永远不清)。
 * 已同步到门店的行不在这里删:身份字段在同步当场剥掉了,行本身留着顾客才还能走
 * DELETE /session/:id 把门店那条记录一并删掉(删了行就 404,删除权反而没了)。
 * @param {number} intervalMs 间隔毫秒,默认 600000(10 分钟)
 */
function startSessionCleanupTimer(intervalMs = 10 * 60 * 1000) {
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer)
  }
  sessionCleanupTimer = setInterval(() => {
    try {
      cleanupExpiredSessions()
    } catch (err) {
      console.error('[隐私清理] 定时清理失败:', err.message)
    }
  }, intervalMs)
  if (sessionCleanupTimer.unref) {
    sessionCleanupTimer.unref()
  }
  console.log(`[隐私清理] 过期会话定时清理已启动(每 ${intervalMs / 1000}s 一次)`)
}

/**
 * 初始化所有
 */
function initAll() {
  initSchema()
  initMissingColumns()
  initSeedData()
  initRuleSeedIncrement()
  initModelConfigs()
  // ★ 启动时清理失效模型记录:
  // - 用户已移入"残缺模型"文件夹的
  // - .pmx 文件已不存在的
  cleanupMissingModels()
  initAdminUser()
  cleanupExpiredSessions()
  // 启动 WAL 定时 checkpoint
  startWalCheckpointTimer()
  // 隐私声明写了"超时后自动清除",所以清理必须周期跑,不能只在启动时清一次
  startSessionCleanupTimer()
}

// 模块加载时自动执行初始化
initAll()

module.exports = db
// 导出 WAL 控制函数供 server.js 退出时调用
module.exports.checkpointWAL = checkpointWAL
module.exports.startWalCheckpointTimer = startWalCheckpointTimer
module.exports.stopWalCheckpointTimer = stopWalCheckpointTimer

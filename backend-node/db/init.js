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

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const {
  SOURCE_MAP,
  ICON_MAP,
  findPmxFiles,
  parseFolderName,
  shouldSkipDir,
  BROKEN_DIR_NAME,
} = require('../utils/model-utils');

// 数据库文件路径:backend-node/db/styleai.db(容器内整个 db/ 目录挂载,不用单文件挂载)
const DB_PATH = path.join(__dirname, 'styleai.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// 打开数据库(同时设置 WAL 模式)
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

// WAL checkpoint 定时器句柄(由 server.js 在退出时清理)
let walCheckpointTimer = null;

/**
 * 执行 WAL checkpoint
 * @param {'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'} mode
 *   - PASSIVE: 不阻塞读写,可能留下部分 WAL
 *   - TRUNCATE: 强制截断 WAL 到 0(用于退出时彻底清理)
 * @returns {object} { busy, log, checkpointed }
 */
function checkpointWAL(mode = 'PASSIVE') {
  try {
    const row = db.pragma(`wal_checkpoint(${mode})`);
    return row;
  } catch (err) {
    console.error('[数据库] WAL checkpoint 失败:', err.message);
    return { busy: 1, log: -1, checkpointed: -1 };
  }
}

/**
 * 启动 WAL 定时 checkpoint
 * 默认每 5 分钟跑一次 PASSIVE 模式,把 WAL 写回主库
 * @param {number} intervalMs 间隔毫秒,默认 300000(5 分钟)
 */
function startWalCheckpointTimer(intervalMs = 5 * 60 * 1000) {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
  }
  walCheckpointTimer = setInterval(() => {
    const r = checkpointWAL('PASSIVE');
    if (r.checkpointed > 0) {
      console.log(`[数据库] WAL 周期 checkpoint 完成: 写回 ${r.checkpointed} 页`);
    }
  }, intervalMs);
  // 让 timer 不阻塞进程退出
  if (walCheckpointTimer.unref) {
    walCheckpointTimer.unref();
  }
  console.log(`[数据库] WAL 定时 checkpoint 已启动(每 ${intervalMs / 1000}s 一次)`);
}

/**
 * 停止 WAL 定时 checkpoint(进程退出前调用)
 * 做 TRUNCATE 模式 checkpoint,把 WAL 文件截断到 0
 */
function stopWalCheckpointTimer() {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
    walCheckpointTimer = null;
  }
  const r = checkpointWAL('TRUNCATE');
  console.log('[数据库] WAL 退出 checkpoint(TRUNCATE) 完成:', r);
}

/**
 * 执行建表 SQL
 */
function initSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(sql);
  console.log('[数据库] Schema 初始化完成');
}

/**
 * 检查并导入种子数据
 */
function initSeedData() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM rule_groups').get();
  if (count.cnt > 0) {
    console.log(`[种子数据] 已有 ${count.cnt} 条规则组,跳过导入`);
    return;
  }

  const seedPath = path.join(__dirname, 'seed.js');
  if (fs.existsSync(seedPath)) {
    try {
      const { seedAll } = require('./seed');
      seedAll(db);
      console.log('[种子数据] 导入完成');
    } catch (err) {
      console.error('[种子数据] 导入失败:', err.message);
    }
  } else {
    console.warn('[种子数据] seed.js 不存在,请运行 npm run seed');
  }
}

/**
 * 初始化管理员账号
 * 从环境变量 ADMIN_PASSWORD 读取密码
 */
function initAdminUser() {
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('admin');
  const password = process.env.ADMIN_PASSWORD;

  if (!admin) {
    if (!password) {
      console.warn('[初始化] 未配置 ADMIN_PASSWORD,管理员账号未创建');
      return;
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO admin_users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
    ).run('admin', hash, 'superadmin');
    console.log('[初始化] 已创建默认管理员账号 (admin)');
  } else if (password) {
    // 如果环境变量有密码且与当前不同,自动更新
    if (!bcrypt.compareSync(password, admin.password_hash)) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, 'admin');
      console.log('[初始化] 已从环境变量更新管理员密码');
    }
  }
}

/**
 * 扫描 models 目录,将新发现的 3D 模型自动入库
 */
function initModelConfigs() {
  const modelsDir = path.join(__dirname, '..', '..', 'models');
  if (!fs.existsSync(modelsDir)) {
    console.log('[模型初始化] models 目录不存在,跳过');
    return;
  }

  const topDirs = fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !shouldSkipDir(d.name));

  let newCount = 0;
  let total = 0;
  let skipped = 0;

  for (const dir of topDirs) {
    const { name, source } = parseFolderName(dir.name);
    const pmxFiles = findPmxFiles(path.join(modelsDir, dir.name), dir.name);

    for (const pmx of pmxFiles) {
      total++;
      const existing = db
        .prepare('SELECT id FROM model_configs WHERE folder = ? AND file = ?')
        .get(pmx.relPath, pmx.fileName);

      if (!existing) {
        db.prepare(
          `INSERT INTO model_configs (name, icon, description, folder, file, source, enabled, exposure, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0.3, ?)`,
        ).run(
          name,
          ICON_MAP[source] || '🎭',
          source + ' · ' + name,
          pmx.relPath,
          pmx.fileName,
          source,
          total,
        );
        newCount++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`[模型初始化] 扫描完成:共 ${total} 个模型,新增 ${newCount} 个,已存在 ${skipped} 个`);
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
  const modelsDir = path.join(__dirname, '..', '..', 'models');
  let removedBroken = 0;
  let removedMissing = 0;

  // 1. 删除已归入"残缺模型"文件夹的记录
  const brokenRows = db
    .prepare(`SELECT id, name, folder FROM model_configs WHERE folder = ? OR folder LIKE ?`)
    .all(BROKEN_DIR_NAME, BROKEN_DIR_NAME + '/%');
  if (brokenRows.length > 0) {
    const delBroken = db.prepare(`DELETE FROM model_configs WHERE id IN (${brokenRows.map(() => '?').join(',')})`);
    delBroken.run(...brokenRows.map((r) => r.id));
    removedBroken = brokenRows.length;
    console.log(`[模型清理] 已删除 ${removedBroken} 条残缺模型记录:`);
    brokenRows.forEach((r) => console.log(`  - ${r.name} (${r.folder})`));
  }

  // 2. 删除 .pmx 文件实际不存在的记录
  const allRows = db.prepare('SELECT id, name, folder, file FROM model_configs').all();
  const missingIds = [];
  for (const row of allRows) {
    const fullPath = path.join(modelsDir, row.folder, row.file);
    if (!fs.existsSync(fullPath)) {
      missingIds.push(row.id);
      console.log(`  - 文件缺失: ${row.name} (${row.folder}/${row.file})`);
    }
  }
  if (missingIds.length > 0) {
    const delMissing = db.prepare(`DELETE FROM model_configs WHERE id IN (${missingIds.map(() => '?').join(',')})`);
    delMissing.run(...missingIds);
    removedMissing = missingIds.length;
    console.log(`[模型清理] 已删除 ${removedMissing} 条文件缺失记录`);
  }

  if (removedBroken === 0 && removedMissing === 0) {
    console.log('[模型清理] 无需清理,所有记录均有效');
  }

  return { removedBroken, removedMissing };
}

/**
 * 清理过期的顾客临时会话数据(隐私保护)
 */
function cleanupExpiredSessions() {
  const now = new Date().toISOString();
  const result = db
    .prepare(`DELETE FROM customer_sessions WHERE expires_at < ? AND synced = 0`)
    .run(now);
  if (result.changes > 0) {
    console.log(`[隐私清理] 已删除 ${result.changes} 条过期顾客会话数据`);
  }
}

/**
 * 初始化所有
 */
function initAll() {
  initSchema();
  initSeedData();
  initModelConfigs();
  // ★ 启动时清理失效模型记录:
  // - 用户已移入"残缺模型"文件夹的
  // - .pmx 文件已不存在的
  cleanupMissingModels();
  initAdminUser();
  cleanupExpiredSessions();
  // 启动 WAL 定时 checkpoint
  startWalCheckpointTimer();
}

// 模块加载时自动执行初始化
initAll();

module.exports = db;
// 导出 WAL 控制函数供 server.js 退出时调用
module.exports.checkpointWAL = checkpointWAL;
module.exports.startWalCheckpointTimer = startWalCheckpointTimer;
module.exports.stopWalCheckpointTimer = stopWalCheckpointTimer;

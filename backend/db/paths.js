/**
 * 数据库文件路径的唯一出口:默认 backend/db/styleai.db,可用 STYLEAI_DB_PATH 覆盖。
 *
 * 收敛前这个路径在 6 个文件里各自 path.join(__dirname, ...) 拼一遍。拼错一层不会报错:
 * SQLite 对着不存在的路径静默新建一个空库,迁移脚本就着空表"成功"跑完——没堆栈没告警,最难查。
 * env 覆盖口是给运维用的:校验线上备份、对只读副本跑分析脚本(见 scripts/rebuild-db.js)。
 */
const path = require('path')

const DEFAULT_DB_PATH = path.join(__dirname, 'styleai.db')

/** 相对路径按当前工作目录解析,归一后再进日志和备份文件名 */
const DB_PATH = process.env.STYLEAI_DB_PATH
  ? path.resolve(process.env.STYLEAI_DB_PATH)
  : DEFAULT_DB_PATH

/**
 * backend/db/styleai.db 是公开脱敏快照，不是运行库。
 * 没显式指定 STYLEAI_DB_PATH 就拒绝打开，挡在 new Database 之前，避免 schema、管理员和模型扫描写坏快照。
 */
function assertRuntimeDbPath() {
  if (!process.env.STYLEAI_DB_PATH && path.resolve(DB_PATH) === path.resolve(DEFAULT_DB_PATH)) {
    throw new Error(
      '拒绝写入公开演示快照 backend/db/styleai.db；请通过 STYLEAI_DB_PATH 指向独立运行库',
    )
  }
}

module.exports = { DB_PATH, DEFAULT_DB_PATH, assertRuntimeDbPath }

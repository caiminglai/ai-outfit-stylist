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

module.exports = { DB_PATH }

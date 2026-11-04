/**
 * 日志工具 - 同时输出到控制台和文件,按日期轮转,保留最近 7 天
 *
 * 用法:
 *   const { log, error, warn } = require('./utils/logger')
 *   log('服务启动')          // 等同 console.log,同时写文件
 *   warn('要留意')           // 等同 console.warn,文件里带 [WARN]
 *   error('出错了', err)     // 等同 console.error,同时写文件
 *
 * 为什么应用代码不许直接调 console.*：console 只把字打到 stdout/stderr，容器里那份输出
 * 谁在收、留多久都不由本项目定；而 logs/server-YYYY-MM-DD.log 是本机与容器都保证留 7 天、
 * 按北京日切的那一份。catch 里的报错走 console.error 等于"当场打印即销毁"，事后按订单号
 * 或用户查不到任何痕迹。11-03 之前 routes 里有 160 处就是这个状态（判据与收口见
 * `docs/依据/06-查证记录与负向结果.md` 的日志归口条目，纪律由
 * `test/loggerDiscipline.test.js` 兜）。
 */

const fs = require('fs')
const path = require('path')
const { beijingParts, beijingDateStr } = require('./beijingTime')

const LOG_DIR = path.join(__dirname, '..', 'logs')
const MAX_DAYS = 7 // 日志保留天数

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

// 上次清理日期(每天清理一次旧日志)
let lastCleanupDate = ''

/**
 * 获取当天日志文件名
 *
 * 按**北京日**切，不按容器日：容器 TZ 实测是 UTC ⇒ 原来 `new Date().getDate()`
 * 要到 UTC 零点（北京 08:00）才换文件，北京时间 00:00~07:59 这 8 小时的请求
 * 全落进**前一天**那个 server-*.log 里，按日期查日志会查不到人。
 * 现在文件名、行首时间戳、清理基准三处都用东八区，口径一致。
 * @returns {string} 形如 server-2026-08-02.log
 */
function getTodayFileName() {
  return `server-${beijingDateStr()}.log`
}

/** 行首时间戳：'YYYY-MM-DD HH:mm:ss'（东八区） */
function logTimeStamp(at = new Date()) {
  const p = beijingParts(at)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/**
 * 清理超过 MAX_DAYS 天的旧日志文件
 */
function cleanupOldLogs() {
  const today = beijingDateStr()
  if (lastCleanupDate === today) return // 今天已清理过
  lastCleanupDate = today

  try {
    const files = fs.readdirSync(LOG_DIR)
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000
    for (const file of files) {
      if (!file.startsWith('server-') || !file.endsWith('.log')) continue
      const filePath = path.join(LOG_DIR, file)
      const stat = fs.statSync(filePath)
      if (stat.mtime.getTime() < cutoff) {
        fs.unlinkSync(filePath)
      }
    }
  } catch {
    // 清理失败不影响主流程
  }
}

/**
 * 写入日志文件(追加模式)
 * @param {string} message - 日志内容
 */
function writeToFile(message) {
  const fileName = getTodayFileName()
  const filePath = path.join(LOG_DIR, fileName)
  // 行首时间戳跟文件名同一个日子（都用东八区）。原来这里还是 toISOString() 的 UTC，
  // 一改日切口径就会出现"00:30 的北京日志写在 server-当天.log 里、行首却写着昨天 16:30"
  // 这种对不上的行，按时间排日志的人会被绕晕。
  const line = `[${logTimeStamp()}] ${message}\n`
  try {
    fs.appendFileSync(filePath, line)
  } catch {
    // 写文件失败不影响主流程
  }
}

/**
 * 把一个日志参数压成一行文本。
 * JSON.stringify 在两种值上是同步抛的：BigInt（"Do not JSON stringify BigInt"）和
 * 自引用对象（converting circular structure）。原来这个调用写在 writeToFile 的
 * try/catch 之外（那里只兜 appendFileSync）⇒ 请求里 log() 一个带 BigInt 的库对象
 * 就把 handler 炸成 500，而日志本该是"写不上就算了"的东西。
 * 序列化失败退回 String(a)，主流程不受影响。
 */
function safeText(a) {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/**
 * 普通日志 - 同时输出到控制台和文件
 * @param {...any} args - 日志内容(与 console.log 用法一致)
 */
function log(...args) {
  console.log(...args)
  // 拼接参数为字符串写入文件(处理对象)
  const message = args.map(safeText).join(' ')
  writeToFile(message)
  cleanupOldLogs()
}

/**
 * 告警日志 - 输出到控制台(stderr)并写文件,带 [WARN] 标记
 *
 * 为什么单开一个通道而不是并进 [ERROR]：查问题时第一件事是按级别过滤，
 * 把"配额快用完了"和"下单炸了"洗成同一个 [ERROR] 就把那一步做没了。
 * @param {...any} args - 日志内容
 */
function warn(...args) {
  console.warn(...args)
  const message = args.map(safeText).join(' ')
  writeToFile('[WARN] ' + message)
  cleanupOldLogs()
}

/**
 * 错误日志 - 同时输出到控制台(stderr)和文件
 * @param {...any} args - 日志内容
 */
function error(...args) {
  console.error(...args)
  const message = args.map(safeText).join(' ')
  writeToFile('[ERROR] ' + message)
  cleanupOldLogs()
}

module.exports = { log, warn, error, LOG_DIR, getTodayFileName, logTimeStamp }

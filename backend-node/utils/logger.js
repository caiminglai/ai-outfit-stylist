/**
 * 日志工具 - 同时输出到控制台和文件,按日期轮转,保留最近 7 天
 *
 * 用法:
 *   const { log, error } = require('./utils/logger')
 *   log('服务启动')          // 等同 console.log,同时写文件
 *   error('出错了', err)     // 等同 console.error,同时写文件
 */

const fs = require('fs')
const path = require('path')

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
 * @returns {string} 形如 server-2026-08-02.log
 */
function getTodayFileName() {
  const now = new Date()
  const dateStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0')
  return `server-${dateStr}.log`
}

/**
 * 清理超过 MAX_DAYS 天的旧日志文件
 */
function cleanupOldLogs() {
  const today = new Date().toISOString().slice(0, 10)
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
  } catch (e) {
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
  const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${timeStr}] ${message}\n`
  try {
    fs.appendFileSync(filePath, line)
  } catch (e) {
    // 写文件失败不影响主流程
  }
}

/**
 * 普通日志 - 同时输出到控制台和文件
 * @param {...any} args - 日志内容(与 console.log 用法一致)
 */
function log(...args) {
  console.log(...args)
  // 拼接参数为字符串写入文件(处理对象)
  const message = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')
  writeToFile(message)
  cleanupOldLogs()
}

/**
 * 错误日志 - 同时输出到控制台(stderr)和文件
 * @param {...any} args - 日志内容
 */
function error(...args) {
  console.error(...args)
  const message = args.map(a =>
    typeof a === 'string' ? a : (a instanceof Error ? a.stack : JSON.stringify(a))
  ).join(' ')
  writeToFile('[ERROR] ' + message)
  cleanupOldLogs()
}

module.exports = { log, error, LOG_DIR }

/**
 * 共享工具函数
 * 消除 routes 中 generateUUID / uploads 目录检查的重复代码
 */
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

/** 生成 UUID v4 */
function generateUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.randomBytes(1)[0] & 0x0f
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** uploads 目录路径 */
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')

/** 确保 uploads 目录存在 */
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

// 模块加载时自动创建
ensureUploadDir()

/**
 * 解析分页参数
 * @param {object} query - req.query
 * @returns {{page: number, limit: number, offset: number, paginated: boolean}}
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const paginated = query.page !== undefined || query.limit !== undefined
  return { page, limit, offset, paginated }
}

module.exports = {
  generateUUID,
  UPLOAD_DIR,
  ensureUploadDir,
  parsePagination,
  getSessionId,
  parseJsonField,
  getCurrentSeason,
  normalizeItem,
}

// ============================================================
// 以下函数供各路由模块共享使用，消除重复定义
// ============================================================

/**
 * 从请求头获取 Session ID（X-Session-Id），也支持请求体中的 session_id
 */
function getSessionId(req) {
  const sid = req.headers['x-session-id']
  if (sid && sid.trim()) return sid.trim()
  const body = req.body || {}
  return body.session_id || null
}

/**
 * 安全解析 JSON 字段（参数可能是字符串或已解析对象）
 */
function parseJsonField(val) {
  if (typeof val !== 'string') return val
  try {
    return JSON.parse(val)
  } catch {
    return val
  }
}

/**
 * 获取当前季节
 */
function getCurrentSeason() {
  const m = new Date().getMonth() + 1
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

/**
 * 规整化数据行：解析 JSON 标签字段
 * @param {object} row - 数据库行
 * @param {string[]} tagFields - 需要 JSON.parse 的字段名列表
 */
function normalizeItem(row, tagFields) {
  const defaults = [
    'style_tags',
    'color_tags',
    'season_tags',
    'occasion_tags',
    'fit_skin_tones',
    'fit_face_shapes',
    'fit_body_types',
    'skin_tone_fit',
    'skin_type_fit',
    'face_shape_fit',
    'eye_shape_fit',
    'lip_shape_fit',
    'neck_length_fit',
  ]
  const fields = tagFields || defaults
  const item = { ...row }
  for (const f of fields) {
    if (typeof item[f] === 'string') {
      try {
        item[f] = JSON.parse(item[f])
      } catch {
        /* 保持原始值 */
      }
    }
  }
  return item
}

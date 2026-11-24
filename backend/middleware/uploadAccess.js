/**
 * 上传文件访问与 URL 生命周期中间件。
 *
 * - uploadAccess：公开文件直接下发，私有文件先验 HMAC + 过期时间。
 * - stripUploadUrlQueries：路由前剥离请求体上传 URL 的查询串，避免签名回存。
 * - signUploadJsonResponses：JSON 出参把私有上传 URL 换成新的签名 URL。
 */
const fs = require('node:fs')
const path = require('node:path')
const { UPLOAD_DIR } = require('../utils/common')
const { sendError } = require('../utils/response')
const {
  signUploadUrl,
  verifyUploadToken,
  isPublicUpload,
  isOwnedUpload,
  isValidFilename,
} = require('../utils/uploads')
const { getCurrentUser, verifyAdminToken } = require('./auth')
const { log: logMsg, error: logErr } = require('../utils/logger')

const UPLOAD_URL_RE = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:[?#].*)?$/
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function uploadFilename(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(UPLOAD_URL_RE)
  return match && isValidFilename(match[1]) ? match[1] : null
}

function mapUploadUrls(value, transform) {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((item) => mapUploadUrls(item, transform))
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    // Date/Buffer 等对象保留给 JSON.stringify 自己处理；只复制普通业务对象。
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapUploadUrls(item, transform)]),
    )
  }
  return value
}

/** 递归清洗解析后的请求体；不改 req.rawBody，支付验签原文因此保持逐字节不变。 */
function stripUploadUrlQueries(req, res, next) {
  let invalidUploadUrl = false
  req.body = mapUploadUrls(req.body, (value) => {
    const filename = uploadFilename(value)
    if (filename) return `/uploads/${filename}`
    if (typeof value === 'string' && value.trim().startsWith('/uploads/')) invalidUploadUrl = true
    return value
  })
  if (invalidUploadUrl) return sendError(res, '非法上传文件路径', 400)
  next()
}

/** 给 JSON 响应中的本人私有上传 URL 自动签名；后台有效 Bearer 可读取全部文件。 */
function signUploadJsonResponses(_req, res, next) {
  const originalJson = res.json
  res.json = function signedJson(body) {
    const publicCache = new Map()
    const ownershipCache = new Map()
    const user = _req.user || getCurrentUser(_req)
    const authHeader = _req.headers?.authorization || ''
    const isAdmin =
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ') &&
      verifyAdminToken(authHeader.slice(7))
    const signedBody = mapUploadUrls(body, (value) => {
      const filename = uploadFilename(value)
      if (!filename) return value
      if (!publicCache.has(filename)) publicCache.set(filename, isPublicUpload(filename))
      if (publicCache.get(filename)) return value
      if (!ownershipCache.has(filename)) {
        ownershipCache.set(filename, isAdmin || isOwnedUpload(filename, user?.id))
      }
      return ownershipCache.get(filename) ? signUploadUrl(filename) : value
    })
    return originalJson.call(this, signedBody)
  }
  next()
}

/**
 * 创建 /uploads/:filename 访问处理器。
 * @param {object} [options]
 * @param {string} [options.uploadDir] 上传目录，默认 backend/uploads
 * @param {object} [options.database] 真实 SQLite 连接，默认 db/init
 * @param {Function} [options.now] 返回 epoch 秒，供确定性测试注入
 */
function uploadAccess(options = {}) {
  const uploadDir = options.uploadDir || UPLOAD_DIR
  const database = options.database
  const now = options.now || (() => Math.floor(Date.now() / 1000))

  return function uploadAccessHandler(req, res, _next) {
    const filename = req.params.filename
    const safeName = path.basename(filename)
    if (safeName !== filename || filename.length > 255 || !FILENAME_RE.test(filename)) {
      return sendError(res, '非法文件路径', 400)
    }

    const isPublic = isPublicUpload(filename, database)
    if (!isPublic) {
      const { expires, signature } = req.query
      if (typeof expires !== 'string' || typeof signature !== 'string') {
        return sendError(res, '私有文件需要有效签名', 401)
      }
      if (!verifyUploadToken(filename, `${expires}.${signature}`, now())) {
        return sendError(res, '文件签名无效或已过期', 401)
      }
    }

    const filePath = path.join(uploadDir, safeName)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      logErr(`[上传文件] MISS GET /uploads/${safeName} ip=${req.ip}`)
      return sendError(res, '文件不存在', 404)
    }

    logMsg(`[上传文件] GET /uploads/${safeName} ip=${req.ip}`)
    res.setHeader('Cache-Control', isPublic ? 'public, max-age=300' : 'private, no-store')
    return res.sendFile(filePath, { cacheControl: false, lastModified: false })
  }
}

module.exports = { uploadAccess, stripUploadUrlQueries, signUploadJsonResponses }

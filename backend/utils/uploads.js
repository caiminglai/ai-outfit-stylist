/**
 * 上传文件访问签名。
 *
 * 令牌格式为 <expires>.<hmac>，HMAC 输入同时绑定文件名与 epoch 秒过期时间。
 * 默认有效期 1 小时；过期边界本身不可用（expires <= now 即拒绝）。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { UPLOAD_DIR } = require('./common')

const DEFAULT_EXPIRES_IN_SECONDS = 3600
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SIGNATURE_RE = /^[a-f0-9]{64}$/i

const PUBLIC_UPLOAD_QUERIES = {
  creator: `SELECT 1 FROM creator_works WHERE status = 'approved' AND cover_url = ?
            UNION ALL
            SELECT 1 FROM creator_works WHERE status = 'approved' AND cover_url GLOB ?
            LIMIT 1`,
  product: `SELECT 1 FROM inventory_products
            WHERE image_url = ? OR image_url GLOB ?
            LIMIT 1`,
}

function isValidFilename(filename) {
  return typeof filename === 'string' && filename.length <= 255 && FILENAME_RE.test(filename)
}

function getSecret() {
  const secret = process.env.SECRET_KEY
  if (!secret) throw new Error('SECRET_KEY 未配置，无法签发上传文件令牌')
  return secret
}

function expectedSignature(filename, expiresAt) {
  return crypto.createHmac('sha256', getSecret()).update(`${filename}\n${expiresAt}`).digest('hex')
}

/**
 * 把私有上传路径签成带过期时间的 URL。
 * @param {string} filename uploads 目录下的单层文件名
 * @param {number} expiresInSeconds 有效期秒数，默认 3600
 * @returns {string} /uploads/<filename>?expires=...&signature=...
 */
function signUploadUrl(filename, expiresInSeconds = DEFAULT_EXPIRES_IN_SECONDS) {
  if (!isValidFilename(filename)) throw new Error('非法上传文件名')
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 0) {
    throw new Error('上传令牌有效期必须是非负整数秒')
  }
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
  if (!Number.isSafeInteger(expiresAt)) throw new Error('上传令牌过期时间超出范围')
  const signature = expectedSignature(filename, expiresAt)
  return `/uploads/${filename}?expires=${expiresAt}&signature=${signature}`
}

/**
 * 验证单文件令牌。now 使用 epoch 秒，便于测试注入确定时间。
 * @returns {boolean}
 */
function verifyUploadToken(filename, token, now = Math.floor(Date.now() / 1000)) {
  if (!isValidFilename(filename) || typeof token !== 'string' || !Number.isFinite(now)) {
    return false
  }
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [expiresText, signature] = parts
  if (!/^\d+$/.test(expiresText) || !SIGNATURE_RE.test(signature)) return false

  const expiresAt = Number(expiresText)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return false
  if (expiresAt <= Math.floor(now)) return false

  let expected
  try {
    expected = expectedSignature(filename, expiresAt)
  } catch {
    return false
  }
  const providedBuffer = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (providedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

function referencePatterns(reference) {
  // GLOB 区分大小写且支持 [?#] 字符类，可同时匹配精确引用和 ?/# 后缀，
  // 并让 SQLite 使用 BINARY 索引的前缀搜索；LIKE 的方括号没有字符类语义。
  return [`${reference}[?#]*`]
}

/** 登记服务端上传文件的所有权；客户端可编辑的 URL 字段不能调用此函数自证归属。 */
function registerUpload(filename, userId, database) {
  if (!isValidFilename(filename) || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('非法上传文件或用户')
  }
  const db = database || require('../db/init')
  db.prepare('INSERT OR IGNORE INTO upload_files (filename, user_id) VALUES (?, ?)').run(
    filename,
    userId,
  )
}

/** 只读所有权台账；查询失败或未登记均按未授权处理。 */
function isOwnedUpload(filename, userId, database) {
  if (!isValidFilename(filename) || !Number.isSafeInteger(userId) || userId <= 0) return false
  try {
    const db = database || require('../db/init')
    return Boolean(
      db
        .prepare('SELECT 1 FROM upload_files WHERE filename = ? AND user_id = ?')
        .get(filename, userId),
    )
  } catch {
    return false
  }
}

/** 从 /uploads/<filename> 引用中取单层文件名；外链、路径穿越和畸形引用一律拒绝。 */
function filenameFromUploadReference(reference) {
  if (typeof reference !== 'string') return null
  const match = /^\/uploads\/([^/]+)$/.exec(reference.split(/[?#]/, 1)[0])
  return match && isValidFilename(match[1]) ? match[1] : null
}

// 删除前检查所有真实的上传 URL 引用列。用户可编辑引用不能证明所有权，但必须阻止
// 删除他人仍在使用的文件；deposits / inventory_products 也可能跨档案保留。
const UPLOAD_REFERENCE_COLUMNS = [
  ['photos', 'url'],
  ['tryon_results', 'result_url'],
  ['user_wardrobe', 'image_url'],
  ['user_cosmetics', 'image_url'],
  ['user_accessories', 'image_url'],
  ['creator_works', 'cover_url'],
  ['clothing_items', 'image_url'],
  ['inventory_products', 'image_url'],
  ['deposits', 'proof_url'],
  ['model_configs', 'image_preview'],
]

function hasUploadReference(filename, database) {
  if (!isValidFilename(filename)) return true
  const db = database || require('../db/init')
  const reference = `/uploads/${filename}`
  const [queryPattern] = referencePatterns(reference)
  const clauses = []
  const params = []
  for (const [table, column] of UPLOAD_REFERENCE_COLUMNS) {
    clauses.push(`EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ? OR ${column} GLOB ?)`)
    params.push(reference, queryPattern)
  }
  clauses.push('EXISTS (SELECT 1 FROM clothing_items WHERE filename = ?)')
  params.push(filename)
  return Boolean(db.prepare(`SELECT 1 WHERE ${clauses.join(' OR ')}`).get(...params))
}

/**
 * 删除本人所有且已无业务引用的文件与台账。
 * 文件系统先于台账删除：unlink 失败时调用方事务可回滚业务行与台账，不能假报成功。
 * 返回值 shared=true 表示文件仍被其他记录使用，业务行可删，但文件与台账必须保留。
 */
function deleteOwnedUpload(filename, userId, database) {
  if (!isValidFilename(filename)) throw new Error('非法上传文件名，拒绝清理')
  const db = database || require('../db/init')
  if (!isOwnedUpload(filename, userId, db)) return { deleted: false, shared: false }
  if (hasUploadReference(filename, db)) return { deleted: false, shared: true }

  const filepath = path.join(UPLOAD_DIR, filename)
  try {
    fs.unlinkSync(filepath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const failure = new Error('上传文件删除失败，未完成全部清理，请重试或联系管理员')
      failure.code = 'UPLOAD_FILE_DELETE_FAILED'
      throw failure
    }
  }
  db.prepare('DELETE FROM upload_files WHERE filename = ? AND user_id = ?').run(filename, userId)
  return { deleted: true, shared: false }
}

/**
 * 公开上传：public- 前缀、已审核作品封面、后台商品图；其余一律私有。
 * database 可注入，独立测试不需要打开运行库；查询失败时按私有处理。
 */
function isPublicUpload(filename, database) {
  if (!isValidFilename(filename)) return false
  if (filename.startsWith('public-')) return true

  let db
  try {
    db = database || require('../db/init')
    const reference = `/uploads/${filename}`
    const [queryPattern] = referencePatterns(reference)
    const creatorCover = db.prepare(PUBLIC_UPLOAD_QUERIES.creator).get(reference, queryPattern)
    if (creatorCover) return true
    const productImage = db.prepare(PUBLIC_UPLOAD_QUERIES.product).get(reference, queryPattern)
    return Boolean(productImage)
  } catch {
    return false
  }
}

module.exports = {
  signUploadUrl,
  verifyUploadToken,
  isPublicUpload,
  isOwnedUpload,
  registerUpload,
  isValidFilename,
  filenameFromUploadReference,
  deleteOwnedUpload,
  hasUploadReference,
  PUBLIC_UPLOAD_QUERIES,
}

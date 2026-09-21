/**
 * 文件上传校验中间件
 * 扩展名 + magic bytes 双重校验
 */

const path = require('path')
const multer = require('multer')

// 允许的图片扩展名
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

// 图片文件头 magic bytes
const IMAGE_MAGIC = [
  { magic: Buffer.from([0xff, 0xd8, 0xff]), ext: 'jpg' },
  { magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]), ext: 'png' },
  { magic: Buffer.from('RIFF'), ext: 'webp', extra: 'WEBP' },
]

/**
 * 校验文件是否为合法图片
 * @param {Express.Multer.File} file
 * @returns {{ valid: boolean, error?: string }}
 */
function validateImage(file) {
  if (!file) return { valid: false, error: '未收到文件' }

  // 1. 扩展名校验
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `不支持的文件类型，仅支持: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
    }
  }

  // 2. magic bytes 校验（读前 12 字节）
  const header = file.buffer ? file.buffer.slice(0, 12) : Buffer.alloc(0)
  if (!header.length) {
    return { valid: false, error: '无法读取文件内容' }
  }

  let isValid = false
  for (const { magic, ext: magicExt, extra } of IMAGE_MAGIC) {
    if (header.startsWith(magic)) {
      if (extra && !header.includes(extra)) continue
      isValid = true
      break
    }
  }

  if (!isValid) {
    return { valid: false, error: '文件内容不是合法的图片格式' }
  }

  return { valid: true }
}

// multer 配置：内存存储（方便 magic bytes 校验），10MB 限制
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

module.exports = { upload, validateImage, ALLOWED_EXTENSIONS }

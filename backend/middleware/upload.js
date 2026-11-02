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
  let detected = null
  for (const { magic, extra, ext: sigExt } of IMAGE_MAGIC) {
    // Node 24 移除了 Buffer.prototype.startsWith，这里用 equals 比对前缀
    if (magic.equals(header.subarray(0, magic.length))) {
      if (extra && header.indexOf(extra) === -1) continue
      isValid = true
      detected = sigExt
      break
    }
  }

  if (!isValid) {
    return { valid: false, error: '文件内容不是合法的图片格式' }
  }

  // 扩展名与文件头必须是同一种格式。原来两道校验各查各的：一张 JPEG 改名 .png
  // 两道都过，而落盘文件名用的就是这个扩展名（routes/{photos,clothing,tryon,
  // creator,payment}.js 都是 path.extname(originalname)），于是服务器上躺着一张
  // 内容是 JPEG、名字与 Content-Type 写着 png 的文件。这里补第三道：对不上就拒。
  // 'jpeg' 与 'jpg' 是同一种格式的两个写法，视为一致。
  const sigOfExt = ext === 'jpeg' ? 'jpg' : ext
  if (detected !== sigOfExt) {
    return {
      valid: false,
      error: `文件内容与扩展名不符（内容是 ${detected}，名字写着 .${ext}），请改回正确扩展名再传`,
    }
  }

  return { valid: true }
}

// multer 配置：内存存储（方便 magic bytes 校验），10MB 限制
//
// 11-02 补上 multer 自带的两道闸（都是这个依赖已有的开关，不是新依赖、也不是自己造的轮子）：
//   fileFilter — 扩展名不在白名单里的，multer 直接不收，不进内存、不落盘。
//                以前一张 12MB 的 .zip 是先整份读进内存、再由 validateImage 拒掉，
//                那道校验的第 1 步查的就是这张表里的同一个白名单，等于白读一遍。
//                深校验（magic bytes、扩展名与内容是否对得上）仍然留在 validateImage 里，
//                它能看到文件头，是这里做不到的，所以两道不重复、也不互相替代。
//   limits     — 在 fileSize 之外再钉死"几个部件、几个字段"。multipart 的部件数默认无上限，
//                一份带几万个文本部件的请求体会被完整解析成几万个 req.body 键，
//                fileSize 只管单文件大小、管不到这个。
// 数量闸的另一半（一次只准一张/两张图）本来就在：.single() 内部就是 maxCount 1，
// tryon.js 的 .fields() 两个字段各自显式写了 maxCount: 1，多传会触发 LIMIT_UNEXPECTED_FILE，
// 由 server.js 的错误处理映射成 400。
const UPLOAD_LIMITS = {
  fileSize: 10 * 1024 * 1024, // 单文件 10MB
  files: 2, // 一次最多 2 个文件（tryon 的人像+服装两张，其余路由只 1 张）
  parts: 6, // 部件总数（文件+字段）。现量：全仓唯一的上传调用方 app/src/api.ts 一共 4 处
  // append ⇒ 最多 2 文件 + 1 文本字段 = 3 个部件，这里给到两倍余量，收紧不到"改一行前端就 400"
  fields: 8, // 文本字段个数上限
  headerPairs: 2000, // 每个部件的 header 行数，multer/busboy 默认 2000，写明免得以后改乱
}

/**
 * multer 的 fileFilter：只按扩展名做第一道拦截。
 * 拒绝时挂 uploadRejected 标记，server.js 的全局错误处理认这个标记，
 * 好把"仅支持 jpg / png / webp"这句原话带到生产环境（否则会被抹成"请求参数有误"）。
 * @param {import('express').Request} _req
 * @param {import('multer').MulterFile} file
 * @param {(err: Error | null, accept?: boolean) => void} cb
 */
function fileFilter(_req, file, cb) {
  const ext = path
    .extname(file.originalname || '')
    .toLowerCase()
    .replace('.', '')
  if (ALLOWED_EXTENSIONS.has(ext)) return cb(null, true)
  const err = new Error(`不支持的文件类型，仅支持: ${[...ALLOWED_EXTENSIONS].join(', ')}`)
  err.uploadRejected = true
  err.status = 400
  return cb(err)
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: UPLOAD_LIMITS,
  fileFilter,
})

module.exports = { upload, validateImage, ALLOWED_EXTENSIONS, fileFilter, UPLOAD_LIMITS }

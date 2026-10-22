/**
 * 3D 模型管理路由
 *
 * 提供:
 * - GET /                向后兼容,返回 { models: [] }
 * - GET /list            3D 展厅获取已启用模型列表
 * - GET /admin/list      管理后台获取所有模型(含禁用)
 * - POST /admin/scan     扫描 models 目录,新模型自动入库
 * - POST /admin/:id/toggle  切换启用/禁用
 * - PUT /admin/:id       更新模型设置(name, desc, exposure, sort_order)
 * - GET /file/*          模型文件静态服务(pmx/纹理等)
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { firstBadScalar, asId } = require('../utils/common')
const { adminLoginRequired } = require('../middleware/auth')
const {
  ICON_MAP,
  findPmxFiles,
  parseFolderName,
  shouldSkipDir,
  isSkippedPath,
  resolvePathIgnoringCase,
  isDisabledPmxPath,
  setDisabledPmxRefresher,
  resetDisabledPmxCache,
  BROKEN_DIR_NAME,
} = require('../utils/model-utils')

const router = express.Router()

// models 目录绝对路径
const MODELS_DIR = path.join(__dirname, '..', '..', 'models')

// ============================================================
// 已禁用模型的下载闸门
// 展厅列表按 enabled=1 过滤，但文件口原先不看 enabled：后台点「禁用」只是从列表里消失，
// 拿到 URL 照样匿名拖走（10-11 线上实测已下架模型 200 / 1,288,441B）。
// 更糟的是「删行」也拦不住：启动扫描按 (folder,file) 判重，行没了而 .pmx 还在盘上，
// 下一次重启就当新模型重新入库——服务器上当轮 4 行 disabled 里有 2 行就是这么复活的。
// 所以「下架」这件事必须由文件口来兑现，而不是靠删库里的行。
// 缓存与匹配形状都在 utils/model-utils.js：`/api/models/file/*` 与 server.js 的
// `app.use('/models')` 静态口是两条匿名下载口，必须共用同一份禁用集，否则堵住一条另一条照放。
// 这一侧带库，所以由这里把"取 enabled=0 那些行"的函数注入进去。
// ============================================================
setDisabledPmxRefresher(() =>
  db.prepare('SELECT folder, file FROM model_configs WHERE enabled = 0').all(),
)

/** 库里的 enabled 一改就丢掉缓存，否则下架要等 60 秒 TTL 才生效 */
function invalidateDisabledPmxCache() {
  resetDisabledPmxCache()
}

// 模型文件扩展名 → MIME 类型(用于 .gz 预压缩响应时设置正确的 Content-Type)
// .pmx/.vmd 等无标准 MIME,统一用 application/octet-stream
const MODEL_FILE_MIME = {
  '.pmx': 'application/octet-stream',
  '.pmd': 'application/octet-stream',
  '.vmd': 'application/octet-stream',
  '.vpd': 'application/octet-stream',
  '.spa': 'application/octet-stream',
  '.sph': 'application/octet-stream',
  '.png': 'image/png',
  '.tga': 'image/x-tga',
  '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

// ============================================================
// 行车转换函数(共享模块提供 SOURCE_MAP/ICON_MAP/findPmxFiles/parseFolderName)

/** 将数据库行转换为管理后台格式 */
function rowToAdminModel(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || '🎭',
    desc: row.description || '',
    folder: row.folder,
    file: row.file,
    source: row.source || '其他',
    enabled: row.enabled === 1,
    exposure: row.exposure ?? 0.3,
    sort_order: row.sort_order ?? 0,
    image_preview: row.image_preview || '',
  }
}

/** 将数据库行转换为 3D 展厅格式 */
function rowToGalleryModel(row) {
  return {
    id: String(row.id),
    name: row.name,
    source: row.source || '',
    file: row.folder + '/' + row.file,
    desc: row.description || '',
    icon: row.icon || '🎭',
    preview: row.image_preview || '',
    exposure: row.exposure ?? 0.3,
  }
}

// ============================================================
// GET / — 向后兼容,返回 { models: [] } 格式
// ============================================================
router.get('/', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM model_configs WHERE enabled = 1 ORDER BY sort_order, id')
      .all()
    const models = rows.map(rowToGalleryModel)
    return sendSuccess(res, { models })
  } catch (err) {
    console.error('[模型] 获取列表失败:', err)
    return sendError(res, '获取模型列表失败', 500)
  }
})

// ============================================================
// GET /list — 3D 展厅获取已启用模型列表
// 支持 ETag 条件请求:基于 MAX(updated_at) 生成,返回 304 节省带宽
// ============================================================
router.get('/list', (req, res) => {
  try {
    // 获取最近更新时间作为 ETag
    const meta = db
      .prepare(
        'SELECT MAX(updated_at) as last_mod, COUNT(*) as cnt FROM model_configs WHERE enabled = 1',
      )
      .get()
    const etag = `"m-${meta.cnt}-${meta.last_mod || '0'}"`

    // 条件请求:304 Not Modified
    if (req.get('If-None-Match') === etag) {
      return res.status(304).end()
    }

    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'no-cache') // 总是验证,但可 304

    const rows = db
      .prepare('SELECT * FROM model_configs WHERE enabled = 1 ORDER BY sort_order, id')
      .all()
    const models = rows.map(rowToGalleryModel)
    return sendSuccess(res, models)
  } catch (err) {
    console.error('[模型] 获取启用列表失败:', err)
    return sendError(res, '获取模型列表失败', 500)
  }
})

// ============================================================
// GET /admin/list — 管理后台获取所有模型(含禁用)
// 返回: { success: true, data: [{ id, name, icon, desc, folder, source, enabled, exposure, sort_order }] }
// ============================================================
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM model_configs ORDER BY sort_order, id').all()
    const models = rows.map(rowToAdminModel)
    return sendSuccess(res, models)
  } catch (err) {
    console.error('[模型] 获取管理列表失败:', err)
    return sendError(res, '获取模型列表失败', 500)
  }
})

// ============================================================
// POST /admin/scan — 扫描 models 目录,将新模型入库
// 返回: { models: [...], stats: { total, new, skipped } }
// ============================================================
router.post('/admin/scan', adminLoginRequired, (req, res) => {
  try {
    if (!fs.existsSync(MODELS_DIR)) {
      return sendError(res, 'models 目录不存在', 404)
    }

    const topDirs = fs
      .readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !shouldSkipDir(d.name))

    let newCount = 0
    let total = 0
    let skipped = 0

    for (const dir of topDirs) {
      const { name, source } = parseFolderName(dir.name)
      const pmxFiles = findPmxFiles(path.join(MODELS_DIR, dir.name), dir.name)

      for (const pmx of pmxFiles) {
        total++
        const existing = db
          .prepare('SELECT id FROM model_configs WHERE folder = ? AND file = ?')
          .get(pmx.relPath, pmx.fileName)

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
          )
          newCount++
        } else {
          skipped++
        }
      }
    }

    // ★ 先清理(删残缺 + .pmx 已不存在的记录),再查列表返回:否则 scan 响应会把
    //    本轮刚删掉的记录照样吐回去,stats.cleanedUp 却在对它们计数 ⇒ 列表与数字自相矛盾。
    const cleanedUp = cleanupMissingRecords()
    // 清理会删行,禁用集要跟着丢,否则缓存里还留着已经不存在的 (folder,file)
    invalidateDisabledPmxCache()

    // 返回完整的模型列表 + 统计信息
    const rows = db.prepare('SELECT * FROM model_configs ORDER BY sort_order, id').all()
    const models = rows.map(rowToAdminModel)

    return sendSuccess(res, {
      models,
      stats: { total, new: newCount, skipped, cleanedUp },
    })
  } catch (err) {
    console.error('[模型] 扫描失败:', err)
    return sendError(res, '扫描模型失败', 500)
  }
})

/**
 * 清理失效模型记录(供 /admin/scan 调用)
 * 1. folder 路径以 "残缺模型/" 开头 → 用户已手动归集
 * 2. .pmx 文件实际不存在 → 文件被删除
 * @returns {{ removedBroken: number, removedMissing: number }}
 */
function cleanupMissingRecords() {
  let removedBroken = 0
  let removedMissing = 0

  // 1. 删除已归入"残缺模型"文件夹的记录
  const brokenRows = db
    .prepare(`SELECT id, name, folder FROM model_configs WHERE folder = ? OR folder LIKE ?`)
    .all(BROKEN_DIR_NAME, BROKEN_DIR_NAME + '/%')
  if (brokenRows.length > 0) {
    const del = db.prepare(
      `DELETE FROM model_configs WHERE id IN (${brokenRows.map(() => '?').join(',')})`,
    )
    del.run(...brokenRows.map((r) => r.id))
    removedBroken = brokenRows.length
    console.log(`[模型清理] 已删除 ${removedBroken} 条残缺模型记录`)
  }

  // 2. 删除 .pmx 文件实际不存在的记录
  const allRows = db.prepare('SELECT id, name, folder, file FROM model_configs').all()
  const missingIds = []
  for (const row of allRows) {
    const fullPath = path.join(MODELS_DIR, row.folder, row.file)
    if (!fs.existsSync(fullPath)) {
      missingIds.push(row.id)
    }
  }
  if (missingIds.length > 0) {
    const del = db.prepare(
      `DELETE FROM model_configs WHERE id IN (${missingIds.map(() => '?').join(',')})`,
    )
    del.run(...missingIds)
    removedMissing = missingIds.length
    console.log(`[模型清理] 已删除 ${removedMissing} 条文件缺失记录`)
  }

  return { removedBroken, removedMissing }
}

// ============================================================
// POST /admin/:id/toggle — 切换模型启用/禁用
// ============================================================
router.post('/admin/:id/toggle', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    // 原来先 SELECT 再按刚读到的值写回：连点两下时两个请求可能都读到 enabled=1、
    // 都写 0 ⇒ 第二次点击被整个吞掉，界面停在"已禁用"。翻转交给 SQLite 在同一笔
    // 写里自己算（CASE WHEN enabled=1 THEN 0 ELSE 1 END），谁先谁后都是净翻两次；
    // ELSE 走 1 是为了把 NULL／历史脏值一并收回 0/1 两档，不再出现 1-2=-1 这种值。
    const info = db
      .prepare(
        `UPDATE model_configs
         SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END,
             updated_at = datetime('now')
       WHERE id = ?`,
      )
      .run(id)
    if (info.changes === 0) {
      return sendError(res, '模型不存在', 404)
    }
    // 下架要当场生效,不能等重启:缓存必须在这一笔写之后丢掉
    invalidateDisabledPmxCache()

    // 回给前端的是这一行此刻的真值（并发下只用于显示，不参与判定，翻转本身已经原子）
    const after = db.prepare('SELECT enabled FROM model_configs WHERE id = ?').get(id)
    const newEnabled = after && after.enabled === 1 ? 1 : 0

    return sendSuccess(
      res,
      { enabled: newEnabled === 1 },
      newEnabled === 1 ? '模型已启用' : '模型已禁用',
    )
  } catch (err) {
    console.error('[模型] 切换状态失败:', err)
    return sendError(res, '操作失败', 500)
  }
})

// ============================================================
// PUT /admin/:id — 更新模型设置(name, desc, exposure, sort_order, source, icon, image_preview)
// ⛔ 展厅不读的 9 个调参列(scale / pos_x-y-z / rot_x-y-z / camera_distance / ambient_light)自 2026-10-11
//    起不再接收:后台编辑框已于 2026-10-03 那轮(b32c848)删净,前端零引用,取景由 Box3 自动算。
//    数据库列保留不动(删列要迁移且无收益),只是写入口关掉,传了也不生效。
// ============================================================
router.put('/admin/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id)

    if (!row) {
      return sendError(res, '模型不存在', 404)
    }

    const { name, desc, exposure, sort_order, source, icon, image_preview } = req.body
    const updates = []
    const params = []

    // better-sqlite3 绑到对象/数组/布尔都会抛（对象是 RangeError、布尔是 TypeError），
    // 被外层 catch 抹成 500 就是假故障：这类请求本质是"字段类型写错了"，该回 400。
    // 原来这里只挡 `typeof v === 'object'`，漏了布尔 ⇒ {"name":true} 一路跑到 UPDATE 才炸。
    // 口径与 cosmetics/photos 用同一把尺子（utils/common.js:214 firstBadScalar：只认文本与数字，
    // null/undefined 放行——null 是合法绑定值，用来清列）。
    const badScalar = firstBadScalar(req.body, [
      'name',
      'desc',
      'exposure',
      'sort_order',
      'source',
      'icon',
      'image_preview',
    ])
    if (badScalar) return sendError(res, `${badScalar} 只能是文本或数字`, 400)

    // name 是 `TEXT NOT NULL`（schema.sql:501）：firstBadScalar 按约定放行 null（它用来清列），
    // 但这一列清不得 ⇒ `{"name":null}` 会在 UPDATE 上抛 SQLITE_CONSTRAINT_NOTNULL，
    // 被外层 catch 抹成 500。空名是入参错，当场 400。
    if (name === null) return sendError(res, 'name 不能为空', 400)

    if (name !== undefined) {
      updates.push('name = ?')
      params.push(name)
    }
    if (desc !== undefined) {
      updates.push('description = ?')
      params.push(desc)
    }
    if (exposure !== undefined) {
      // 同一把尺子：exposure 是 REAL（schema.sql:509），展厅拿它做光照乘法，
      // 存成 '0.3x' 这种收不进实数的文本 ⇒ 前端算出来是 NaN，画面黑掉却没有任何报错。
      const e = Number(exposure)
      if (exposure === null || !Number.isFinite(e)) {
        return sendError(res, 'exposure 只能是数字', 400)
      }
      updates.push('exposure = ?')
      params.push(e)
    }
    if (sort_order !== undefined) {
      // 列是 INTEGER（schema.sql:510），取数用的是 `ORDER BY sort_order, id`。
      // 整型亲和会把 '5' 收成 5，但 'abc' 这类收不动的会原样存成 TEXT，
      // 而 SQLite 排序是 NULL < 数字 < 文本 ⇒ 这一行悄悄掉到列表末尾（或最前），
      // 后台看不出任何错误。表单上来本就是字符串，所以这里统一收数、收不成就 400。
      const n = Number(sort_order)
      if (sort_order === null || !Number.isInteger(n)) {
        return sendError(res, 'sort_order 只能是整数', 400)
      }
      updates.push('sort_order = ?')
      params.push(n)
    }
    if (source !== undefined) {
      updates.push('source = ?')
      params.push(source)
    }
    if (icon !== undefined) {
      updates.push('icon = ?')
      params.push(icon)
    }
    if (image_preview !== undefined) {
      updates.push('image_preview = ?')
      params.push(image_preview)
    }

    if (updates.length === 0) {
      return sendError(res, '无更新字段', 400)
    }

    updates.push("updated_at = datetime('now')")
    params.push(id)

    db.prepare(`UPDATE model_configs SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    const updated = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id)
    return sendSuccess(res, rowToAdminModel(updated))
  } catch (err) {
    console.error('[模型] 更新设置失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

// ============================================================
// DELETE /admin/:id — 删除模型配置(管理员)
// ⚠️ 只删库里这一行,盘上的 .pmx 一个字都不动 ⇒ 下一次启动扫描按 (folder,file) 判重时
//    找不到行,会把它当"新模型"重新入库(10-11 服务器上手工删的 4 行有 2 行就是这么复活的)。
//    真要下架请用 POST /admin/:id/toggle 禁用:文件口现在认 enabled=0,当场 404。
// ============================================================
router.delete('/admin/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id)
    if (!row) {
      return sendError(res, '模型不存在', 404)
    }
    db.prepare('DELETE FROM model_configs WHERE id = ?').run(id)
    // 删的可能正是一条 enabled=0 的行:缓存不丢的话,重启后扫进来的那条同 (folder,file)
    // 的启用记录会被旧键误拦最多 60 秒
    invalidateDisabledPmxCache()
    // 文件还在盘上就如实说清楚"这条记录没了、模型还在",别让人以为删行就是下架
    const stillOnDisk = fs.existsSync(path.join(MODELS_DIR, row.folder, row.file))
    return sendSuccess(
      res,
      { file_still_on_disk: stillOnDisk },
      stillOnDisk
        ? '记录已删除,但模型文件仍在 models/ 目录里,重启扫描会重新入库;要下架请点「禁用」'
        : '模型已删除',
    )
  } catch (err) {
    console.error('[模型] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

// ============================================================
// GET /file/* — 模型文件静态服务
// 前端: /api/models/file/<folder>/<subfolder>/<file>.pmx
// MMDLoader 资源路径: /api/models/file/<folder>/<subfolder>/
//
// ★ 加速优化:如果存在同名 .gz 预压缩文件且客户端支持 gzip,
//   直接发送 .gz 并设置 Content-Encoding: gzip,浏览器自动解压.
//   效果:.pmx 传输量减少约 50%,且省去服务器实时压缩的 CPU 开销.
//   原理:compression 中间件不会压缩 application/octet-stream / image/png
//        (compressible 判定为 false),所以不传 .gz 就是裸传,大文件很慢.
// ============================================================
router.get('/file/*', (req, res, next) => {
  try {
    // req.params[0] 包含通配符匹配的路径
    const relPath = req.params[0]
    if (!relPath) {
      return sendError(res, '文件路径不能为空', 400)
    }

    // 安全检查:防止目录遍历(去除 ../ 前缀)
    // ★ 尾部分隔符必须在这里就砍掉:实测 `GET /file/<folder>/<file>.pmx/`(结尾多一个 /)
    //   会原样进 req.params[0]，path.normalize 在 POSIX 下**保留尾斜杠**，
    //   于是闸门里的 `lower.endsWith('.pmx')` 不成立 ⇒ 禁用判定整个跳过，
    //   而下面的 path.join 又把尾斜杠抹掉、照样命中真实文件 —— 后台点了「禁用」的模型，
    //   任何人加一个尾斜杠就能继续匿名整文件下载（10-13 现量：裸路径 404、带尾斜杠 200 发出 8.9MB 的 pmx）。
    const safePath = path
      .normalize(relPath)
      .replace(/^(\.\.[/\\])+/, '')
      .replace(/[/\\]+$/, '')

    // 扫描时不入库的目录(zip备份/残缺模型/_bak_*)一律不下发。
    // 本路由既不带鉴权也不限流,放行就等于 models/ 下的原始压缩包可被匿名直连拖走。
    if (isSkippedPath(safePath)) {
      return sendError(res, '文件不存在', 404)
    }

    // 后台点了「禁用」的 .pmx 同样不下发:展厅早就把它过滤掉了,文件口不看 enabled
    // 就等于"下架"只下架了列表,文件 URL 照旧能匿名拖走。
    if (isDisabledPmxPath(safePath)) {
      return sendError(res, '文件不存在', 404)
    }

    let fullPath = path.join(MODELS_DIR, safePath)

    // PMX 里声明的纹理路径与磁盘只差大小写时，Linux 分大小写直接 404，而 Windows 本机看不出来。
    // 逐段纠（目录名也要纠）：实测今汐的 PMX 写 `TEX/`、`Tex/`，磁盘是 `tex/`，整张脸纹理全挂。
    // 先试精确名，命中就走原来的单次 existsSync；只有没命中才逐段解析，不在热路径上多花 N 次系统调用。
    if (!fs.existsSync(fullPath)) {
      const ciPath = resolvePathIgnoringCase(MODELS_DIR, safePath)
      if (ciPath) {
        // 纠完之后可能落进另一个大小写写法的跳过目录（如 `Zip备份`），前面那道闸门按原样比对会被绕开，再查一次
        if (isSkippedPath(path.relative(MODELS_DIR, ciPath))) {
          return sendError(res, '文件不存在', 404)
        }
        fullPath = ciPath
      }
    }

    // 同名 .gz 是本路由认可的另一份来源(见下面 acceptsGzip 分支),
    // 所以"原始文件不存在"不能直接判 404:线上有纹理只有 .gz,或磁盘扩展名大小写与 PMX 声明不一致。
    const gzPath = fullPath + '.gz'

    // 确保路径在 models 目录内:两个候选各自 realpath,任一越界即拒,都不存在才 404
    const realModelsDir = fs.realpathSync(MODELS_DIR)
    let targetPath = null
    for (const candidate of [fullPath, gzPath]) {
      let realCandidate
      try {
        realCandidate = fs.realpathSync(candidate)
      } catch {
        continue
      }
      // 只比 startsWith 会漏掉分隔符边界：realModelsDir="…/models" 时,
      // 兄弟目录 "…/models_backup/xxx" 也满足前缀, traversal 闸门形同虚设。
      // 用 path.relative 判"是否真在 models 目录内"(空/以 .. 开头/绝对＝越界)。
      const relToModels = path.relative(realModelsDir, realCandidate)
      if (relToModels === '' || relToModels.startsWith('..') || path.isAbsolute(relToModels)) {
        return sendError(res, '非法路径', 403)
      }
      if (!targetPath) targetPath = candidate
    }

    if (!targetPath) {
      return sendError(res, '文件不存在', 404)
    }

    // 目录前缀（如请求 "今汐+鸣潮/"）的 realpath 是通过的，但 sendFile 读到 EISDIR 会冒到全局处理器变成 500。
    // 这里先 stat 一次：不是普通文件就是"没有这个文件"，回 404。
    let targetStat
    try {
      targetStat = fs.statSync(targetPath)
    } catch {
      return sendError(res, '文件不存在', 404)
    }
    if (!targetStat.isFile()) {
      return sendError(res, '文件不存在', 404)
    }

    // ★ 加速优化:优先发送 .gz 预压缩文件
    const acceptsGzip = (req.get('Accept-Encoding') || '').includes('gzip')
    const ext = path.extname(fullPath).toLowerCase()

    // ★ .gz 只在"不比源文件旧"时才下发（与 server.js 里 /models 静态挂载同一口径，审计第 7 条）。
    //   原来这里只看"有没有 .gz"：源文件（模型／纹理）改过而预压缩没重跑时，客户拿到的是旧字节，
    //   而下面这条分支给非纹理写 max-age=3600，页面上没有任何入口能强制重拉，只能等一小时。
    //   盘上只有 .gz、没有源文件可比对的情况线上确实存在（有些纹理就压了一份），那种照旧下发。
    let gzIsFresh = false
    if (acceptsGzip && fs.existsSync(gzPath)) {
      gzIsFresh = true
      if (targetPath === fullPath) {
        try {
          gzIsFresh = fs.statSync(gzPath).mtimeMs >= fs.statSync(fullPath).mtimeMs
        } catch {
          gzIsFresh = false
        }
      }
    }

    // 只有 .gz 时无法下发给不接受 gzip 的客户端(裸 .gz 字节它解不开)
    if (targetPath !== fullPath && !acceptsGzip) {
      return sendError(res, '文件不存在', 404)
    }

    // ★ 纹理文件(.png/.jpg/.tga 等)特殊处理:
    // 1. 同样优先用 .gz 预压缩(Content-Encoding: gzip 由浏览器透明解压,图片解码拿到的是原始字节)
    // 2. 缓存口径（🔴 2026-10-22 第五十九轮·组2b 改：原来这里是 `no-cache, no-store, must-revalidate`）：
    //    现量＝展厅待机态首屏 **38 个资源／体积合计 20.93 MB**，其中"模型本体＋贴图"31 个／20.61 MB（10-22 真浏览器取 `performance.getEntriesByType('resource')`；🔴 尺子要写准：**体积**是 `encodedBodySize` 之和，**上线字节**是 `transferSize` 之和，这 20.93 MB 是前者——我这条注释的初稿把它当成"上线"写错了,取证见 docs/依据/22-…md §十二.9d）。改前那次冷启动 `transferSize` 合计 **17.16 MB**、改后复访 **0.01 MB**；盘上纹理 297 张、`*.png.gz` 0 个，而第十三节量过 PNG 预压缩只省 0.1% ⇒ 纹理这一侧省不了字节，能省的只有"重复下"。no-store 让浏览器连磁盘缓存都不写：顾客切走再切回、或明天再来，这 20 MB 整包重下一遍，手机流量下这就是"看一次展厅跑掉一部手机的流量"。改成 `max-age=0, must-revalidate` 后 sendFile 的弱 ETag 走 304（零字节、只花一次往返），原注释要防的那件事仍然成立：纹理换文件后下一次加载照旧回源比对，不会命中旧字节。
    const TEXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.gif', '.webp']
    const isTexture = TEXTURE_EXTENSIONS.includes(ext)
    const revalidateOnly = {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    }

    // existsSync 与真正读取之间文件可能已被扫描/部署改名删掉，
    // 不接这个回调的话 sendFile 会把错误冒到全局处理器、对外回 500，
    // 而它本质就是"这个文件没有"，应当是 404。
    const asFail = (err) => {
      if (!err) return
      if (res.headersSent) return next(err)
      // EISDIR 实测自"请求打到模型文件夹本身"（/api/models/file/今汐+鸣潮/tex）：
      // send 对目录回调 Error: EISDIR, read，本质同样是"这里没有可下载的文件"，该回 404 而不是 500。
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EISDIR') {
        return sendError(res, '文件不存在', 404)
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return sendError(res, '非法路径', 403)
      }
      console.error('[模型] 文件下发失败:', err)
      return sendError(res, '文件服务错误', 500)
    }

    if (isTexture) {
      const mimeType = MODEL_FILE_MIME[ext] || 'image/png'
      if (gzIsFresh) {
        return res.sendFile(
          gzPath,
          {
            headers: {
              'Content-Encoding': 'gzip',
              'Content-Type': mimeType,
              Vary: 'Accept-Encoding',
              ...revalidateOnly,
            },
          },
          asFail,
        )
      }
      return res.sendFile(
        fullPath,
        {
          headers: {
            'Content-Type': mimeType,
            ...revalidateOnly,
          },
        },
        asFail,
      )
    }

    // 非纹理文件:正常处理
    if (gzIsFresh) {
      const mimeType = MODEL_FILE_MIME[ext] || 'application/octet-stream'
      // sendFile 会自动生成 ETag(基于 .gz 内容)和处理 304 条件请求
      // headers 中设置的 Content-Type 会覆盖 sendFile 基于 .gz 扩展名的默认推断
      return res.sendFile(
        gzPath,
        {
          headers: {
            'Content-Encoding': 'gzip',
            'Content-Type': mimeType,
            Vary: 'Accept-Encoding',
            'Cache-Control': 'public, max-age=3600',
          },
        },
        asFail,
      )
    }

    return res.sendFile(fullPath, undefined, asFail)
  } catch (err) {
    console.error('[模型] 文件服务失败:', err)
    return sendError(res, '文件服务错误', 500)
  }
})

module.exports = router

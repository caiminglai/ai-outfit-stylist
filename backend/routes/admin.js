/**
 * 后端管理路由模块
 * 对应 Python: app/routes/admin.py
 *
 * 提供数据库结构、数据浏览、函数逻辑、API路由查看、统计概览接口
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { adminLoginRequired } = require('../middleware/auth')
const { ownValue, parsePagination } = require('../utils/common')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 后台 API 自己的限流档。`/admin/api/*` 由 server.js 把本路由挂在 `/admin` 下,而前台那道
// 100 次/15 分钟的总闸挂在 `/api/` 前缀上,一条都管不到这里 —— 挂之前后台是裸奔状态:
// 后台脚本循环写错、或 admin token 泄漏,都能不打招呼地把 SQLite 读写打满。
// 60 秒 600 次(平均每秒 10 次)是人工点后台碰不到的量级,只挡跑飞,不影响正常操作。
// 只挂 `/api` 子树:三个后台页面(`/`、`/login`、`/learn`)与 static JS 不吃这道闸。
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: '后台请求过于频繁,请 1 分钟后再试' },
  },
})
router.use('/api', adminApiLimiter)

// 管理页面 HTML 文件所在目录
const ADMIN_DIR = path.join(__dirname, '..', 'templates')

// ============================================================
// 管理页面入口
// ============================================================

router.get(['/', ''], (req, res) => {
  const htmlPath = path.join(ADMIN_DIR, 'admin.html')
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath)
  }
  return res
    .status(404)
    .send('<h1>admin.html 未找到</h1><p>请在 templates/ 目录创建 admin.html</p>')
})

router.get('/login', (req, res) => {
  const htmlPath = path.join(ADMIN_DIR, 'admin-login.html')
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath)
  }
  return res.status(404).send('<h1>登录页面未找到</h1>')
})

// 编程教程页:整份内容在 templates/learn-to-code.html 里,不读库、不调任何接口,
// 所以它和 `/`、`/login` 一样不吃后台限流闸,也不加 adminLoginRequired —— 页面正文讲的是
// "这个项目怎么读、怎么改",不含口令、密钥或任何只有登录者能看的数据。
// ⚠️ backend/.prettierignore 与 eslint.config.js 都排除了 templates/ 与 static/,
// 这份 HTML 排版与内容没有任何门禁兜底;它的行号锚点由 backend/test/learnPage.test.js
// 逐条对着真实文件核验(文件在场 + 行号不越界),正文缺课或锚点越界会把测试跑红。
router.get('/learn', (req, res) => {
  const htmlPath = path.join(ADMIN_DIR, 'learn-to-code.html')
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath)
  }
  return res.status(404).send('<h1>learn-to-code.html 未找到</h1>')
})

// ============================================================
// 1. 数据库表结构接口
// ============================================================

// 表名 -> 中文名映射
const TABLE_NAMES = {
  users: '用户/游客表',
  photos: '照片表',
  face_features: '面容分析表',
  face_profiles: '面容档案表(手工)',
  body_metrics: '身体指标表',
  profile_tags: '形象标签表(算出)',
  recommendations: '推荐记录表',
  tryon_results: '试穿结果表',
  clothing_items: '衣服照片表',
  rule_groups: '规则组表',
  rule_conditions: '规则条件表',
  rule_actions: '规则动作表',
  inventory_categories: '商品分类表',
  inventory_products: '库存商品表',
  stores: '门店表',
  customer_sessions: '顾客会话表',
  recommendation_logs: '推荐日志表',
  feedback_events: '反馈表(规则评价)',
  user_wardrobe: '个人衣橱表',
  wardrobe_outfits: '搭配组合表',
  shopping_wishlist: '购物心愿单',
  admin_users: '管理员表',
  user_accounts: '正式账号表',
  user_cosmetics: '化妆品柜表',
  user_accessories: '配饰柜表',
  model_configs: '3D模型配置表',
  deposits: '收款凭证表',
  app_settings: '键值设置表',
  profile_drafts: '档案草稿表',
  payment_orders: '在线收款订单表',
  creator_works: '创作者作品表',
}

// 从 schema.sql 解析表结构（运行时读取）
function getTableSchema() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql')
  if (!fs.existsSync(schemaPath)) return []

  const content = fs.readFileSync(schemaPath, 'utf-8')
  const tables = []

  // 正则匹配 CREATE TABLE 块
  const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g
  let match
  while ((match = tableRegex.exec(content)) !== null) {
    const tableName = match[1]
    const body = match[2]

    // 解析列定义
    const columns = []
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    for (const line of lines) {
      // 跳过 INDEX 和 PRAGMA 行
      if (line.toUpperCase().startsWith('CREATE INDEX') || line.toUpperCase().startsWith('PRAGMA'))
        continue
      // 跳过外键约束行
      if (line.toUpperCase().startsWith('FOREIGN KEY')) continue

      // 解析列名和类型
      const colMatch = line.match(/^(\w+|`\w+`)\s+(.+?)(?:,|$)/)
      if (colMatch) {
        const colName = colMatch[1].replace(/`/g, '')
        const colDef = colMatch[2].trim()

        columns.push({
          name: colName,
          type: colDef.split(/\s+/)[0] || 'TEXT',
          nullable: !colDef.toUpperCase().includes('NOT NULL'),
          primary_key: colDef.toUpperCase().includes('PRIMARY KEY'),
          foreign_key: colDef.includes('REFERENCES')
            ? colDef.match(/REFERENCES\s+(\w+)/)?.[1] || null
            : null,
          comment: '',
          default: colDef.match(/DEFAULT\s+([\s\S]+?)(?:,|$)/i)?.[1]?.trim() || null,
        })
      }
    }

    tables.push({
      table_name: tableName,
      display_name: TABLE_NAMES[tableName] || tableName,
      class_name: tableName, // 兼容前端 class_name 字段
      columns,
      row_count: getRowCount(tableName),
    })
  }

  return tables
}

/** 安全获取表的行数（where 只能是本文件内拼出的固定片段，值一律走 params 绑定） */
function getRowCount(tableName, where = '', params = []) {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}${where}`).get(...params)
    return result ? result.count : 0
  } catch {
    return -1
  }
}

/** 该表当前是否有 store_id 列：只能查现库，schema.sql 的 CREATE TABLE IF NOT EXISTS 不会给老表补列 */
function hasStoreColumn(tableName) {
  try {
    return db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .some((col) => col.name === 'store_id')
  } catch {
    return false
  }
}

router.get('/api/tables', adminLoginRequired, (req, res) => {
  try {
    const tablesInfo = getTableSchema()
    return res.json({
      success: true,
      data: tablesInfo,
    })
  } catch (err) {
    console.error('[管理] 获取表结构失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取表结构失败' } })
  }
})

// ============================================================
// 2. 数据浏览接口
// ============================================================

router.get('/api/data/:tableName', adminLoginRequired, (req, res) => {
  try {
    const tableName = req.params.tableName
    // 畸形页码必须挡在这里：?page=abc 会绑成 NaN，SQLite 在 LIMIT/OFFSET 位上直接抛
    // "datatype mismatch" ⇒ 入参错回 500（2026-10-11 实测）；?per_page=-1 更糟，
    // 负数 LIMIT 在 SQLite 里等于"不限"，100 条的上限被整条绕过。
    // 这两条闸门以前是本路由手搓的第二份（只认 per_page），2026-11-02 并进 utils/common
    // 的 parsePagination：同一个项目里分页参数只有一套名字、一套上下限，
    // per_page 作为旧名仍然收（旧页面/书签不会一夜之间默默变回 20 条）。
    const { page, limit, offset } = parsePagination(req.query)

    // 安全检查：表名必须在已知列表中。
    // 这里必须只认表自己的键：/admin/api/data/constructor 用 TABLE_NAMES['constructor']
    // 会顺着原型链拿到 Object 构造器（truthy ⇒ 通过白名单），随后 SELECT * FROM constructor
    // 直接被 SQLite 判成语法错，一个"表名写错"回成 500
    if (!ownValue(TABLE_NAMES, tableName)) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: `未知表名: ${tableName}` } })
    }

    const storeFilter = hasStoreColumn(tableName)
    const storeId = Number.parseInt(req.query.store_id, 10)
    const filterStore = storeFilter && Number.isInteger(storeId)
    const where = filterStore ? ' WHERE store_id = ?' : ''
    const whereParams = filterStore ? [storeId] : []

    const total = getRowCount(tableName, where, whereParams)

    // 显式 ORDER BY rowid：SQLite 不保证不带排序的 LIMIT/OFFSET 返回顺序，这里把它定死。
    // 10-13 用同 schema 的干净库实测（users 插 25 条、每页 10 条）两条都要说清：
    //   `SELECT id FROM users LIMIT 10 OFFSET 0` ⇒ 1,10,11…18、第 2 页 19,2,20…25,3,4，
    //     乱序是真出现了——它只取 id，优化器走了 ix_users_session_id 的覆盖索引扫描；
    //   `SELECT * FROM users LIMIT 10 OFFSET 0`（本路由的写法）⇒ 1,2,3…25 升序，
    //     取整行必须回表，本机的 SQLite 就走成了 rowid 序。
    // ⇒ 所以这条不是"顾客看到的页面顺序乱了"，而是"顺序没写出来就不算约定"：
    //   换 SQLite 版本、加个 WHERE 命中索引、或以后有人把 SELECT * 改成投影列，都会翻。
    // 白名单里全是带 rowid 的普通表（schema.sql 现量：无 CREATE VIEW、无 WITHOUT ROWID），
    // 按 rowid 排就是插入序，且不需要任何索引。
    const rows = db
      .prepare(`SELECT * FROM ${tableName}${where} ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(...whereParams, limit, offset)

    let storeList = null
    if (storeFilter) {
      try {
        storeList = db.prepare('SELECT id, name FROM stores ORDER BY id').all()
      } catch {
        storeList = []
      }
    }

    // 处理 JSON 字段反序列化
    const jsonColumns = [
      'features_json',
      'content_json',
      'result_json',
      'form_json',
      'profile_data',
      'input_snapshot',
      'result',
      'value',
      'content',
      'style_tags',
      'color_tags',
      'season_tags',
      'occasion_tags',
      'fit_skin_tones',
      'fit_face_shapes',
      'fit_body_types',
      'color_tags',
      'item_ids',
      'skin_tone_fit',
      'face_shape_fit',
      'skin_type_fit',
      'eye_shape_fit',
      'lip_shape_fit',
      'neck_length_fit',
    ]
    const normalizedRows = rows.map((row) => {
      const normalized = { ...row }
      for (const [key, val] of Object.entries(normalized)) {
        if (typeof val === 'string' && jsonColumns.includes(key)) {
          try {
            normalized[key] = JSON.parse(val)
          } catch {
            // 保持原样
          }
        }
      }
      return normalized
    })

    return res.json({
      success: true,
      data: {
        rows: normalizedRows,
        total,
        page,
        // 出参也用规范名 limit（旧名 per_page 只读不回显）；全仓唯一读这两个字段的是
        // static/admin/admin-data.js 的翻页条，它读 page/total/total_pages，本轮同轮改光
        limit,
        total_pages: Math.ceil(total / limit),
        store_filter: storeFilter,
        store_id: filterStore ? storeId : null,
        stores: storeList,
      },
    })
  } catch (err) {
    console.error('[管理] 获取数据失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取数据失败' } })
  }
})

// ============================================================
// 3. API 路由列表接口
// ============================================================

router.get('/api/routes', adminLoginRequired, (req, res) => {
  try {
    // 从 Express app 的路由栈中提取路由
    const routes = []
    const app = req.app

    function processStack(stack, basePath = '') {
      for (const layer of stack) {
        if (layer.route) {
          // 直接路由
          const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase())
          routes.push({
            rule: basePath + layer.route.path,
            methods: methods,
          })
        } else if (layer.name === 'router' && layer.handle.stack) {
          // 嵌套路由
          let nestedPath = basePath
          if (layer.regexp && layer.regexp.source) {
            // 从正则中提取路径前缀
            const match = layer.regexp.source.match(/^\^\\\/([^?\\]+)/)
            if (match) {
              nestedPath = basePath + '/' + match[1]
            }
          }
          processStack(layer.handle.stack, nestedPath)
        }
      }
    }

    processStack(app._router.stack)

    // 过滤掉中间件路由
    const filtered = routes
      .filter((r) => r.rule && !r.rule.includes('?'))
      .sort((a, b) => a.rule.localeCompare(b.rule))

    return res.json({
      success: true,
      data: filtered,
    })
  } catch (err) {
    console.error('[管理] 获取路由失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取路由失败' } })
  }
})

// ============================================================
// 4. 数据库统计概览
// ============================================================

router.get('/api/stats', adminLoginRequired, (req, res) => {
  try {
    const stats = {}
    for (const tableName of Object.keys(TABLE_NAMES)) {
      stats[tableName] = getRowCount(tableName)
    }
    return res.json({
      success: true,
      data: stats,
    })
  } catch (err) {
    console.error('[管理] 获取统计失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取统计失败' } })
  }
})

// ============================================================
// 5. 源代码查看接口
// ============================================================

router.get(['/api/source', '/api/source/*'], adminLoginRequired, (req, res) => {
  try {
    // 通配符路径在 req.params[0]，兼容旧版 :filePath
    // ?file=a&file=b 时 Express 给的是数组，.replace 会 TypeError ⇒ 非字符串一律当没填
    const raw = req.params[0] || req.params.filePath || req.query.file || 'db/schema.sql'
    const filePath = typeof raw === 'string' ? raw : ''
    // 敏感文件禁止访问（路径分隔符标准化后精确匹配）
    const normalizedPath = filePath.replace(/\\/g, '/')
    const blockedDirs = ['node_modules', '.git', 'uploads']
    // .pem/.key 必须在这里：容器里 backendRoot=/app，商户私钥就挂在 /app/certs* 之下，
    // 少这一条，后台源码查看器等于能把签约用的私钥整份读走
    const blockedExtensions = ['.db', '.sqlite', '.sqlite3', '.env', '.pem', '.key', '.p12', '.pfx']
    // WAL/SHM 伴生文件里是未落盘的行数据（含口令哈希），跟 .db 同等对待：
    // 原来只按整名挡 styleai.db-wal，换成别的库名（backup.db-wal）就漏出去
    const blockedSuffixes = ['.db-wal', '.db-shm', '.sqlite-wal', '.sqlite-shm']
    const blockedFiles = ['package-lock.json', 'styleai.db', 'styleai.db-wal', 'styleai.db-shm']
    const pathParts = normalizedPath.split('/')
    const fileName = pathParts[pathParts.length - 1] || ''
    if (
      blockedDirs.some((d) => pathParts.includes(d)) ||
      blockedExtensions.some((ext) => fileName.endsWith(ext)) ||
      blockedSuffixes.some((sfx) => fileName.endsWith(sfx)) ||
      // endsWith('.env') 只挡得住 .env 本身：.env.local / .env.production 一样装着口令，
      // 按前缀挡才算挡住这一族
      fileName === '.env' ||
      fileName.startsWith('.env.') ||
      blockedFiles.includes(fileName)
    ) {
      return res
        .status(403)
        .json({ success: false, error: { code: 'FORBIDDEN', message: '禁止访问此文件' } })
    }
    const backendRoot = path.join(__dirname, '..')
    const fullPath = path.join(backendRoot, filePath)

    // 越界判定放在"是否存在"之前：原来先 existsSync/statSync 再 realpath，
    // root 外的路径能拿到 404、root 内但被挡的拿到 403，
    // 后台 token 一旦泄漏出去，这点状态差异就够把服务器上的绝对目录结构探出来。
    // 这里用 path.resolve 做词法收敛（不碰磁盘），先统一回 403 非法路径。
    const resolved = path.resolve(fullPath)
    const resolvedRoot = path.resolve(backendRoot)
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      return res
        .status(403)
        .json({ success: false, error: { code: 'FORBIDDEN', message: '非法路径' } })
    }

    // 再查存在性：realpathSync 对不存在的路径直接抛 ENOENT，
    // 落到 catch 就是"文件不存在"回 500（2026-10-11 实测 /admin/api/source/nope.js）。
    // 回显只给通用文案，不再把请求里的原始路径抄回响应。
    if (!filePath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } })
    }

    // 最后按真实路径复查一次（符号链接/junction 能绕过词法判定）
    const realPath = fs.realpathSync(fullPath)
    const realRoot = fs.realpathSync(backendRoot)
    if (!realPath.startsWith(realRoot + path.sep)) {
      return res
        .status(403)
        .json({ success: false, error: { code: 'FORBIDDEN', message: '非法路径' } })
    }

    const content = fs.readFileSync(fullPath, 'utf-8')
    return res.json({
      success: true,
      data: {
        file: filePath,
        content,
        lines: content.split('\n').length,
      },
    })
  } catch (err) {
    console.error('[管理] 获取源代码失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取源代码失败' } })
  }
})

// ============================================================
// 6. 后端模块结构（函数逻辑）
// ============================================================

/* 路由模块中文名；侧栏取空格前那段，英文名与文件路径仍照常显示 */
const MODULE_LABELS = {
  accessory: '配饰柜',
  admin: '后台管理',
  analysis: '形象分析',
  auth: '登录鉴权',
  clothing: '衣服照片',
  cosmetic: '化妆柜',
  creator: '创作者作品',
  crossCabinet: '跨柜搭配',
  customer: '顾客会话',
  history: '历史记录',
  horoscope: '星座建议',
  inventory: '库存管理',
  models: '3D模型',
  payment: '收款凭证',
  photos: '照片上传',
  recommend: '搭配推荐',
  rules: '规则引擎',
  tryon: '虚拟试穿',
  wardrobe: '衣橱管理',
  weather: '天气建议',
}

router.get('/api/functions', adminLoginRequired, (req, res) => {
  try {
    const routesDir = path.join(__dirname)
    const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'))

    const modules = files.map((file) => {
      const filePath = `routes/${file}`
      const fullPath = path.join(routesDir, file)
      const content = fs.readFileSync(fullPath, 'utf-8')

      // 提取路由定义作为函数
      const functions = []
      const routeRegex =
        /router\.(get|post|put|delete)\(\s*\[?['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?\]?/g
      let match
      while ((match = routeRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase()
        const routePath = match[2]
        const name = `${method} ${routePath}`
        functions.push({ name, signature: name, docstring: '' })
      }

      // 标签 = 中文名 + 英文名；没有中文映射的模块退回英文文件名
      const modName = file.replace('.js', '')
      const label = MODULE_LABELS[modName] ? MODULE_LABELS[modName] + ' ' + modName : modName

      return { label, file: filePath, functions, classes: [] }
    })

    return res.json({ success: true, data: modules })
  } catch (err) {
    console.error('[管理] 获取模块结构失败:', err)
    return res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取模块结构失败' } })
  }
})

module.exports = router

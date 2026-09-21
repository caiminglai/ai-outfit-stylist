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

const router = express.Router()

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

// ============================================================
// 1. 数据库表结构接口
// ============================================================

// 表名 -> 中文名映射
const TABLE_NAMES = {
  users: '用户/游客表',
  photos: '照片表',
  face_features: '面容分析表',
  body_metrics: '身体指标表',
  recommendations: '推荐记录表',
  tryon_results: '试穿结果表',
  clothing_items: '衣服照片表',
  rule_groups: '规则组表',
  rule_conditions: '规则条件表',
  rule_actions: '规则动作表',
  inventory_categories: '商品分类表',
  inventory_products: '库存商品表',
  customer_sessions: '顾客会话表',
  recommendation_logs: '推荐日志表',
  user_wardrobe: '个人衣橱表',
  wardrobe_outfits: '搭配组合表',
  shopping_wishlist: '购物心愿单',
  admin_users: '管理员表',
  user_cosmetics: '化妆品柜表',
  user_accessories: '配饰柜表',
  model_configs: '3D模型配置表',
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

/** 安全获取表的行数 */
function getRowCount(tableName) {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get()
    return result ? result.count : 0
  } catch {
    return -1
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
    const page = parseInt(req.query.page || '1', 10)
    const perPage = Math.min(parseInt(req.query.per_page || '20', 10), 100)

    // 安全检查：表名必须在已知列表中
    if (!TABLE_NAMES[tableName]) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: `未知表名: ${tableName}` } })
    }

    const total = getRowCount(tableName)
    const offset = (page - 1) * perPage

    const rows = db.prepare(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`).all(perPage, offset)

    // 处理 JSON 字段反序列化
    const jsonColumns = [
      'features_json',
      'content_json',
      'result_json',
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
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
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
    const filePath = req.params[0] || req.params.filePath || req.query.file || 'db/schema.sql'
    // 敏感文件禁止访问（路径分隔符标准化后精确匹配）
    const normalizedPath = filePath.replace(/\\/g, '/')
    const blockedDirs = ['node_modules', '.git', 'uploads']
    const blockedExtensions = ['.db', '.sqlite', '.env']
    const blockedFiles = ['package-lock.json', 'styleai.db', 'styleai.db-wal', 'styleai.db-shm']
    const pathParts = normalizedPath.split('/')
    const fileName = pathParts[pathParts.length - 1] || ''
    if (
      blockedDirs.some((d) => pathParts.includes(d)) ||
      blockedExtensions.some((ext) => fileName.endsWith(ext)) ||
      blockedFiles.includes(fileName)
    ) {
      return res
        .status(403)
        .json({ success: false, error: { code: 'FORBIDDEN', message: '禁止访问此文件' } })
    }
    const backendRoot = path.join(__dirname, '..')
    const fullPath = path.join(backendRoot, filePath)

    // 安全检查：防止目录遍历
    const realPath = fs.realpathSync(fullPath)
    const realRoot = fs.realpathSync(backendRoot)
    if (!realPath.startsWith(realRoot)) {
      return res
        .status(403)
        .json({ success: false, error: { code: 'FORBIDDEN', message: '非法路径' } })
    }

    if (!fs.existsSync(fullPath)) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: `文件不存在: ${filePath}` } })
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

      // 用文件名作为标签（简洁明了）
      const label = file.replace('.js', '')

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

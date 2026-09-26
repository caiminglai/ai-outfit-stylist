/**
 * 库存管理路由模块
 * 对应 Python: app/routes/inventory.py
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { adminLoginRequired } = require('../middleware/auth')

const router = express.Router()

/** 安全解析 JSON 字段（数据库中存储为 JSON 字符串） */
function parseJsonField(val) {
  if (val == null) return []
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** 需要反序列化的 JSON 字段 */
const JSON_FIELDS = ['style_tags', 'color_tags', 'season_tags', 'fit_skin_tones', 'fit_face_shapes']

/** 获取库存分类列表 */
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM inventory_categories ORDER BY sort_order').all()
    return sendSuccess(res, categories)
  } catch (err) {
    return sendError(res, '获取失败', 500)
  }
})

/** 获取库存商品列表 */
router.get('/products', (req, res) => {
  try {
    const { category_id, category, enabled, in_stock } = req.query
    let sql =
      'SELECT p.*, c.name as category_name FROM inventory_products p LEFT JOIN inventory_categories c ON p.category_id = c.id WHERE 1=1'
    const params = []

    // 兼容 category_id 和 category(分类code) 两种参数
    if (category_id) {
      sql += ' AND p.category_id = ?'
      params.push(category_id)
    } else if (category) {
      sql += ' AND c.code = ?'
      params.push(category)
    }
    if (enabled !== undefined) {
      sql += ' AND p.enabled = ?'
      params.push(enabled === 'true' || enabled === '1' ? 1 : 0)
    }
    if (in_stock !== undefined) {
      if (in_stock === 'true' || in_stock === '1') {
        sql += ' AND p.stock > 0'
      } else {
        sql += ' AND p.stock <= 0'
      }
    }

    sql += ' ORDER BY p.created_at DESC'
    let products = db.prepare(sql).all(...params)
    // 反序列化 JSON 字段
    products = products.map((p) => {
      const obj = { ...p }
      for (const field of JSON_FIELDS) {
        obj[field] = parseJsonField(p[field])
      }
      return obj
    })
    return sendSuccess(res, products)
  } catch (err) {
    console.error('[库存] 获取商品失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 添加库存商品（管理员） */
router.post('/products', adminLoginRequired, (req, res) => {
  try {
    let {
      category_id,
      category_code,
      name,
      sku,
      style_tags,
      color_tags,
      season_tags,
      fit_skin_tones,
      fit_face_shapes,
      stock,
      price,
      image_url,
      description,
      enabled,
    } = req.body || {}

    // 兼容前端传 category_code 的情况
    if (!category_id && category_code) {
      const cat = db
        .prepare('SELECT id FROM inventory_categories WHERE code = ?')
        .get(category_code)
      if (cat) category_id = cat.id
    }

    const result = db
      .prepare(
        `INSERT INTO inventory_products
        (category_id, name, sku, style_tags, color_tags, season_tags,
         fit_skin_tones, fit_face_shapes, stock, price, image_url,
         description, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        category_id,
        name,
        sku || null,
        JSON.stringify(style_tags || []),
        JSON.stringify(color_tags || []),
        JSON.stringify(season_tags || []),
        JSON.stringify(fit_skin_tones || []),
        JSON.stringify(fit_face_shapes || []),
        stock || 0,
        price || null,
        image_url || null,
        description || null,
        enabled !== false ? 1 : 0,
      )

    return sendSuccess(res, { id: result.lastInsertRowid })
  } catch (err) {
    console.error('[库存] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 更新库存商品（管理员） */
router.put('/products/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    let {
      category_id,
      category_code,
      name,
      sku,
      style_tags,
      color_tags,
      season_tags,
      fit_skin_tones,
      fit_face_shapes,
      stock,
      price,
      image_url,
      description,
      enabled,
    } = req.body || {}

    // 兼容前端传 category_code 的情况
    if (!category_id && category_code) {
      const cat = db
        .prepare('SELECT id FROM inventory_categories WHERE code = ?')
        .get(category_code)
      if (cat) category_id = cat.id
    }

    db.prepare(
      `UPDATE inventory_products SET
        category_id=?, name=?, sku=?, style_tags=?, color_tags=?,
        season_tags=?, fit_skin_tones=?, fit_face_shapes=?, stock=?,
        price=?, image_url=?, description=?, enabled=?
       WHERE id=?`,
    ).run(
      category_id,
      name,
      sku || null,
      JSON.stringify(style_tags || []),
      JSON.stringify(color_tags || []),
      JSON.stringify(season_tags || []),
      JSON.stringify(fit_skin_tones || []),
      JSON.stringify(fit_face_shapes || []),
      stock || 0,
      price || null,
      image_url || null,
      description || null,
      enabled !== false ? 1 : 0,
      id,
    )

    return sendSuccess(res, null)
  } catch (err) {
    console.error('[库存] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除库存商品（管理员） */
router.delete('/products/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    db.prepare('DELETE FROM inventory_products WHERE id = ?').run(id)
    return sendSuccess(res, null)
  } catch (err) {
    return sendError(res, '删除失败', 500)
  }
})

/** 添加库存分类（管理员） */
router.post('/categories', adminLoginRequired, (req, res) => {
  try {
    const { name, code, sort_order } = req.body || {}
    if (!name || !code) {
      return sendError(res, '名称和编码不能为空', 400)
    }
    const result = db
      .prepare('INSERT INTO inventory_categories (name, code, sort_order) VALUES (?, ?, ?)')
      .run(name, code, sort_order || 0)
    return sendSuccess(res, { id: result.lastInsertRowid })
  } catch (err) {
    console.error('[库存] 添加分类失败:', err)
    if (err.message && err.message.includes('UNIQUE')) {
      return sendError(res, '分类编码已存在', 400)
    }
    return sendError(res, '添加失败', 500)
  }
})

/** 更新库存分类（管理员） */
router.put('/categories/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { name, code, sort_order } = req.body || {}
    db.prepare('UPDATE inventory_categories SET name=?, code=?, sort_order=? WHERE id=?').run(
      name,
      code,
      sort_order || 0,
      id,
    )
    return sendSuccess(res, null)
  } catch (err) {
    console.error('[库存] 更新分类失败:', err)
    if (err.message && err.message.includes('UNIQUE')) {
      return sendError(res, '分类编码已存在', 400)
    }
    return sendError(res, '更新失败', 500)
  }
})

/** 删除库存分类（管理员） */
router.delete('/categories/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    // 检查是否有关联商品
    const products = db
      .prepare('SELECT COUNT(*) as count FROM inventory_products WHERE category_id = ?')
      .get(id)
    if (products && products.count > 0) {
      return sendError(res, '该分类下还有 ' + products.count + ' 个商品，无法删除', 400)
    }
    db.prepare('DELETE FROM inventory_categories WHERE id = ?').run(id)
    return sendSuccess(res, null)
  } catch (err) {
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router

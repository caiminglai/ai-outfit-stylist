/**
 * 库存管理路由模块
 * 对应 Python: app/routes/inventory.py
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { asText, asNumber, parseJsonField, toEnabledBit } = require('../utils/common')
const { adminLoginRequired } = require('../middleware/auth')

const router = express.Router()

/** 需要反序列化的 JSON 字段 */
const JSON_FIELDS = ['style_tags', 'color_tags', 'season_tags', 'fit_skin_tones', 'fit_face_shapes']

/**
 * 获取库存分类列表
 * 2026-10-12 补上 adminLoginRequired：这两条 GET 原来是全文件唯一没有闸门的入口
 * （写口 75/142/221/238/260/289 都有），匿名就能把 SKU、库存、价格、上下架整表拉走。
 * 消费方现量只有后台（static/admin/admin-inventory.js:21/53 走 fetchJSON，已带 Bearer token），
 * 展厅 HTML 与 React 端都没有调用点 ⇒ 收紧不会打到现存客户端。
 */
router.get('/categories', adminLoginRequired, (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM inventory_categories ORDER BY sort_order').all()
    return sendSuccess(res, categories)
  } catch (err) {
    return sendError(res, '获取失败', 500)
  }
})

/** 获取库存商品列表（同上一道闸门） */
router.get('/products', adminLoginRequired, (req, res) => {
  try {
    const { category_id, category, enabled, in_stock } = req.query
    let sql =
      'SELECT p.*, c.name as category_name FROM inventory_products p LEFT JOIN inventory_categories c ON p.category_id = c.id WHERE 1=1'
    const params = []

    // 兼容 category_id 和 category(分类code) 两种参数
    // 这两个值要绑进 SQL：`?category_id[]=1` 解析成数组后原样 push ⇒ better-sqlite3 抛 ⇒ 整页 500。
    // 过 asText，非文本当"没这个筛选"（enabled / in_stock 只做字符串比较，保持原样）。
    const catId = asText(category_id)
    const catCode = asText(category)
    if (catId) {
      sql += ' AND p.category_id = ?'
      params.push(catId)
    } else if (catCode) {
      sql += ' AND c.code = ?'
      params.push(catCode)
    }
    // 空串当"没筛"：与本页其它筛选项（category/enabled）的写法一致。
    // 原来只判 !== undefined，`?enabled=` 会被当成"只看下架商品"，
    // 前端少拼一个值就悄悄换了一批结果，看上去还像是筛对了。
    if (enabled !== undefined && enabled !== '') {
      sql += ' AND p.enabled = ?'
      params.push(enabled === 'true' || enabled === '1' ? 1 : 0)
    }
    if (in_stock !== undefined && in_stock !== '') {
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
        .get(asText(category_code))
      if (cat) category_id = cat.id
    }

    // 必备字段先进闸门：库里 name / category_id 都是 NOT NULL，把 undefined 直接绑进去
    // 只会让 SQLite 抛约束错 ⇒ 入参错被回成 500（2026-10-11 实测：空 body 与畸形 body 都 500）
    const productName = asText(name)
    const productCatId = asNumber(category_id, null)
    if (!productName || productCatId === null) {
      return sendError(res, 'name 与 category_id（或能对上的 category_code）为必填', 400)
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
        productCatId,
        productName,
        asText(sku) || null,
        JSON.stringify(style_tags || []),
        JSON.stringify(color_tags || []),
        JSON.stringify(season_tags || []),
        JSON.stringify(fit_skin_tones || []),
        JSON.stringify(fit_face_shapes || []),
        asNumber(stock, 0),
        asNumber(price, null),
        asText(image_url) || null,
        asText(description) || null,
        toEnabledBit(enabled, 1),
      )

    return sendCreated(res, { id: result.lastInsertRowid })
  } catch (err) {
    console.error('[库存] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 更新库存商品（管理员） */
router.put('/products/:id', adminLoginRequired, (req, res) => {
  try {
    // 与 POST /products 同一把闸门：id / name / category_id 缺失或畸形一律 400，
    // 绑进 SQLite 只会变成 500（2026-10-11 实测：空 body 与数组 body 都 500）
    const productId = asNumber(req.params.id, null)
    if (productId === null) {
      return sendError(res, '商品 ID 不合法', 400)
    }
    // 先读一次现值：enabled 这次没带时沿用它。PUT 名义上是整行更新，
    // 但"请求里没提上/下架"不该把刚被下架的商品重新上架（后台每次都带这个字段，
    // 只有脚本会漏 ⇒ 漏一次就悄悄改一次状态）。
    const current = db.prepare('SELECT enabled FROM inventory_products WHERE id = ?').get(productId)
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
        .get(asText(category_code))
      if (cat) category_id = cat.id
    }

    const productName = asText(name)
    const productCatId = asNumber(category_id, null)
    if (!productName || productCatId === null) {
      return sendError(res, 'name 与 category_id（或能对上的 category_code）为必填', 400)
    }

    const result = db
      .prepare(
        `UPDATE inventory_products SET
        category_id=?, name=?, sku=?, style_tags=?, color_tags=?,
        season_tags=?, fit_skin_tones=?, fit_face_shapes=?, stock=?,
        price=?, image_url=?, description=?, enabled=?
       WHERE id=?`,
      )
      .run(
        productCatId,
        productName,
        asText(sku) || null,
        JSON.stringify(style_tags || []),
        JSON.stringify(color_tags || []),
        JSON.stringify(season_tags || []),
        JSON.stringify(fit_skin_tones || []),
        JSON.stringify(fit_face_shapes || []),
        asNumber(stock, 0),
        asNumber(price, null),
        asText(image_url) || null,
        asText(description) || null,
        toEnabledBit(enabled, current ? current.enabled : 1),
        productId,
      )
    if (result.changes === 0) {
      return sendError(res, '商品不存在', 404)
    }

    return sendSuccess(res, null)
  } catch (err) {
    console.error('[库存] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除库存商品（管理员） */
router.delete('/products/:id', adminLoginRequired, (req, res) => {
  try {
    const id = asNumber(req.params.id, null)
    if (id === null) {
      return sendError(res, '商品 ID 不合法', 400)
    }
    const result = db.prepare('DELETE FROM inventory_products WHERE id = ?').run(id)
    if (result.changes === 0) {
      return sendError(res, '商品不存在', 404)
    }
    return sendSuccess(res, null)
  } catch (err) {
    return sendError(res, '删除失败', 500)
  }
})

/** 添加库存分类（管理员） */
router.post('/categories', adminLoginRequired, (req, res) => {
  try {
    const { name, code, sort_order } = req.body || {}
    const categoryName = asText(name)
    const categoryCode = asText(code)
    if (!categoryName || !categoryCode) {
      return sendError(res, '名称和编码不能为空', 400)
    }
    const result = db
      .prepare('INSERT INTO inventory_categories (name, code, sort_order) VALUES (?, ?, ?)')
      .run(categoryName, categoryCode, asNumber(sort_order, 0))
    return sendCreated(res, { id: result.lastInsertRowid })
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
    const id = asNumber(req.params.id, null)
    const { name, code, sort_order } = req.body || {}
    const categoryName = asText(name)
    const categoryCode = asText(code)
    if (id === null) {
      return sendError(res, '分类 ID 不合法', 400)
    }
    if (!categoryName || !categoryCode) {
      return sendError(res, '名称和编码不能为空', 400)
    }
    const result = db
      .prepare('UPDATE inventory_categories SET name=?, code=?, sort_order=? WHERE id=?')
      .run(categoryName, categoryCode, asNumber(sort_order, 0), id)
    if (result.changes === 0) {
      return sendError(res, '分类不存在', 404)
    }
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
    const id = asNumber(req.params.id, null)
    if (id === null) {
      return sendError(res, '分类 ID 不合法', 400)
    }
    // 检查是否有关联商品
    const products = db
      .prepare('SELECT COUNT(*) as count FROM inventory_products WHERE category_id = ?')
      .get(id)
    if (products && products.count > 0) {
      return sendError(res, '该分类下还有 ' + products.count + ' 个商品，无法删除', 400)
    }
    const result = db.prepare('DELETE FROM inventory_categories WHERE id = ?').run(id)
    if (result.changes === 0) {
      return sendError(res, '分类不存在', 404)
    }
    return sendSuccess(res, null)
  } catch (err) {
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router

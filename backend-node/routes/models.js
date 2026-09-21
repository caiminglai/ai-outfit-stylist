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
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');
const { sendSuccess, sendError } = require('../utils/response');
const { adminLoginRequired } = require('../middleware/auth');
const { ICON_MAP, findPmxFiles, parseFolderName, shouldSkipDir, BROKEN_DIR_NAME } = require('../utils/model-utils');

const router = express.Router();

// models 目录绝对路径
const MODELS_DIR = path.join(__dirname, '..', '..', 'models');

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
};

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
    scale: row.scale ?? 1.0,
    pos_x: row.pos_x ?? 0,
    pos_y: row.pos_y ?? 0,
    pos_z: row.pos_z ?? 0,
    rot_x: row.rot_x ?? 0,
    rot_y: row.rot_y ?? 0,
    rot_z: row.rot_z ?? 0,
    camera_distance: row.camera_distance ?? 5.0,
    ambient_light: row.ambient_light ?? 0.6,
  };
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
    exposure: row.exposure ?? 0.3,
    scale: row.scale ?? 1.0,
  };
}

// ============================================================
// GET / — 向后兼容,返回 { models: [] } 格式
// ============================================================
router.get('/', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM model_configs WHERE enabled = 1 ORDER BY sort_order, id')
      .all();
    const models = rows.map(rowToGalleryModel);
    return sendSuccess(res, { models });
  } catch (err) {
    console.error('[模型] 获取列表失败:', err);
    return sendError(res, '获取模型列表失败', 500);
  }
});

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
      .get();
    const etag = `"m-${meta.cnt}-${meta.last_mod || '0'}"`;

    // 条件请求:304 Not Modified
    if (req.get('If-None-Match') === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache'); // 总是验证,但可 304

    const rows = db
      .prepare('SELECT * FROM model_configs WHERE enabled = 1 ORDER BY sort_order, id')
      .all();
    const models = rows.map(rowToGalleryModel);
    return sendSuccess(res, models);
  } catch (err) {
    console.error('[模型] 获取启用列表失败:', err);
    return sendError(res, '获取模型列表失败', 500);
  }
});

// ============================================================
// GET /admin/list — 管理后台获取所有模型(含禁用)
// 返回: { success: true, data: [{ id, name, icon, desc, folder, source, enabled, exposure, sort_order }] }
// ============================================================
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM model_configs ORDER BY sort_order, id').all();
    const models = rows.map(rowToAdminModel);
    return sendSuccess(res, models);
  } catch (err) {
    console.error('[模型] 获取管理列表失败:', err);
    return sendError(res, '获取模型列表失败', 500);
  }
});

// ============================================================
// POST /admin/scan — 扫描 models 目录,将新模型入库
// 返回: { models: [...], stats: { total, new, skipped } }
// ============================================================
router.post('/admin/scan', adminLoginRequired, (req, res) => {
  try {
    if (!fs.existsSync(MODELS_DIR)) {
      return sendError(res, 'models 目录不存在', 404);
    }

    const topDirs = fs
      .readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !shouldSkipDir(d.name));

    let newCount = 0;
    let total = 0;
    let skipped = 0;

    for (const dir of topDirs) {
      const { name, source } = parseFolderName(dir.name);
      const pmxFiles = findPmxFiles(path.join(MODELS_DIR, dir.name), dir.name);

      for (const pmx of pmxFiles) {
        total++;
        const existing = db
          .prepare('SELECT id FROM model_configs WHERE folder = ? AND file = ?')
          .get(pmx.relPath, pmx.fileName);

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
          );
          newCount++;
        } else {
          skipped++;
        }
      }
    }

    // 返回完整的模型列表 + 统计信息
    const rows = db.prepare('SELECT * FROM model_configs ORDER BY sort_order, id').all();
    const models = rows.map(rowToAdminModel);

    // ★ 扫描后顺便清理:删除残缺模型记录 + .pmx 文件缺失的记录
    const cleanedUp = cleanupMissingRecords();

    return sendSuccess(res, {
      models,
      stats: { total, new: newCount, skipped, cleanedUp },
    });
  } catch (err) {
    console.error('[模型] 扫描失败:', err);
    return sendError(res, '扫描模型失败', 500);
  }
});

/**
 * 清理失效模型记录(供 /admin/scan 调用)
 * 1. folder 路径以 "残缺模型/" 开头 → 用户已手动归集
 * 2. .pmx 文件实际不存在 → 文件被删除
 * @returns {{ removedBroken: number, removedMissing: number }}
 */
function cleanupMissingRecords() {
  let removedBroken = 0;
  let removedMissing = 0;

  // 1. 删除已归入"残缺模型"文件夹的记录
  const brokenRows = db
    .prepare(`SELECT id, name, folder FROM model_configs WHERE folder = ? OR folder LIKE ?`)
    .all(BROKEN_DIR_NAME, BROKEN_DIR_NAME + '/%');
  if (brokenRows.length > 0) {
    const del = db.prepare(`DELETE FROM model_configs WHERE id IN (${brokenRows.map(() => '?').join(',')})`);
    del.run(...brokenRows.map((r) => r.id));
    removedBroken = brokenRows.length;
    console.log(`[模型清理] 已删除 ${removedBroken} 条残缺模型记录`);
  }

  // 2. 删除 .pmx 文件实际不存在的记录
  const allRows = db.prepare('SELECT id, name, folder, file FROM model_configs').all();
  const missingIds = [];
  for (const row of allRows) {
    const fullPath = path.join(MODELS_DIR, row.folder, row.file);
    if (!fs.existsSync(fullPath)) {
      missingIds.push(row.id);
    }
  }
  if (missingIds.length > 0) {
    const del = db.prepare(`DELETE FROM model_configs WHERE id IN (${missingIds.map(() => '?').join(',')})`);
    del.run(...missingIds);
    removedMissing = missingIds.length;
    console.log(`[模型清理] 已删除 ${removedMissing} 条文件缺失记录`);
  }

  return { removedBroken, removedMissing };
}

// ============================================================
// POST /admin/:id/toggle — 切换模型启用/禁用
// ============================================================
router.post('/admin/:id/toggle', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id);

    if (!row) {
      return sendError(res, '模型不存在', 404);
    }

    const newEnabled = row.enabled === 1 ? 0 : 1;
    db.prepare(
      "UPDATE model_configs SET enabled = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(newEnabled, id);

    return sendSuccess(
      res,
      { enabled: newEnabled === 1 },
      newEnabled === 1 ? '模型已启用' : '模型已禁用',
    );
  } catch (err) {
    console.error('[模型] 切换状态失败:', err);
    return sendError(res, '操作失败', 500);
  }
});

// ============================================================
// PUT /admin/:id — 更新模型设置(name, desc, exposure, sort_order, source, icon, image_preview, scale, pos_x/y/z, rot_x/y/z, camera_distance, ambient_light)
// ============================================================
router.put('/admin/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id);

    if (!row) {
      return sendError(res, '模型不存在', 404);
    }

    const {
      name,
      desc,
      exposure,
      sort_order,
      source,
      icon,
      image_preview,
      scale,
      pos_x,
      pos_y,
      pos_z,
      rot_x,
      rot_y,
      rot_z,
      camera_distance,
      ambient_light,
    } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (desc !== undefined) {
      updates.push('description = ?');
      params.push(desc);
    }
    if (exposure !== undefined) {
      updates.push('exposure = ?');
      params.push(exposure);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(sort_order);
    }
    if (source !== undefined) {
      updates.push('source = ?');
      params.push(source);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      params.push(icon);
    }
    if (image_preview !== undefined) {
      updates.push('image_preview = ?');
      params.push(image_preview);
    }
    if (scale !== undefined) {
      updates.push('scale = ?');
      params.push(scale);
    }
    if (pos_x !== undefined) {
      updates.push('pos_x = ?');
      params.push(pos_x);
    }
    if (pos_y !== undefined) {
      updates.push('pos_y = ?');
      params.push(pos_y);
    }
    if (pos_z !== undefined) {
      updates.push('pos_z = ?');
      params.push(pos_z);
    }
    if (rot_x !== undefined) {
      updates.push('rot_x = ?');
      params.push(rot_x);
    }
    if (rot_y !== undefined) {
      updates.push('rot_y = ?');
      params.push(rot_y);
    }
    if (rot_z !== undefined) {
      updates.push('rot_z = ?');
      params.push(rot_z);
    }
    if (camera_distance !== undefined) {
      updates.push('camera_distance = ?');
      params.push(camera_distance);
    }
    if (ambient_light !== undefined) {
      updates.push('ambient_light = ?');
      params.push(ambient_light);
    }

    if (updates.length === 0) {
      return sendError(res, '无更新字段', 400);
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    db.prepare(`UPDATE model_configs SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id);
    return sendSuccess(res, rowToAdminModel(updated));
  } catch (err) {
    console.error('[模型] 更新设置失败:', err);
    return sendError(res, '更新失败', 500);
  }
});

// ============================================================
// DELETE /admin/:id — 删除模型配置(管理员)
// ============================================================
router.delete('/admin/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id);
    if (!row) {
      return sendError(res, '模型不存在', 404);
    }
    db.prepare('DELETE FROM model_configs WHERE id = ?').run(id);
    return sendSuccess(res, null, '模型已删除');
  } catch (err) {
    console.error('[模型] 删除失败:', err);
    return sendError(res, '删除失败', 500);
  }
});

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
router.get('/file/*', (req, res) => {
  try {
    // req.params[0] 包含通配符匹配的路径
    const relPath = req.params[0];
    if (!relPath) {
      return sendError(res, '文件路径不能为空', 400);
    }

    // 安全检查:防止目录遍历(去除 ../ 前缀)
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(MODELS_DIR, safePath);

    // 确保路径在 models 目录内
    const realModelsDir = fs.realpathSync(MODELS_DIR);
    let realFullPath;
    try {
      realFullPath = fs.realpathSync(fullPath);
    } catch {
      return sendError(res, '文件不存在', 404);
    }

    if (!realFullPath.startsWith(realModelsDir)) {
      return sendError(res, '非法路径', 403);
    }

    if (!fs.existsSync(fullPath)) {
      return sendError(res, '文件不存在', 404);
    }

    // ★ 加速优化:优先发送 .gz 预压缩文件
    const acceptsGzip = (req.get('Accept-Encoding') || '').includes('gzip');
    const gzPath = fullPath + '.gz';
    const ext = path.extname(fullPath).toLowerCase();

    // ★ 纹理文件(.png/.jpg/.tga 等)特殊处理:
    // 1. 不使用 .gz 预压缩(避免浏览器解压后数据损坏)
    // 2. 禁用缓存(防止之前加载失败的空纹理被缓存)
    const TEXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.gif', '.webp'];
    const isTexture = TEXTURE_EXTENSIONS.includes(ext);

    if (isTexture) {
      // 纹理:禁用缓存,确保每次加载获取最新数据
      const mimeType = MODEL_FILE_MIME[ext] || 'image/png';
      return res.sendFile(fullPath, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // 非纹理文件:正常处理
    if (acceptsGzip && fs.existsSync(gzPath)) {
      const mimeType = MODEL_FILE_MIME[ext] || 'application/octet-stream';
      // sendFile 会自动生成 ETag(基于 .gz 内容)和处理 304 条件请求
      // headers 中设置的 Content-Type 会覆盖 sendFile 基于 .gz 扩展名的默认推断
      return res.sendFile(gzPath, {
        headers: {
          'Content-Encoding': 'gzip',
          'Content-Type': mimeType,
          Vary: 'Accept-Encoding',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return res.sendFile(fullPath);
  } catch (err) {
    console.error('[模型] 文件服务失败:', err);
    return sendError(res, '文件服务错误', 500);
  }
});

module.exports = router;

/**
 * 规则引擎管理路由模块
 * 对应 Python: app/routes/rules.py
 */
const express = require('express');
const db = require('../db/init');
const { sendSuccess, sendError } = require('../utils/response');
const { adminLoginRequired } = require('../middleware/auth');
const { explainGroup } = require('../services/ruleExplainer');
const { buildRecommendation } = require('../services/recommendEngine');

const router = express.Router();

/** 获取规则组列表 */
router.get('/groups', (req, res) => {
  try {
    const { mode, category, enabled } = req.query;
    let sql = 'SELECT * FROM rule_groups WHERE 1=1';
    const params = [];

    if (mode) {
      sql += ' AND mode = ?';
      params.push(mode);
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(enabled === 'true' || enabled === '1' ? 1 : 0);
    }

    sql += ' ORDER BY priority DESC, created_at DESC';
    const groups = db.prepare(sql).all(...params);
    return sendSuccess(res, { groups, total: groups.length });
  } catch (err) {
    return sendError(res, '获取失败', 500);
  }
});

/** 获取单个规则组详情(含条件和动作) */
router.get('/groups/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const group = db.prepare('SELECT * FROM rule_groups WHERE id = ?').get(id);
    if (!group) {
      return sendError(res, '规则组不存在', 404);
    }

    const conditions = db.prepare('SELECT * FROM rule_conditions WHERE group_id = ?').all(id);
    const actions = db
      .prepare('SELECT * FROM rule_actions WHERE group_id = ? ORDER BY sort_order')
      .all(id);

    return sendSuccess(res, { group, conditions, actions });
  } catch (err) {
    return sendError(res, '获取失败', 500);
  }
});

/** 创建规则组(管理员) */
router.post('/groups', adminLoginRequired, (req, res) => {
  try {
    const {
      name,
      mode,
      gender,
      category,
      scenario,
      region,
      age_range,
      description,
      priority,
      enabled,
    } = req.body || {};

    const result = db
      .prepare(
        `INSERT INTO rule_groups
        (name, mode, gender, category, scenario, region, age_range, description, priority, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        mode || 'store',
        gender || null,
        category,
        scenario || null,
        region || null,
        age_range || null,
        description || null,
        priority || 0,
        enabled !== false ? 1 : 0,
      );

    return sendSuccess(res, { id: result.lastInsertRowid });
  } catch (err) {
    console.error('[规则] 创建失败:', err);
    return sendError(res, '创建失败', 500);
  }
});

/** 更新规则组(管理员) */
router.put('/groups/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      name,
      mode,
      gender,
      category,
      scenario,
      region,
      age_range,
      description,
      priority,
      enabled,
    } = req.body || {};

    db.prepare(
      `UPDATE rule_groups SET
        name=?, mode=?, gender=?, category=?, scenario=?,
        region=?, age_range=?, description=?, priority=?, enabled=?
       WHERE id=?`,
    ).run(
      name,
      mode,
      gender || null,
      category,
      scenario || null,
      region || null,
      age_range || null,
      description || null,
      priority || 0,
      enabled !== false ? 1 : 0,
      id,
    );

    return sendSuccess(res, null);
  } catch (err) {
    console.error('[规则] 更新失败:', err);
    return sendError(res, '更新失败', 500);
  }
});

/** 删除规则组(管理员) */
router.delete('/groups/:id', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM rule_actions WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM rule_conditions WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM rule_groups WHERE id = ?').run(id);
    return sendSuccess(res, null);
  } catch (err) {
    return sendError(res, '删除失败', 500);
  }
});

/** 切换规则组启用/禁用状态(管理员) */
router.post('/groups/:id/toggle', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const group = db.prepare('SELECT enabled FROM rule_groups WHERE id = ?').get(id);
    if (!group) {
      return sendError(res, '规则组不存在', 404);
    }
    const newEnabled = group.enabled ? 0 : 1;
    db.prepare('UPDATE rule_groups SET enabled = ? WHERE id = ?').run(newEnabled, id);
    return sendSuccess(res, { enabled: newEnabled === 1 });
  } catch (err) {
    console.error('[规则] 切换状态失败:', err);
    return sendError(res, '操作失败', 500);
  }
});

/** 预览规则匹配(管理员) */
router.post('/preview', adminLoginRequired, (req, res) => {
  try {
    const { profile, mode } = req.body || {};
    if (!profile) {
      return sendError(res, '缺少用户画像数据', 400);
    }

    // 直接调用推荐引擎(已修复 category 映射 bug + 带可解释性说明 explanation)
    // 修复原 /preview 的 bug:原逻辑用 operator '==' 但数据库存的是 'eq',且未解析 value JSON
    const recommendation = buildRecommendation(profile, mode || 'store', false);

    const total =
      (recommendation.穿搭?.length || 0) +
      (recommendation.妆容?.length || 0) +
      (recommendation.发型?.length || 0) +
      (recommendation.配饰?.length || 0);

    return sendSuccess(res, { recommendation, total });
  } catch (err) {
    console.error('[规则] 预览失败:', err);
    return sendError(res, '预览失败', 500);
  }
});

/**
 * 浏览规则(面向普通用户,带中文解释,无需登录)
 *
 * 让用户看懂规则引擎:返回所有启用的规则组,每条带中文人话解释,
 * 用户能理解"我填什么档案能匹配到什么规则".
 *
 * 查询参数:
 *   - mode: store(门店)/personal(个人),默认 store
 *   - category: 穿搭/妆容/发型/配饰/姿势
 *   - gender: 女/男
 *   - scenario: 通勤/约会/...
 */
router.get('/browse', (req, res) => {
  try {
    const { mode, category, gender, scenario } = req.query;
    let sql = 'SELECT * FROM rule_groups WHERE enabled = 1';
    const params = [];

    if (mode) {
      sql += ' AND mode = ?';
      params.push(mode);
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (gender) {
      sql += ' AND (gender = ? OR gender IS NULL)';
      params.push(gender);
    }
    if (scenario) {
      sql += ' AND (scenario = ? OR scenario IS NULL)';
      params.push(scenario);
    }

    sql += ' ORDER BY category, priority DESC, created_at DESC';
    const groups = db.prepare(sql).all(...params);

    if (groups.length === 0) {
      return sendSuccess(res, { rules: [], total: 0 });
    }

    // 批量加载所有条件(避免 N+1 查询)
    const groupIds = groups.map((g) => g.id);
    const placeholders = groupIds.map(() => '?').join(',');
    const allConditions = db
      .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${placeholders})`)
      .all(...groupIds);

    const conditionsByGroup = {};
    for (const c of allConditions) {
      (conditionsByGroup[c.group_id] ||= []).push(c);
    }

    // 用 explainGroup 生成中文概览,让普通人看懂规则
    const rules = groups.map((g) => {
      const conds = conditionsByGroup[g.id] || [];
      const overview = explainGroup(g, conds);
      return {
        id: g.id,
        ...overview,
      };
    });

    return sendSuccess(res, { rules, total: rules.length });
  } catch (err) {
    console.error('[规则] 浏览失败:', err);
    return sendError(res, '获取失败', 500);
  }
});

module.exports = router;

/* ══════════════════════════════════════════════════════════════
   管理后台 — 全局状态、常量与工具函数

   依赖: 无(最先加载)
   ══════════════════════════════════════════════════════════════ */

/* ── API 地址常量 ── */
var API_BASE = '/admin/api';
var RULES_API = '/api/rules';
var INV_API = '/api/inventory';
var MODELS_API = '/api/models';

/* ── 全局状态 ── */
var State = {
  tables: [],
  functions: [],
  rules: [],
  categories: [],
  products: [],
  models: [],
  currentTable: null,
  currentPage: 1,
  perPage: 20,
  editingRuleId: null,
  editingProductId: null,
};

/* ── 中文标签映射 ── */
var CATEGORY_LABELS = {
  '穿搭': '穿搭', '妆容': '美妆', '发型': '发型', '配饰': '配饰', '姿势': '姿势'
};
var SCENARIO_LABELS = {
  '通勤': '通勤', '约会': '约会', '面试': '面试', '休闲': '休闲', '聚会': '聚会'
};

/* ── 数据值翻译映射（显示用，不改数据库原始值）── */
var VALUE_LABELS = {
  // rule_groups.mode
  'rule_groups.mode': { 'store': '门店', 'personal': '个人' },
  // rule_groups.category
  'rule_groups.category': { '穿搭': '穿搭', '妆容': '美妆', '发型': '发型', '配饰': '配饰', '姿势': '姿势' },
  // rule_groups.enabled / inventory_products.enabled / model_configs.enabled 等
  'rule_groups.enabled': { '1': '启用', '0': '禁用', 1: '启用', 0: '禁用' },
  'inventory_products.enabled': { '1': '上架', '0': '下架', 1: '上架', 0: '下架' },
  'model_configs.enabled': { '1': '启用', '0': '禁用', 1: '启用', 0: '禁用' },
  'admin_users.is_active': { '1': '启用', '0': '禁用', 1: '启用', 0: '禁用' },
  // face_features.status
  'face_features.status': { 'pending': '待处理', 'done': '完成', 'error': '错误' },
  // tryon_results.status
  'tryon_results.status': { 'pending': '处理中', 'done': '完成', 'failed': '失败' },
  // shopping_wishlist
  'shopping_wishlist.status': { 'pending': '待买', 'bought': '已买' },
  'shopping_wishlist.priority': { 'low': '低', 'medium': '中', 'high': '高' },
  // customer_sessions.synced
  'customer_sessions.synced': { '1': '已同步', '0': '未同步', 1: '已同步', 0: '未同步' },
  // recommendation_logs.mode
  'recommendation_logs.mode': { 'store': '门店', 'personal': '个人' },
  // photos.type
  'photos.type': { 'face': '面部', 'body': '全身', 'cloth': '衣物' },
  // rule_conditions.field
  'rule_conditions.field': {
    'gender': '性别', 'category': '分类', 'scenario': '场景', 'skin_tone': '肤色',
    'face_shape': '脸型', 'region': '地区', 'body_type': '体型', 'bmi_level': 'BMI等级',
    'preferred_style': '偏好风格', 'main_goal': '主要目标', 'posture': '体态',
    'eye_size': '眼睛大小', 'nose_bridge': '鼻梁', 'lip_thickness': '嘴唇厚度',
    'season': '季节', 'age_range': '年龄段'
  },
  // rule_conditions.operator
  'rule_conditions.operator': { 'eq': '等于', 'in': '包含', 'ne': '不等于', 'gt': '大于', 'lt': '小于', 'gte': '大于等于', 'lte': '小于等于' },
  // rule_actions.action_type
  'rule_actions.action_type': {
    'top_style': '上装风格', 'bottom_style': '下装风格', 'shoe_style': '鞋履风格',
    'color_combo': '色彩搭配', 'reason': '推荐理由', 'makeup_style': '妆容风格',
    'lip_color': '唇色', 'foundation': '粉底', 'eye_shadow': '眼影', 'blush': '腮红',
    'eyebrow': '眉型', 'technique': '技巧', 'hairstyle': '发型', 'hair_color': '发色',
    'bang_type': '刘海类型', 'hair_length': '发长', 'avoid': '避免事项',
    'earring_type': '耳饰类型', 'necklace_type': '项链类型', 'bag_style': '包款',
    'metal_color': '金属色', 'outerwear': '外套', 'makeup_base': '妆前乳',
    'lipstick': '口红', 'eyeshadow': '眼影', 'eyeliner': '眼线',
    'earring': '耳饰', 'necklace': '项链', 'bag': '包', 'watch': '手表',
    'belt': '腰带', 'bracelet': '手链', 'ring': '戒指',
    'earring_avoid': '避免耳饰', 'necklace_avoid': '避免项链', 'accessory': '配饰',
    'tie': '领带', 'cufflink': '袖扣', 'skincare': '护肤',
    'lip_care': '唇部护理', 'face_care': '面部护理',
    'outfit_key': '穿搭要点', 'makeup_key': '美妆要点', 'accessory_key': '配饰要点',
    'cross_tip': '跨柜提示', 'spring': '春季建议', 'summer': '夏季建议',
    'autumn': '秋季建议', 'winter': '冬季建议', 'pose_key': '姿势要点',
    'head_pose': '头部姿势', 'hand_pose': '手部姿势', 'upper_body': '上半身姿势',
    'lower_body': '下半身姿势', 'camera_hint': '拍摄建议', 'expression': '表情'
  },
};

/**
 * 翻译数据值：根据表名+列名查找翻译映射，返回中文显示值
 * 如果没有翻译映射，返回原始值
 */
function translateValue(tableName, columnName, value) {
  if (value === null || value === undefined) return value;
  var key = tableName + '.' + columnName;
  var map = VALUE_LABELS[key];
  if (map && map[value] !== undefined) return map[value];
  return value;
}

/* ── 数据库表中英文对照 ── */
var TABLE_LABELS = {
  'users': '用户表',
  'photos': '照片表',
  'face_features': '人脸特征表',
  'body_metrics': '身体数据表',
  'recommendations': '推荐记录表',
  'tryon_results': '试穿结果表',
  'rule_groups': '规则组表',
  'rule_conditions': '规则条件表',
  'rule_actions': '规则动作表',
  'inventory_categories': '库存分类表',
  'inventory_products': '库存商品表',
  'customer_sessions': '顾客会话表',
  'recommendation_logs': '推荐日志表',
  'clothing_items': '衣服照片表',
  'user_wardrobe': '用户衣橱表',
  'wardrobe_outfits': '衣橱搭配表',
  'shopping_wishlist': '购物心愿单表',
  'user_cosmetics': '用户化妆品表',
  'user_accessories': '用户配饰表',
  'admin_users': '管理员表',
  'model_configs': '3D模型配置表',
  'styleai_config': '系统配置表',
};

/* ── 字段中英文注释 ── */
var COLUMN_COMMENTS = {
  // users 用户/游客表
  'users': {
    'id': '主键ID',
    'session_id': '会话ID',
    'phone': '手机号',
    'nickname': '昵称',
    'gender': '性别',
    'created_at': '创建时间',
  },
  // photos 照片表
  'photos': {
    'id': '主键ID',
    'user_id': '用户ID',
    'url': '照片URL',
    'type': '类型(face=面部)',
    'uploaded_at': '上传时间',
  },
  // face_features 面容分析表
  'face_features': {
    'id': '主键ID',
    'user_id': '用户ID',
    'photo_id': '照片ID',
    'skin_tone': '肤色',
    'skin_undertone': '肤色底调',
    'skin_depth': '肤色深浅',
    'skin_type': '肤质',
    'face_shape': '脸型',
    'eye_shape': '眼型',
    'eye_spacing': '眼距',
    'nose_type': '鼻型',
    'lip_shape': '唇形',
    'eyebrow_type': '眉型',
    'forehead_width': '额头宽度',
    'jawline_type': '下颌线类型',
    'face_ratio': '面部比例',
    'features_json': '特征JSON',
    'status': '状态',
    'created_at': '创建时间',
  },
  // body_metrics 身体指标表
  'body_metrics': {
    'id': '主键ID',
    'user_id': '用户ID',
    'height_cm': '身高(cm)',
    'weight_kg': '体重(kg)',
    'body_type': '体型',
    'shoulder_width_cm': '肩宽(cm)',
    'waist_cm': '腰围(cm)',
    'hip_cm': '臀围(cm)',
    'leg_length_ratio': '腿长比例',
    'bust_cm': '胸围(cm)',
    'neck_length': '颈部长度',
    'updated_at': '更新时间',
  },
  // recommendations 穿搭推荐记录表
  'recommendations': {
    'id': '主键ID',
    'user_id': '用户ID',
    'photo_id': '照片ID',
    'scenario': '场景',
    'result_json': '推荐结果JSON',
    'created_at': '创建时间',
  },
  // tryon_results 虚拟试穿结果表
  'tryon_results': {
    'id': '主键ID',
    'user_id': '用户ID',
    'photo_id': '照片ID',
    'recommendation_id': '推荐ID',
    'result_url': '结果图URL',
    'status': '状态',
    'created_at': '创建时间',
  },
  // clothing_items 衣服照片上传记录表
  'clothing_items': {
    'id': '主键ID',
    'session_id': '会话ID',
    'filename': '文件名',
    'image_url': '图片URL',
    'category': '类别',
    'color': '颜色',
    'style': '风格',
    'season': '季节',
    'usage': '用途',
    'item_name': '物品名称',
    'created_at': '创建时间',
  },
  // rule_groups 规则组表
  'rule_groups': {
    'id': '主键ID',
    'name': '规则组名称',
    'mode': '模式',
    'gender': '性别',
    'category': '分类',
    'scenario': '场景',
    'region': '地区',
    'age_range': '年龄段',
    'description': '描述',
    'priority': '优先级',
    'enabled': '是否启用',
    'hit_count': '命中次数',
    'created_at': '创建时间',
  },
  // rule_conditions 规则条件表
  'rule_conditions': {
    'id': '主键ID',
    'group_id': '规则组ID',
    'field': '条件字段',
    'operator': '操作符',
    'value': '条件值',
    'weight': '权重',
  },
  // rule_actions 规则动作表
  'rule_actions': {
    'id': '主键ID',
    'group_id': '规则组ID',
    'action_type': '动作类型',
    'content': '动作内容',
    'sort_order': '排序',
  },
  // inventory_categories 商品分类表
  'inventory_categories': {
    'id': '主键ID',
    'name': '分类名称',
    'code': '分类编码',
    'sort_order': '排序',
  },
  // inventory_products 库存商品表
  'inventory_products': {
    'id': '主键ID',
    'category_id': '分类ID',
    'name': '商品名称',
    'sku': 'SKU编号',
    'style_tags': '风格标签(JSON)',
    'color_tags': '颜色标签(JSON)',
    'season_tags': '季节标签(JSON)',
    'fit_skin_tones': '适合肤色(JSON)',
    'fit_face_shapes': '适合脸型(JSON)',
    'stock': '库存数量',
    'price': '价格(¥)',
    'image_url': '商品图片URL',
    'description': '商品描述',
    'enabled': '是否上架',
    'created_at': '创建时间',
  },
  // customer_sessions 顾客会话表
  'customer_sessions': {
    'id': '主键ID',
    'session_id': '会话ID',
    'profile_data': '档案数据(JSON)',
    'synced': '是否已同步',
    'synced_at': '同步时间',
    'created_at': '创建时间',
    'expires_at': '过期时间',
  },
  // recommendation_logs 推荐日志表
  'recommendation_logs': {
    'id': '主键ID',
    'session_id': '会话ID',
    'mode': '模式',
    'input_snapshot': '输入快照',
    'result': '推荐结果(JSON)',
    'created_at': '创建时间',
  },
  // user_wardrobe 个人衣橱表
  'user_wardrobe': {
    'id': '主键ID',
    'session_id': '会话ID',
    'user_id': '用户ID',
    'name': '衣物名称',
    'category': '主类别',
    'sub_category': '子类别',
    'color': '主色',
    'color_tags': '颜色标签(JSON)',
    'pattern': '图案',
    'style_tags': '风格标签(JSON)',
    'season_tags': '季节标签(JSON)',
    'occasion_tags': '场合标签(JSON)',
    'fit_body_types': '适合体型(JSON)',
    'fit_skin_tones': '适合肤色(JSON)',
    'condition': '成色',
    'purchase_date': '购入日期',
    'price': '价格(¥)',
    'is_favorite': '是否收藏',
    'image_url': '图片URL',
    'created_at': '创建时间',
    'updated_at': '更新时间',
  },
  // wardrobe_outfits 搭配组合表
  'wardrobe_outfits': {
    'id': '主键ID',
    'session_id': '会话ID',
    'user_id': '用户ID',
    'name': '搭配名称',
    'item_ids': '衣物ID列表(JSON)',
    'occasion': '场合',
    'season': '季节',
    'rating': '评分',
    'notes': '备注',
    'is_favorite': '是否收藏',
    'created_at': '创建时间',
  },
  // shopping_wishlist 购物心愿单
  'shopping_wishlist': {
    'id': '主键ID',
    'session_id': '会话ID',
    'user_id': '用户ID',
    'item_name': '物品名称',
    'category': '类别',
    'color': '颜色',
    'reason': '购买理由',
    'priority': '优先级',
    'status': '状态',
    'gap_type': '缺口类型',
    'created_at': '创建时间',
  },
  // admin_users 管理员表
  'admin_users': {
    'id': '主键ID',
    'username': '用户名',
    'password_hash': '密码哈希',
    'role': '角色',
    'is_active': '是否启用',
    'last_login_at': '最后登录时间',
    'created_at': '创建时间',
  },
  // user_cosmetics 个人化妆品柜表
  'user_cosmetics': {
    'id': '主键ID',
    'session_id': '会话ID',
    'user_id': '用户ID',
    'name': '化妆品名称',
    'brand': '品牌',
    'category': '主类别',
    'sub_category': '子类别',
    'color_name': '色号名称',
    'color_tone': '色调',
    'color_family': '色系',
    'finish': '妆效(哑光/珠光等)',
    'skin_tone_fit': '适合肤色(JSON)',
    'skin_type_fit': '适合肤质(JSON)',
    'face_shape_fit': '适合脸型(JSON)',
    'eye_shape_fit': '适合眼型(JSON)',
    'lip_shape_fit': '适合唇形(JSON)',
    'occasion_tags': '场合标签(JSON)',
    'style_tags': '风格标签(JSON)',
    'coverage': '遮瑕度',
    'opened_date': '开瓶日期',
    'expiry_months': '保质期(月)',
    'remaining': '剩余量(%)',
    'condition': '状态',
    'price': '价格(¥)',
    'image_url': '图片URL',
    'is_favorite': '是否收藏',
    'notes': '备注',
    'created_at': '创建时间',
    'updated_at': '更新时间',
  },
  // user_accessories 个人配饰柜表
  'user_accessories': {
    'id': '主键ID',
    'session_id': '会话ID',
    'user_id': '用户ID',
    'name': '配饰名称',
    'brand': '品牌',
    'category': '主类别',
    'material': '材质',
    'metal_color': '金属色',
    'gem_color': '宝石色',
    'shape': '形状',
    'length': '长度',
    'face_shape_fit': '适合脸型(JSON)',
    'neck_length_fit': '适合颈长(JSON)',
    'skin_tone_fit': '适合肤色(JSON)',
    'allergy_safe': '防过敏',
    'allergy_notes': '过敏备注',
    'occasion_tags': '场合标签(JSON)',
    'style_tags': '风格标签(JSON)',
    'season_tags': '季节标签(JSON)',
    'condition': '成色',
    'price': '价格(¥)',
    'image_url': '图片URL',
    'is_favorite': '是否收藏',
    'created_at': '创建时间',
    'updated_at': '更新时间',
  },
  // model_configs 3D模型配置表
  'model_configs': {
    'id': '主键ID',
    'name': '模型名称',
    'icon': '图标',
    'image_preview': '预览图URL',
    'description': '描述',
    'folder': '文件夹路径',
    'file': '文件名',
    'source': '来源(游戏名)',
    'enabled': '是否启用',
    'exposure': '曝光值',
    'sort_order': '排序',
    'scale': '缩放比例',
    'pos_x': 'X轴位置',
    'pos_y': 'Y轴位置',
    'pos_z': 'Z轴位置',
    'rot_x': 'X轴旋转',
    'rot_y': 'Y轴旋转',
    'rot_z': 'Z轴旋转',
    'camera_distance': '相机距离',
    'ambient_light': '环境光强度',
    'created_at': '创建时间',
    'updated_at': '更新时间',
  },
};

/* 获取字段中文注释 */
function getColumnComment(tableName, columnName) {
  var tableComments = COLUMN_COMMENTS[tableName];
  if (tableComments && tableComments[columnName]) {
    return tableComments[columnName];
  }
  return '';
}

/* 表名 → 中文显示(中文优先,括号附英文原名) */
function tableLabel(name) {
  var label = TABLE_LABELS[name];
  return label ? label + ' (' + name + ')' : name;
}

/* ── 工具函数 ── */

/** HTML 转义,防 XSS */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  if (typeof s === 'object') s = JSON.stringify(s, null, 2);
  s = String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 顶部 Toast 提示(3秒自动消失) */
function showToast(msg, type) {
  var div = document.createElement('div');
  div.className = type === 'error' ? 'error-msg' : (type === 'success' ? 'success-msg' : 'success-msg');
  div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2000;max-width:400px;animation:fadeIn .2s;';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(function() { div.remove(); }, 3000);
}

/** 通用 JSON 请求(自动携带 Token,401 自动跳登录) */
function fetchJSON(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  var token = localStorage.getItem('admin_token');
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  if (options.body && typeof options.body === 'object') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(url, options).then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('application/json') === -1) {
      throw new Error('服务器返回了非JSON响应(HTTP ' + r.status + '),可能服务未启动或路由不存在');
    }
    if (r.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.replace('/admin/login');
      throw new Error('登录已过期');
    }
    return r.json();
  });
}

/** 简化的 API 调用(method + data) */
function apiCall(url, method, data) {
  var opts = { method: method || 'GET', headers: {} };
  var token = localStorage.getItem('admin_token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (data) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  return fetch(url, opts).then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('application/json') === -1) {
      throw new Error('服务器返回了非JSON响应(HTTP ' + r.status + '),可能服务未启动或路由不存在');
    }
    if (r.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.replace('/admin/login');
      throw new Error('登录已过期');
    }
    return r.json();
  });
}

/* ── 导航切换 ── */
function switchSection(section) {
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  var navBtn = document.querySelector('[data-section="' + section + '"]');
  if (navBtn) navBtn.classList.add('active');

  document.querySelectorAll('#sidebar-functions .sidebar-item').forEach(function(i) { i.classList.remove('active'); });
  var sideItem = document.querySelector('#sidebar-functions [data-nav="' + section + '"]');
  if (sideItem) sideItem.classList.add('active');

  document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
  var sec = document.getElementById('section-' + section);
  if (sec) sec.classList.add('active');

  if (section === 'rules') loadRules();
  if (section === 'inventory') loadInventory();
  if (section === 'models') loadModels();
  if (section === 'tables' && State.tables.length === 0) loadTables();
  if (section === 'functions' && State.functions.length === 0) loadFunctions();
  if (section === 'routes') loadRoutes();
}

/* ── 统计概览 ── */
function loadStats() {
  fetchJSON(API_BASE + '/stats').then(function(res) {
    if (res.success) {
      Object.keys(res.data).forEach(function(key) {
        var el = document.getElementById('stat-' + key);
        if (el) el.textContent = res.data[key];
      });
    }
  }).catch(function(e) { console.error('统计加载失败:', e); });
}

-- ============================================================
-- Style AI 数据库 Schema（从 Python SQLAlchemy models.py 翻译）
-- 共 20 张表，与 Python 版完全兼容
-- ============================================================

-- 开启 WAL 模式提升并发读写性能
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- A. 基础用户表
-- ============================================================

-- 用户/游客表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  nickname TEXT,
  gender TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_users_session_id ON users(session_id);

-- 照片表
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  url TEXT,
  type TEXT DEFAULT 'face',
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- 面容分析结果表
CREATE TABLE IF NOT EXISTS face_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  -- 肤色
  skin_tone TEXT,
  skin_undertone TEXT,
  skin_depth TEXT,
  skin_type TEXT,
  -- 五官
  face_shape TEXT,
  eye_shape TEXT,
  eye_spacing TEXT,
  nose_type TEXT,
  lip_shape TEXT,
  eyebrow_type TEXT,
  -- 比例
  forehead_width TEXT,
  jawline_type TEXT,
  face_ratio TEXT,
  -- 评分与状态
  features_json TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 身体指标表（每用户一条）
CREATE TABLE IF NOT EXISTS body_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  height_cm REAL,
  weight_kg REAL,
  body_type TEXT,
  shoulder_width_cm REAL,
  waist_cm REAL,
  hip_cm REAL,
  leg_length_ratio REAL,
  bust_cm REAL,
  neck_length TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 穿搭推荐记录表
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  photo_id INTEGER REFERENCES photos(id),
  scenario TEXT,
  result_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 虚拟试穿结果表
CREATE TABLE IF NOT EXISTS tryon_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  photo_id INTEGER REFERENCES photos(id),
  recommendation_id INTEGER,
  result_url TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 衣服照片上传记录表
CREATE TABLE IF NOT EXISTS clothing_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  image_url TEXT NOT NULL,
  category TEXT,
  color TEXT,
  style TEXT,
  season TEXT,
  usage TEXT,
  item_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_clothing_items_session_id ON clothing_items(session_id);

-- ============================================================
-- B. 规则引擎表
-- ============================================================

-- 规则组表
CREATE TABLE IF NOT EXISTS rule_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'store',
  gender TEXT,
  category TEXT NOT NULL,
  scenario TEXT,
  region TEXT,
  age_range TEXT,
  description TEXT,
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_rule_groups_mode_enabled_category
  ON rule_groups(mode, enabled, category);

-- 规则条件表
CREATE TABLE IF NOT EXISTS rule_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES rule_groups(id),
  field TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT 'eq',
  value TEXT NOT NULL,
  weight INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_rule_conditions_group_id ON rule_conditions(group_id);

-- 规则动作表
CREATE TABLE IF NOT EXISTS rule_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES rule_groups(id),
  action_type TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_rule_actions_group_id ON rule_actions(group_id);

-- ============================================================
-- C. 库存系统表
-- ============================================================

-- 商品分类表
CREATE TABLE IF NOT EXISTS inventory_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- 库存商品表
CREATE TABLE IF NOT EXISTS inventory_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES inventory_categories(id),
  name TEXT NOT NULL,
  sku TEXT,
  style_tags TEXT,
  color_tags TEXT,
  season_tags TEXT,
  fit_skin_tones TEXT,
  fit_face_shapes TEXT,
  stock INTEGER DEFAULT 0,
  price REAL,
  image_url TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- D. 隐私数据表
-- ============================================================

-- 顾客临时会话数据表
CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  profile_data TEXT,
  synced INTEGER DEFAULT 0,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_customer_sessions_session_id ON customer_sessions(session_id);

-- 建议记录表
CREATE TABLE IF NOT EXISTS recommendation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  input_snapshot TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_recommendation_logs_session_id ON recommendation_logs(session_id);

-- ============================================================
-- E. 个人衣橱表
-- ============================================================

-- 个人衣橱表
CREATE TABLE IF NOT EXISTS user_wardrobe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sub_category TEXT,
  color TEXT,
  color_tags TEXT,
  pattern TEXT,
  style_tags TEXT,
  season_tags TEXT,
  occasion_tags TEXT,
  fit_body_types TEXT,
  fit_skin_tones TEXT,
  condition TEXT DEFAULT '良好',
  purchase_date TEXT,
  price REAL,
  is_favorite INTEGER DEFAULT 0,
  image_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_user_wardrobe_session_id ON user_wardrobe(session_id);

-- 搭配组合表
CREATE TABLE IF NOT EXISTS wardrobe_outfits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  item_ids TEXT NOT NULL,
  occasion TEXT,
  season TEXT,
  rating INTEGER,
  notes TEXT,
  is_favorite INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_wardrobe_outfits_session_id ON wardrobe_outfits(session_id);

-- 购物心愿单
CREATE TABLE IF NOT EXISTS shopping_wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id INTEGER REFERENCES users(id),
  item_name TEXT NOT NULL,
  category TEXT,
  color TEXT,
  reason TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  gap_type TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_shopping_wishlist_session_id ON shopping_wishlist(session_id);

-- ============================================================
-- F. 管理员用户表
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- G. 个人化妆品柜表
-- ============================================================

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  sub_category TEXT,
  color_name TEXT,
  color_tone TEXT,
  color_family TEXT,
  finish TEXT,
  skin_tone_fit TEXT,
  skin_type_fit TEXT,
  face_shape_fit TEXT,
  eye_shape_fit TEXT,
  lip_shape_fit TEXT,
  occasion_tags TEXT,
  style_tags TEXT,
  coverage TEXT,
  opened_date TEXT,
  expiry_months INTEGER,
  remaining INTEGER,
  condition TEXT DEFAULT '在用',
  price REAL,
  image_url TEXT,
  is_favorite INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_user_cosmetics_session_id ON user_cosmetics(session_id);

-- ============================================================
-- H. 个人配饰柜表
-- ============================================================

CREATE TABLE IF NOT EXISTS user_accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  material TEXT,
  metal_color TEXT,
  gem_color TEXT,
  shape TEXT,
  length TEXT,
  face_shape_fit TEXT,
  neck_length_fit TEXT,
  skin_tone_fit TEXT,
  allergy_safe INTEGER,
  allergy_notes TEXT,
  occasion_tags TEXT,
  style_tags TEXT,
  season_tags TEXT,
  condition TEXT DEFAULT '良好',
  price REAL,
  image_url TEXT,
  is_favorite INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_user_accessories_session_id ON user_accessories(session_id);

-- ============================================================
-- T. 3D 模型配置表
-- ============================================================

CREATE TABLE IF NOT EXISTS model_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🎭',
  image_preview TEXT DEFAULT '',
  description TEXT DEFAULT '',
  folder TEXT NOT NULL,
  file TEXT NOT NULL,
  source TEXT DEFAULT '其他',
  enabled INTEGER DEFAULT 1,
  exposure REAL DEFAULT 0.3,
  sort_order INTEGER DEFAULT 0,
  scale REAL DEFAULT 1.0,
  pos_x REAL DEFAULT 0.0,
  pos_y REAL DEFAULT 0.0,
  pos_z REAL DEFAULT 0.0,
  rot_x REAL DEFAULT 0.0,
  rot_y REAL DEFAULT 0.0,
  rot_z REAL DEFAULT 0.0,
  camera_distance REAL DEFAULT 5.0,
  ambient_light REAL DEFAULT 0.6,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_model_configs_enabled ON model_configs(enabled);

-- ============================================================
-- 性能索引（高频查询列）
-- ============================================================
CREATE INDEX IF NOT EXISTS ix_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS ix_face_features_user_id ON face_features(user_id);
CREATE INDEX IF NOT EXISTS ix_face_features_photo_id ON face_features(photo_id);
CREATE INDEX IF NOT EXISTS ix_recommendations_user_id ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS ix_tryon_results_user_id ON tryon_results(user_id);

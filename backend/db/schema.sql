-- ============================================================
-- Style AI 数据库 Schema（从 Python SQLAlchemy models.py 翻译）
-- 表数量以本文件为准（新增表请同步 routes/admin.js 的 TABLE_NAMES 中文名映射）
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
  created_at TEXT DEFAULT (datetime('now')),
  -- 会话滚动活跃时间（middleware/auth.js 认证命中时刷新，每小时最多写一次）。
  -- 本轮只记录、不执法：老库/新建行此列为 NULL＝从没观测过活跃，
  -- 不能据此把在线用户踢下线；等积累出可靠的活跃分布后，下一轮再按
  -- "长时间无活跃即失效"收紧（对比 customer_sessions.expires_at 的口径）。
  last_active_at TEXT
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
  leg_length_cm REAL,
  shoulder_type TEXT,
  frame_size TEXT,
  line_quality TEXT,
  -- 八字五行的输入(选填):不填则整条命理依据缺席
  birth_date TEXT,
  birth_hour TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 手工面容档案表(每人一行;face_features 依赖照片,照片识别未开放时用这张)
-- 列名一律取规则引擎的条件字段名,入库即命中,不再二次翻译
CREATE TABLE IF NOT EXISTS face_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  -- 肤色与肤质
  skin_tone TEXT,
  skin_tone_detail TEXT,
  color_chroma TEXT,
  skin_type TEXT,
  -- 脸型与比例
  face_shape TEXT,
  face_ratio TEXT,
  eye_spacing TEXT,
  -- 五官(规则引擎在用的三个:eye_size / nose_bridge / lip_thickness)
  eye_size TEXT,
  eye_shape TEXT,
  nose_bridge TEXT,
  lip_thickness TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_face_profiles_user_id ON face_profiles(user_id);

-- 形象标签表(每人每标签一行):算完就存,库里查得到"这个人被算成了什么"
-- 只存算出来的结论;本人填的条件在 body_metrics 与 face_profiles
-- UNIQUE(user_id, tag_key) 同时充当 upsert 的冲突目标与查询索引
CREATE TABLE IF NOT EXISTS profile_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tag_key TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tag_key)
);

-- 表单草稿表(每人一行):存"填了一半还没点生成"的整份表单
-- 身体与面容有各自的档案列,场合/预算/主要目标这类只属于表单、没有列可落,所以整份存 JSON;
-- 点过生成的样本在 recommendation_logs,那张按次累积,这张永远只有最新一份
CREATE TABLE IF NOT EXISTS profile_drafts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  form_json TEXT NOT NULL,
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
  last_hit_at TEXT,
  feedback_up INTEGER DEFAULT 0,
  feedback_down INTEGER DEFAULT 0,
  -- 规则种子的来源标记:增量应用只认这个 key 判断"库里有没有这条"。
  -- 后台手工建的规则留空(NULL),永远不会被种子覆盖;索引在 db/init.js 补列之后才建
  source_key TEXT,
  -- 依据分档：A 国标/国际标准、B 学术实证、C 行业体系经验、D 命理。
  -- NULL＝未标注，展示时一律按 C 对待；只有 A/B 允许对顾客出现"科学/量化"字样。
  -- 判档规则的唯一实现处是 services/evidenceLevels.js（别在别处再写一份前缀表）
  evidence_level TEXT,
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

-- 门店表:同一套系统给任意多家店用,店与店的数据要能分开
-- 店名由前端带(?store=店名),第一次出现的店名当场自动登记,店数不预设也不封顶
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 顾客临时会话数据表
CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  store_id INTEGER REFERENCES stores(id),
  profile_data TEXT,
  synced INTEGER DEFAULT 0,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_customer_sessions_session_id ON customer_sessions(session_id);
-- store_id 的索引不在这里建:本文件跑在补列迁移之前,老库此时还没有 store_id 列

-- 建议记录表
CREATE TABLE IF NOT EXISTS recommendation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  store_id INTEGER REFERENCES stores(id),
  mode TEXT NOT NULL,
  input_snapshot TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_recommendation_logs_session_id ON recommendation_logs(session_id);
-- user_id 的索引不在这里建:本文件跑在补列迁移之前,老库此时还没有 user_id 列

-- 反馈表:记下"这条规则用对了没有",recommendation_logs 只有"用了几次"
-- 一个人对同一条规则只留最新一次评价,换主意是覆盖不是加一行,好评率不会被重复点击灌大
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER NOT NULL REFERENCES rule_groups(id),
  category TEXT,
  signal TEXT NOT NULL,
  -- 10-19 第三阶段·模块三：两把星级（1~5），给"权重回归"当因变量用。
  -- ⛔ 不设 DEFAULT、也不做 CHECK 约束：NULL＝没打星（老库补列后所有历史行都是 NULL，
  --    这正是"架构先搭好、数据后流进来"的形态）；范围 1~5 由路由层校验并回一句人话。
  -- aesthetic_score＝这套搭配整体好不好看；fit_score＝上衣穿在身上合不合身。
  -- 两把星分开设是因为它们打的是**不同维度**：好看但显胖、合身但土气都是真实反馈，
  -- 合成一把会把色彩那一维和廓形那一维搅成一团（回归出来的权重就没法解释）。
  aesthetic_score INTEGER,
  fit_score INTEGER,
  -- 打分那一刻的三维分快照（JSON：{rule, color, body, total, coverage}，认不出形状就存 NULL）。
  -- 为什么必须快照而不是回头去查：权重常量与规则库会继续改，**今天的公式配不上昨天的评价**，
  -- 拿现在的分去回归历史星级等于把两组不同尺子的数混在一起（08 §9.3 的标定协议第一步就是这个）。
  rank_snapshot TEXT,
  -- 这条评价具体落在哪一件衣服上（user_wardrobe.id）。⛔ 不建 FOREIGN KEY：
  -- 衣橱行会被删（用户清空衣柜），反馈要留着当回归样本，不能让删除把训练数据一起带走。
  wardrobe_item_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, group_id)
);

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
  -- 上衣这两格只能由衣橱主人自己填（库里原来没有，缺测就不打分）：
  -- fit_style 版型档（合体/宽松，对应 Sakata 2020 实测的两种剪裁走向）；
  -- fabric_weight 面料厚薄（薄/中/厚，决定同一件上衣的体量感）。
  -- ⚠️ 10-19 第三阶段起 fit_style **只当展示标签**，不再进任何算式：两档值域（合体/宽松）撑不起
  --    "修身/合身/宽松/廓形"四档松量，同一件事留两个真相源迟早打架 ⇒ 评分列换成下面的 fit_type。
  fit_style TEXT,
  fabric_weight TEXT,
  -- 10-19 第二阶段「最后一公里」：四格**成品实测尺寸**（软尺平铺量，单位 cm，量法见
  -- services/fitSize.js 的 MEASURE_GUIDE 与 docs/依据/09）。上衣打分从这一轮起只吃这四格，
  -- 不再从 name/style_tags 里猜"宽松""落肩"这类中文词（那是伪量化）。
  -- ⛔ 一律不设 DEFAULT：NULL 就是"没量"，缺测不出分（docs/依据/README.md:64（硬规矩 2）的同一句）。
  -- shoulder_cm 成品肩宽（两肩缝点直线距离）／bust_cm 成品胸围（腋下水平绕一周×2 平铺值换算）
  -- ／length_cm 成品衣长（肩颈点到下摆）／waistband_cm 腰头高（收腰缝或下摆收口自身的高度）
  shoulder_cm REAL,
  bust_cm REAL,
  length_cm REAL,
  waistband_cm REAL,
  -- 10-19 第三阶段「注水」：真实用户不会随身带软尺，量不了四格的人至少要能选一档版型。
  -- fit_type ∈ 修身/合身/宽松/廓形 ⇒ 松量（成品胸围 − 净胸围）按 services/topFitBody.js 的
  -- FIT_TYPE_EASE 区间**中值**估出来，让公式照样跑；估出来的那一维在覆盖率里只按**半格**计
  -- （10-19 第三阶段·模块二那条惩罚因此不会被"选个版型"绕开）。
  -- 优先级：bust_cm 有实测 ⇒ 只认实测，版型那一档不参与算分；两者都没有 ⇒ 这一维缺席。
  -- ⛔ 同样不设 DEFAULT：NULL＝没选＝不估（docs/依据/README.md:64「缺测不出分」（硬规矩 2））。
  fit_type TEXT,
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
  -- 第五阶段·第一步「门店扫码快速录入」（2026-10-20）：吊牌条码／店内编号原样存这一格。
  -- ⛔ 不设 DEFAULT：NULL＝这件不是扫来的（与四格实测尺寸同一口径）。
  -- ⛔ 不建唯一索引：同一位顾客可以有两件同款衣服，游客还共用会话——唯一索引会把第二件直接顶掉。
  --    "扫重复了"这件事由录入框查库时提醒（GET /api/wardrobe/sku），不在写入口拦。
  sku TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_user_wardrobe_session_id ON user_wardrobe(session_id);
-- ⚠️ sku 的索引不写在这里：老库跑到这一行时那一列还没补上，CREATE INDEX 会直接报错。
--    它由 init.js 的 initMissingColumns() 在补列之后建（与那里 ix_rule_groups_source_key 同一套路）。

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
  -- 2026-10-21 第十一阶段·第一步（docs/依据/19 §二）：日记终于能记住"哪天穿的、那天多冷"。
  -- 这三格是"按天气学偏好"这条链的**源头**——没有它们，偏好层拿到的只有提交时间。
  -- ⛔ 一律不设 DEFAULT：NULL＝没记＝那一维整块缺席（docs/依据/README.md 硬规矩 2「缺测不出分」）。
  -- wear_date 是**穿着那天**（YYYY-MM-DD，按东八区日历日），⛔ 不许拿 created_at 顶替：
  --   补记昨天的穿搭会被 created_at 记成今天，那是假数据不是缺数据（19 §二 表下第 1 条）。
  -- feels_like_c 是当天体感温度（℃）；weather_level 是五档之一，词表唯一真相源在
  --   services/weatherService.js 的 WEATHER_LEVELS（寒冷/偏凉/舒适/偏热/炎热），⛔ 不在别处抄第二份。
  -- 老库靠 db/init.js 的 MISSING_COLUMNS 补列（schema.sql 的 CREATE TABLE IF NOT EXISTS
  --   改不动已建好的表）；wear_date 的索引也在那边补列之后建（19 §二 第 3 条说明了为什么）。
  wear_date TEXT,
  feels_like_c REAL,
  weather_level TEXT,
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
  -- epoch 秒，与 Token 里的签发时间同单位：比 TEXT 的 datetime('now') 省掉时区换算这道坑
  password_changed_at INTEGER,
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
-- 下面五张每用户表此前只有 session_id 索引，而「删除我的全部数据」
-- (routes/analysis.js) 与后台按人取数都走 WHERE user_id = ? ⇒ 全表扫描。
-- recommendation_logs(user_id) 不在这里建：那列是老库补列迁移加的，索引在 db/init.js 补列后建；
-- profile_drafts 不用建：user_id 本身就是 INTEGER PRIMARY KEY（rowid 别名，天然唯一索引）。
CREATE INDEX IF NOT EXISTS ix_user_wardrobe_user_id ON user_wardrobe(user_id);
CREATE INDEX IF NOT EXISTS ix_wardrobe_outfits_user_id ON wardrobe_outfits(user_id);
CREATE INDEX IF NOT EXISTS ix_shopping_wishlist_user_id ON shopping_wishlist(user_id);
CREATE INDEX IF NOT EXISTS ix_user_cosmetics_user_id ON user_cosmetics(user_id);
CREATE INDEX IF NOT EXISTS ix_user_accessories_user_id ON user_accessories(user_id);

-- ============================================================
-- 收款凭证（用户上传付款截图 -> 后台人工审核放行）
-- ============================================================
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'wechat',
  amount REAL NOT NULL DEFAULT 0,
  proof_url TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_deposits_status_created ON deposits(status, created_at);
CREATE INDEX IF NOT EXISTS ix_deposits_user_id ON deposits(user_id);

-- ============================================================
-- 微信支付 APIv3 订单（Native 下单 -> 回调 / 轮询确认到账）
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  out_trade_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL DEFAULT '',
  -- 一律以分为单位存，避免 REAL 存元带来的浮点误差与对账歧义
  amount_fen INTEGER NOT NULL,
  -- created(已下单) | paid(已到账) | closed(已关闭)
  status TEXT NOT NULL DEFAULT 'created',
  transaction_id TEXT,
  code_url TEXT DEFAULT '',
  paid_at TEXT,
  notify_raw TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS ix_payment_orders_status ON payment_orders(status);

-- ============================================================
-- 创作者作品（提交 -> 审核 -> 广场曝光 -> 分享链接带流量）
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  share_code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  payload TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  featured INTEGER DEFAULT 0,
  heat INTEGER DEFAULT 0,
  share_views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_creator_works_status_featured_heat ON creator_works(status, featured, heat);
CREATE INDEX IF NOT EXISTS ix_creator_works_user_id ON creator_works(user_id);
CREATE INDEX IF NOT EXISTS ix_creator_works_share_code ON creator_works(share_code);

-- ============================================================
-- 正式账号（手机号 + 密码）
-- 身份仍然是 users.session_id，这张表只负责"把这个手机号和那条身份对上"，
-- 因此不动 users 老表、也不用给老表补列。
-- ============================================================
CREATE TABLE IF NOT EXISTS user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_user_accounts_phone ON user_accounts(phone);

-- ============================================================
-- 后台可改的键值设置
-- 目前只有一项 payment_amount_fen = 收款金额（单位：分）。
-- 金额一律存整数分，不用浮点存钱；routes/payment.js 里的 PRICE.amount
-- 只是这张表还没有那条记录时的兜底默认值。
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 人 × 衣服 的评分表（第九阶段·第一步，规范＝docs/依据/17 §二）
-- 为什么新建一张表而不改 feedback_events：那张表的 group_id 是
-- `NOT NULL REFERENCES rule_groups(id)`（:301）＋`UNIQUE(user_id, group_id)`（:320），
-- 而衣橱来源的候选结构上就没有规则号（recommendEngine.js 里那条 `group_id: null`），
-- 让它收"人×衣服"要放宽 NOT NULL 并重建表——SQLite 没有 DROP NOT NULL，
-- 风险全压在服务器那份被 skip-worktree 钉住的运行库上。加法建表回滚只要 DROP TABLE。
-- 两张表语义不同、不许混用：feedback_events＝这条规则准不准，item_feedback＝这件衣服你穿得怎么样。
-- ============================================================
CREATE TABLE IF NOT EXISTS item_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 唯一身份。有登录 user_id 就 'u'+id，游客退 's'+session_id，两者都没有＝写入口 400。
  -- ⚠️ 为什么不直接用 user_id 建唯一键：user_wardrobe 现量 10 行里 user_id 只有 1 行非空，
  --    而 SQLite 的 UNIQUE 不把 NULL 当相等 ⇒ 拿它当键会让所有游客的打分互相覆盖或全变重复行。
  -- ⚠️ 代价如实写进 17 §八 第 2 条：同一人登录前的游客期打分不会并进来（两把键不同）。
  actor_key TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  session_id TEXT,
  wardrobe_item_id INTEGER NOT NULL REFERENCES user_wardrobe(id),
  -- 场合只收 rule_conditions 里那五个受控词（上班通勤/约会聚会/婚礼宴会/运动健身/居家休闲），
  -- 造了新词规则侧命不上＝采了也用不上（同 16 §〇 那句）。没给＝NULL，不猜。
  occasion TEXT,
  -- 三档与 ruleFeedback.js:25 的 SIGNALS 同一把尺子。这一张表里没有"这条规则好不好"的语义，
  -- 所以 signal 允许 NULL（只打星、没表态是常态），⛔ 但绝不回写 rule_groups 的好评差评数。
  signal TEXT,
  -- 1~5 整数，越界由写入口 400 说破（复用 ruleFeedback 的 starValue/scoreError 那把尺子）
  aesthetic_score INTEGER,
  fit_score INTEGER,
  -- 打分那一刻的 rankDims 出账（JSON）。⛔ 与 feedback_events 那条不同：这里只认 color/body 两维，
  -- 两维全空才存 NULL（三维齐的候选在现在的代码里一条都造不出来，见 17 §一 那四条证据）。
  rank_snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- 一人一衣只留最新一行：覆盖不叠加（与 feedback_events 同一哲学——好评率不能被重复点击灌大）
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_feedback_actor_item ON item_feedback(actor_key, wardrobe_item_id);
CREATE INDEX IF NOT EXISTS ix_item_feedback_item ON item_feedback(wardrobe_item_id);
CREATE INDEX IF NOT EXISTS ix_item_feedback_occasion ON item_feedback(occasion);

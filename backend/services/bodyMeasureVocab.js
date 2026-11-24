/**
 * 人体测量点词表（照搬开源人体建模软件 MakeHuman 的 CC0 资产，只用来对"我们量到哪一格"）
 * ============================================================================
 * 建档：2026-10-23（第十五阶段·第一步）。规范本体在 `docs/依据/23-人体测量字段词表输入输出规范-20261023.md`，
 * 本文件是它的实现，两边同轮改。上游原件与授权登记在 `backend/vendor/makehuman/PROVENANCE.md`。
 *
 * 为什么要这一层（现量，不是设想）：站内按名字索引的身体数值格一共只有 8 列
 * （`bodyLimits.js` 的 `LIMITS`，10-23 现量），其中围度只有胸／腰／臀三格，肩宽一格，腿长两格。
 * 于是 `fitSize.js` 文件头自己写着 ⛔ 判不了的四件：**袖长、袖笼弧长、腰节长／背长、领围**。
 * 这四件不是"没想到"，是**没有一个中性的字段名可以把它们登记进来**——表单、库表、词表各说各话时，
 * 补一列就得先吵这个名字。MakeHuman 的 `measurement_sliders.json` 给了 20 个测量点、9 个部位分组，
 * 是 CC0 资产（授权逐字见 PROVENANCE），拿它当**唯一命名的上游锚**，比自造 20 个中文名硬。
 *
 * 🔴 这一层**一个数值都不给**：不给阈值、不给分位、不给界。理由三条，都在规范 `23` §四：
 *  1. MakeHuman 是**欧洲扫描数据出来的模型**，它的 20 点是"量哪里"的定义，不是"量出来多少算正常"。
 *     中国侧的数值只认 GB/T 10000-2023，那套分位锚点抄读与页码在 `13` §二／`10` §2d，⛔ 与本文件混用。
 *  2. 同一格可能有多个口径：肩宽在 GB/T 5703-2023 §6.2.7 是两肩峰点**直线距离**，在 GB/T 16160-2017
 *     §2.2.5「总肩宽」是**水平弧长**，同一个人差 3~5 cm（`10` §2e 逐字）。MakeHuman 的 "Shoulder dist"
 *     既没声明直线也没声明弧长 ⇒ 本文件把它对齐到 `shoulder_width_cm` 时**只记名不对齐口径**，
 *     口径之争仍归 `13`／`09`。谁在这里替它认了口径，谁就把 3~5 cm 的误差写进了生产链路。
 *  3. 输入界全项目**只有一份尺子**（`bodyLimits.js`，DR1）。这里再写一遍 min／max＝把第二把尺子请回来。
 *
 * ⛔ 出口约束（沿用 `bodyDimEstimator.js` 文件头那条"出口只有一个"的写法）：
 *  本表只许用于①后台字段登记、②`docs/` 里写缺口清单、③将来真要给顾客加采集格时**取名**用。
 *  ⛔ 不进任何打分公式，⛔ 不喂规则匹配（引擎是严格 AND，凭空多一颗标签会让规则静默失配，见 `bodyTypes.js` 文件头），
 *  ⛔ 把 `bodyTypeFromShape()` 的返回值当顾客的体型判定——它只是把 14 个外来体型名映射到站内五档的**别名表**，
 *  对不上的一律返回 null，宁可不归一也不硬翻（与 `BODY_TYPE_ALIASES` 同一条纪律）。
 */

const path = require('path')
const fs = require('fs')

/** 上游原件所在目录（⛔ 不许格式化、不许改字节，见 PROVENANCE.md） */
const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'makehuman')
const VENDOR_MEASURE = path.join(VENDOR_DIR, 'measurement_sliders.json')
const VENDOR_BODYSHAPES = path.join(VENDOR_DIR, 'bodyshapes_sliders.json')

/**
 * 读上游原件，摊平成 `measure/<target>` 那批 mod 字符串。
 * 单测用它守"本表的 `mhMod` 与上游一字一样"这条漂移；运行时不做这件事（不为一个词表加一次磁盘 IO）。
 */
function vendorMeasureMods() {
  const raw = JSON.parse(fs.readFileSync(VENDOR_MEASURE, 'utf8'))
  const groups = (raw.Measure && raw.Measure.modifiers) || {}
  const mods = []
  for (const groupName of Object.keys(groups)) {
    for (const item of groups[groupName]) mods.push(item.mod)
  }
  return mods
}

/** 同上读体型那一份，返回 [{group, mod, label}]——14 条体型＋8 条激素型的来源 */
function vendorBodyShapes() {
  const raw = JSON.parse(fs.readFileSync(VENDOR_BODYSHAPES, 'utf8'))
  const groups = (raw['Body shapes'] && raw['Body shapes'].modifiers) || {}
  const rows = []
  for (const groupName of Object.keys(groups)) {
    for (const item of groups[groupName]) {
      rows.push({ group: groupName, mod: item.mod, label: item.label || '' })
    }
  }
  return rows
}

// ------------------------------------------------------------
// 20 个测量点（顺序与 `measurement_sliders.json` 的分组顺序一字不差）
// column ＝ 站内 `bodyLimits.js` 的列名；null ＝ 站内现在没有这一格
// ------------------------------------------------------------

/**
 * @typedef {object} MeasurePoint
 * @property {string} key 站内字段名（蛇形，给将来的迁移脚本与表单当唯一 key）
 * @property {string} zh 中文标签（真进表单时要再对一次措辞红线 `05`，本表只是登记用）
 * @property {string} en 上游标签，逐字取自 `measurement_sliders.json` 的 `label`
 * @property {string} group 上游分组名，逐字取自该文件的 `modifiers` 键
 * @property {string} mhMod 上游 mod 路径，逐字；单测守这条
 * @property {string|null} column 站内已有的数值列，没有则 null
 * @property {string} note 对齐时最容易被误读的那一句
 */
const MEASURE_POINTS = [
  {
    key: 'neck_circumference_cm',
    zh: '颈围',
    en: 'Neck circum',
    group: 'Neck',
    mhMod: 'measure/measure-neck-circ-decr|incr',
    column: null,
    note: '⛔ 现在站内的领围判不了（`fitSize.js` 文件头四条缺口之一），这一格就是那条缺口的名字',
  },
  {
    key: 'neck_height_cm',
    zh: '颈高',
    en: 'Neck height',
    group: 'Neck',
    mhMod: 'measure/measure-neck-height-decr|incr',
    column: null,
    note: '站内档案有 `neck_length`（10-23 现量＝文本三档 `短`/`中`/`长`，`app/src/types/profile.ts:93`，11-03 按内容重指：原先在 types/index.ts），与这一格的厘米数不是一回事',
  },
  {
    key: 'upper_arm_circumference_cm',
    zh: '上臂围',
    en: 'Upper arm circum',
    group: 'Upper arm',
    mhMod: 'measure/measure-upperarm-circ-decr|incr',
    column: null,
    note: '袖笼弧长要的是这一格＋肩点高度，仍判不了；登记名字不等于实现',
  },
  {
    key: 'upper_arm_length_cm',
    zh: '上臂长',
    en: 'Upperarm length',
    group: 'Upper arm',
    mhMod: 'measure/measure-upperarm-length-decr|incr',
    column: null,
    note: '袖长＝这一格＋前臂长（＋袖口落差），⛔ 单拿任一格当袖长',
  },
  {
    key: 'lower_arm_length_cm',
    zh: '前臂长',
    en: 'Lowerarm length',
    group: 'Lower arm',
    mhMod: 'measure/measure-lowerarm-length-decr|incr',
    column: null,
    note: '与上一格配对才是袖长的两段；站内现在一格都没有',
  },
  {
    key: 'wrist_circumference_cm',
    zh: '腕围',
    en: 'Wrist circum',
    group: 'Lower arm',
    mhMod: 'measure/measure-wrist-circ-decr|incr',
    column: null,
    note: '配饰侧（手表／袖口）将来要的是这一格；10-24 现量＝114 条规则里 3 条产出 `watch` 动作，本轮一条不动',
  },
  {
    key: 'front_chest_distance_cm',
    zh: '前胸宽',
    en: 'Front chest dist',
    group: 'Torso',
    mhMod: 'measure/measure-frontchest-dist-decr|incr',
    column: null,
    note: '⚠️ 上游拿两个网格顶点量直线距离，本站无国标出处可比对，⛔ 不许写成"按 16160 定义"',
  },
  {
    key: 'bust_circumference_cm',
    zh: '胸围（净）',
    en: 'Bust circum',
    group: 'Torso',
    mhMod: 'measure/measure-bust-circ-decr|incr',
    column: 'bust_cm',
    note: '站内这一格是 1335 的"型"的入口（`fitSize.js`），口径以 `09` 为准，与本表只同名',
  },
  {
    key: 'under_bust_circumference_cm',
    zh: '下胸围',
    en: 'Underbust circum',
    group: 'Torso',
    mhMod: 'measure/measure-underbust-circ-decr|incr',
    column: null,
    note: '罩杯＝胸围−下胸围；上游确实有这段减法（PROVENANCE 记为"未搬的思路"），⛔ 站内要做必须用国内尺码标准复核',
  },
  {
    key: 'waist_circumference_cm',
    zh: '腰围',
    en: 'Waist circum',
    group: 'Torso',
    mhMod: 'measure/measure-waist-circ-decr|incr',
    column: 'waist_cm',
    note: '⚠️ 口径已有定案：GB/T 16160-2017 §2.2.10「腰际线」，⛔ 不是"腰最细处"（`10` §2c／§4 第 5 条）',
  },
  {
    key: 'nape_to_waist_cm',
    zh: '背长（后颈点到腰线）',
    en: 'Nape to waist',
    group: 'Torso',
    mhMod: 'measure/measure-napetowaist-dist-decr|incr',
    column: null,
    note: '⛔ 现在站内的衣长与腰节判不了，缺的就是这一格（`fitSize.js` 写的"腰节长／背长"）',
  },
  {
    key: 'waist_to_hip_cm',
    zh: '腰臀距（腰线到臀围线）',
    en: 'Waist to hip',
    group: 'Torso',
    mhMod: 'measure/measure-waisttohip-dist-decr|incr',
    column: null,
    note: '下装腰头高低（高腰／中腰／低腰）要的是这一格；10-24 现量＝114 条规则里 26 条产出 `bottom_style` 动作，本轮只登记、一条不动',
  },
  {
    key: 'shoulder_distance_cm',
    zh: '肩宽',
    en: 'Shoulder dist',
    group: 'Torso',
    mhMod: 'measure/measure-shoulder-dist-decr|incr',
    column: 'shoulder_width_cm',
    note: '🔴 同名不对齐口径：直线距离（5703 §6.2.7）／水平弧长（16160 §2.2.5）／肩最大宽（5703 §6.2.8）是三个量，差 3~5 cm（`10` §2e）',
  },
  {
    key: 'hip_circumference_cm',
    zh: '臀围',
    en: 'Hips circum',
    group: 'Hips',
    mhMod: 'measure/measure-hips-circ-decr|incr',
    column: 'hip_cm',
    note: '站内吃这一格的是 `profileEnricher.computeBodyShape` 的腰臀判据；⚠️ 10-24 现量：规则条件侧**没有腰臀比这一维**（15 个条件字段里只有 `waist_definition` 3 条，档名 明显/中等/模糊＝定性档，不是比值）',
  },
  {
    key: 'upper_leg_length_cm',
    zh: '大腿长',
    en: 'Upperleg height',
    group: 'Upper leg',
    mhMod: 'measure/measure-upperleg-height-decr|incr',
    column: null,
    note: '⚠️ 上游用 height 表"段长"，与站内的 `leg_length_cm` 不是同一刀切法（见 REPO_COLUMNS_WITHOUT_MH_POINT）',
  },
  {
    key: 'thigh_circumference_cm',
    zh: '大腿围',
    en: 'Thigh circ.',
    group: 'Upper leg',
    mhMod: 'measure/measure-thigh-circ-decr|incr',
    column: null,
    note: '裤子合身的第一格；站内下装侧现在只有腿长没有腿粗 ⇒ 下装量化的头号缺口',
  },
  {
    key: 'knee_circumference_cm',
    zh: '膝围',
    en: 'Knee circ.',
    group: 'Knee',
    mhMod: 'measure/measure-knee-circ-decr|incr',
    column: null,
    note: '裙长过膝时的贴合参考；优先级低，登记在册即可',
  },
  {
    key: 'lower_leg_length_cm',
    zh: '小腿长',
    en: 'Lowerleg height',
    group: 'Lower leg',
    mhMod: 'measure/measure-lowerleg-height-decr|incr',
    column: null,
    note: '与大腿长两格相加才是腿长，⛔ 与 `leg_length_cm` 互换',
  },
  {
    key: 'calf_circumference_cm',
    zh: '小腿围',
    en: 'Calf circum',
    group: 'Lower leg',
    mhMod: 'measure/measure-calf-circ-decr|incr',
    column: null,
    note: '靴筒／裤脚口要的是这一格',
  },
  {
    key: 'ankle_circumference_cm',
    zh: '踝围',
    en: 'Ankle circum',
    group: 'Ankle',
    mhMod: 'measure/measure-ankle-circ-decr|incr',
    column: null,
    note: '站内没有鞋的内长以外的脚部数据，这一格属于"知道有、现在不做"',
  },
]

/**
 * 站内已有、但 MakeHuman 那 20 点里**没有对应定义**的四格。
 * 记下来是为了反方向也不许混：`leg_length_cm` 是本站自定的量法，⛔ 对外不许说"国标测量点"。
 * 单边对账会让"登记完"这件事看着比实际完成——所以单测同时反查 `bodyLimits.LIMITS` 的每一列
 * 是否在本文件或 `MEASURE_POINTS` 里出现过（10-23 现量：LIMITS 8 列 ＝ 4 个映射点 ＋ 本清单 4 格）。
 */
const REPO_COLUMNS_WITHOUT_MH_POINT = [
  {
    column: 'height_cm',
    zh: '身高',
    note: '上游 20 点是"围度与段长"的滑杆，身高不在其中（它取的是模型包围盒，逻辑在 AGPL 源码的 `getHeightCm()`，本站未取）。中国侧的身高分位数只认 GB/T 10000-2023，见 `13` §二',
  },
  {
    column: 'weight_kg',
    zh: '体重',
    note: '体重不是几何测量点，任何网格模型都给不了；上游那 20 点里根本没有这一格。站内的体重只当 `bodyDimEstimator.js` 幂律的分母与 BMI 交叉判据的分子，界在 `bodyLimits.js`',
  },
  {
    column: 'leg_length_cm',
    zh: '腿长',
    note: '上游把腿拆成大腿长＋小腿长两段（`upper_leg_length_cm`＋`lower_leg_length_cm`），本站这一格是一刀量到底，切法不同',
  },
  {
    column: 'leg_length_ratio',
    zh: '腿身比',
    note: '上游没有"比值"这一层概念，只有分段长度；比值怎么定义、参考带给谁，仍以 `08` §5 与 `topFitBody.js` 第 4 轴为准',
  },
]

// ------------------------------------------------------------
// 14 个体型名 → 站内五档（`bodyTypes.js` 的 BODY_TYPES）别名对照
// ------------------------------------------------------------

/**
 * 上游 `bodyshapes_sliders.json` 的 "Elvs Female／Male <名>" 是**时装业俗称**，与 `03` 那套
 * 「沙漏／梨／苹果／直筒／倒三角」同源不同名。这里只收 14 条"body shapes"分组，
 * ⛔ 不收 8 条 hormonal components（Adrenal／Liver／Ovary／Gonadal／Thyroid）——
 * 那是按激素推断身形的整套说法，属未检验的体系，放进对照表就等于给它发通行证。
 * `mod` 与 `en` 都逐字取自上游（`en` 就是该文件里的 `label`），单测守"一字不差"这条漂移。
 * @typedef {object} ShapeRow
 * @property {string} mod 上游 mod，逐字
 * @property {string} en 上游 label，逐字
 * @property {string} zh 中文俗称（本站自己的说法，⛔ 对外当判据）
 * @property {'女'|'男'} sex
 * @property {string|null} bodyType 站内五档；对不上＝null
 * @property {string} note 为什么对不上（null 那几条必须有理由）
 */
const BODY_SHAPE_CROSSWALK = [
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-apple',
    en: 'Elvs Female Apple',
    zh: '苹果型',
    sex: '女',
    bodyType: '苹果型',
    note: '腰腹最宽，与站内判据一致',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-diamond',
    en: 'Elvs Female Diamond',
    zh: '钻石型',
    sex: '女',
    bodyType: null,
    note: '臀宽＞肩宽且腰最细，介于梨与沙漏之间；站内五档没有这一档 ⇒ null，⛔ 硬翻成梨形',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-full-hourglass',
    en: 'Elvs Female Full Hourglass',
    zh: '饱满沙漏',
    sex: '女',
    bodyType: '沙漏型',
    note: '沙漏的大胸围变体，同档',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-neat-hourglass',
    en: 'Elvs Female Neat Hourglass',
    zh: '收沙漏',
    sex: '女',
    bodyType: '沙漏型',
    note: '沙漏的小胸围变体，同档',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-invert-triangle',
    en: 'Elvs Female Inverted Triangle',
    zh: '倒三角型',
    sex: '女',
    bodyType: '倒三角型',
    note: '肩宽＞臀宽',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-lean-column',
    en: 'Elvs Female Lean Column',
    zh: '瘦柱型',
    sex: '女',
    bodyType: '直筒型',
    note: '肩腰臀几乎同宽，直筒的偏瘦变体',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-rectangle',
    en: 'Elvs Female Rectangle',
    zh: '矩形（H 型）',
    sex: '女',
    bodyType: '直筒型',
    note: '站内五档的「直筒型」就是这一档',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-fem-triangle',
    en: 'Elvs Female Triangle',
    zh: '三角型（梨形）',
    sex: '女',
    bodyType: '梨形',
    note: '臀宽＞肩宽；站内用"梨形"不是"梨型"，见 `bodyTypes.js` 文件头',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-apple',
    en: 'Elvs Male Apple',
    zh: '苹果型',
    sex: '男',
    bodyType: '苹果型',
    note: '男档同名',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-rectangle',
    en: 'Elvs Male Rectangle',
    zh: '矩形（H 型）',
    sex: '男',
    bodyType: '直筒型',
    note: '男档同名',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-lean-column',
    en: 'Elvs Male Lean Column',
    zh: '瘦柱型',
    sex: '男',
    bodyType: '直筒型',
    note: '男档同名',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-triangle',
    en: 'Elvs Male Triangle',
    zh: '三角型（梨形）',
    sex: '男',
    bodyType: '梨形',
    note: '男档也有这一型，站内五档不分性别',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-invert-triangle',
    en: 'Elvs Male Inverted Triangle',
    zh: '倒三角型',
    sex: '男',
    bodyType: '倒三角型',
    note: '男档同名',
  },
  {
    mod: 'bodyshapes/bodyshapes-elvs-man-trapezoid',
    en: 'Elvs Male Trapezoid',
    zh: '梯形',
    sex: '男',
    bodyType: null,
    note: '长期力量训练形成的斜方肌＋背阔肌体型；站内五档没有这一档 ⇒ null',
  },
]

/**
 * 上游 hormonal components 的 8 条 mod，只登记不映射。
 * 显式列出来是为了让单测能断言"这 8 条一条都没混进对照表"，而不是靠人记得住它们存在（规范 `23` §五）。
 */
const HORMONE_SHAPE_MODS = [
  'bodyshapes/bodyshapes-elvs-fem-adrenal',
  'bodyshapes/bodyshapes-elvs-fem-liver',
  'bodyshapes/bodyshapes-elvs-fem-ovary',
  'bodyshapes/bodyshapes-elvs-fem-thyroid',
  'bodyshapes/bodyshapes-elvs-man-adrenal',
  'bodyshapes/bodyshapes-elvs-man-liver',
  'bodyshapes/bodyshapes-elvs-man-gonadal',
  'bodyshapes/bodyshapes-elvs-man-thyroid',
]

// ------------------------------------------------------------
// 查询函数
// ------------------------------------------------------------

/** 按站内列名取测量点；没有这一格 ⇒ null（⛔ 当成"不设限"，同 `bodyLimits.limitOf` 的纪律） */
function measurePointByColumn(column) {
  if (!column) return null
  return MEASURE_POINTS.find((p) => p.column === column) || null
}

/** 按 key 取测量点 */
function measurePointByKey(key) {
  return MEASURE_POINTS.find((p) => p.key === key) || null
}

/** 站内还没有数值格的那些点——"下一轮该补哪一格"的排序照这份 */
function measurePointsWithoutRepoColumn() {
  return MEASURE_POINTS.filter((p) => p.column === null)
}

/**
 * 外来看板上的体型名 → 站内五档。
 * @param {string} name 上游 mod（'bodyshapes/bodyshapes-elvs-fem-diamond'）或上游 label（'Elvs Female Diamond'）
 * @returns {string|null} 五档之一；对不上、认不出、传空 ⇒ null
 */
function bodyTypeFromShape(name) {
  const raw = String(name == null ? '' : name).trim()
  if (!raw) return null
  const hit = BODY_SHAPE_CROSSWALK.find((r) => r.mod === raw || r.en === raw)
  return hit ? hit.bodyType : null
}

module.exports = {
  VENDOR_DIR,
  VENDOR_MEASURE,
  VENDOR_BODYSHAPES,
  MEASURE_POINTS,
  REPO_COLUMNS_WITHOUT_MH_POINT,
  BODY_SHAPE_CROSSWALK,
  HORMONE_SHAPE_MODS,
  vendorMeasureMods,
  vendorBodyShapes,
  measurePointByColumn,
  measurePointByKey,
  measurePointsWithoutRepoColumn,
  bodyTypeFromShape,
}

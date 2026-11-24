/**
 * 身体数值格的生理范围界 —— 全项目**唯一一份**尺子
 *
 * 为什么要有这个文件（DR1，10-19 蓝图 §5.3，10-23 第六十四轮）：
 * 改前同一个 `body_metrics` 表有两把尺子在量同一批列——
 *   - `routes/analysis.js` 的 `POST /body`：老界 身高 50~300／体重 20~500，越界被 `safeNum` 静默抹成 null；
 *   - `services/profileArchive.js` 的 `BODY_FIELDS`：身高 50~250／体重 20~300，越界被 `cleanNum` 静默抹成 null。
 * 顾客实际走的是后面那把（前端 `saveProfileArchive()` PUT `/analysis/archive`，
 * 全仓 0 处调用 `/analysis/body`——10-23 现量），于是第一轮把 `/body` 收紧到生理界之后，
 * **真正在写库的那条路仍按松界收，而且照旧静默丢弃**。两把尺子各自的数字也没有出处，
 * 谁改一条就得记住改两条。这里收成一份，按**列名**索引，两个入口都从这里取。
 *
 * 界的口径（不是拍脑袋，逐条写明）：
 *  - 身高 140~220：取蓝图建议的「女 140~200／男 150~220」并集。⛔ 在本文件另建按性别的第二套档——
 *    本路由不强制带性别，档案里 `gender` 可为空；窄界会误杀真人的腿长/身高组合。
 *  - 体重 25~200：下沿来自 BMI 交叉判据在 140cm 处能接受的最轻值（12×1.4²≈23.5）往上取整，
 *    上沿配合 220cm/BMI 50 检查（50×2.2²=242 已被 BMI 轴拦下，200 是更严的常识界）。
 *  - 围度（腰/臀/胸）上沿统一取 **200**：档案旧界是 200~220，`/body` 改前的老代码（`safeNum`）也是 200，
 *    本轮第一次收紧时我写过 160——**已撤回**，因为蓝图 §5.3 点名的「围度 ∈ [30,200]」
 *    它的意见是**缺交叉判据**，不是"200 太宽"。⛔ 收到 160：大码用户的臀围/胸围实测可以超过 160，
 *    把界定在 160 等于用我的想象裁掉真人，而这一维的合理性已经由「腰围 ≤ 胸围+15」那条交叉判据负责。
 *    下沿按人体量不出来什么就裁什么：腰 40、臀 50、胸 60。
 *  - 肩宽 30~65：档案旧界 20~80 的两端都不是量得出的数（骨肩宽实测极少越过 50）。
 *  - 腿长 30~160：沿用档案 `leg_length_cm` 的旧界，本轮没有理由动它。
 *  - 腿长比例 0.3~0.8：`leg_length_ratio` 存的是腿长/身高，只有 `/body` 这一路会写它
 *    （档案表 `BODY_FIELDS` 走的是厘米列），0.3~0.8 沿用本轮收紧前的取值。
 *  这一层只负责**拦明显不可能是量出来的数**（10-23 现量：顾客表单的身高体重是自由数字输入，
 *  `type=number` 没有 min/max），不负责判断身材好不好；真正的体型判定在
 *  `bodyDimEstimator.js` 按人类测量包络另算，那是**估算**不是**校验**，
 *  ⛔ 把它的分位数当输入界。
 */

/** 列名 → 界与给用户看的中文名（label 直接进 400 话术，改它等于改顾客看到的话） */
const LIMITS = {
  height_cm: { label: '身高(cm)', min: 140, max: 220 },
  weight_kg: { label: '体重(kg)', min: 25, max: 200 },
  shoulder_width_cm: { label: '肩宽(cm)', min: 30, max: 65 },
  waist_cm: { label: '腰围(cm)', min: 40, max: 200 },
  hip_cm: { label: '臀围(cm)', min: 50, max: 200 },
  bust_cm: { label: '胸围(cm)', min: 60, max: 200 },
  leg_length_ratio: { label: '腿长比例', min: 0.3, max: 0.8 },
  leg_length_cm: { label: '腿长(cm)', min: 30, max: 160 },
}

/** `POST /body` 逐格校验的话术顺序（与 10-23 现量的 400 文案一致；档案表顺序不同，不共用） */
const BODY_COLUMN_ORDER = [
  'height_cm',
  'weight_kg',
  'shoulder_width_cm',
  'waist_cm',
  'hip_cm',
  'bust_cm',
  'leg_length_ratio',
]

/** 取某列的界；没有这一列的界 ⇒ null（调用方必须显式处理，不许当成"不设限"） */
function limitOf(column) {
  return LIMITS[column] || null
}

/**
 * 严格校验一列的数值（DR1：越界从"静默 null"改成"点名哪一格"）。
 * 返回 `{ absent: true }` ＝ 这次没提交这一格（调用方保留档案原值，局部提交语义不变）；
 * 返回 `{ error }` ＝ 提交了但不是数／越界；返回 `{ value }` ＝ 可用值。
 * ⛔ 不用 parseFloat——`'170abc'` 被截成 170 正是蓝图 DR6「进来的数本身就不可信」的来源之一。
 */
function strictNum(column, val) {
  const lim = limitOf(column)
  if (!lim) throw new Error(`bodyLimits: 列 ${column} 没有登记界，⛔ 静默放行`)
  if (val === undefined || val === null) return { absent: true }
  if (typeof val === 'string' && !val.trim()) return { absent: true }
  if (typeof val === 'object') return { error: `${lim.label}得填数字` }
  const n = typeof val === 'number' ? val : Number(String(val).trim())
  if (!Number.isFinite(n)) return { error: `${lim.label}得填数字` }
  if (n < lim.min || n > lim.max) {
    return { error: `${lim.label} ${n} 超出合理范围（${lim.min}~${lim.max}）` }
  }
  return { value: n }
}

/**
 * 交叉合理性判据（DR1 ③）：单格都在界内，组合仍可能生理上不可能。
 * 传进来的 `view` 必须是**这次提交之后档案会长什么样**的合并视图
 * （这次带的值优先，没带的用档案旧值补）——库里的旧格可能是按老界收进来的，
 * 所以判据只在组合齐了才生效，拦的是"新组合"，不会把历史档案里已有的单格翻出来报错。
 * 返回错误话术数组（空数组＝没有违和）。⛔ 在这里写库或决定要不要写。
 */
function crossCheckErrors(view) {
  const errors = []
  const v = view && typeof view === 'object' ? view : {}
  const h = v.height_cm
  const w = v.weight_kg
  if (h != null && w != null) {
    const bmi = w / ((h / 100) * (h / 100))
    if (bmi < 12 || bmi > 50) {
      errors.push(
        `身高 ${h}cm 与体重 ${w}kg 算出 BMI=${Math.round(bmi * 10) / 10}，超出可信区间（12~50）`,
      )
    }
  }
  const waist = v.waist_cm
  const bust = v.bust_cm
  if (waist != null && bust != null && waist > bust + 15) {
    errors.push(`腰围 ${waist}cm 比胸围 ${bust}cm 大 15cm 以上，生理上不可能`)
  }
  return errors
}

module.exports = { LIMITS, BODY_COLUMN_ORDER, limitOf, strictNum, crossCheckErrors }

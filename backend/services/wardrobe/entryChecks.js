/**
 * 衣橱写入口的值表与进门校验（11-03 拆分轮从 `routes/wardrobe.js` 逐字搬出）。
 *
 * 为什么归这一层：这一段不碰 req/res、不发 SQL，全部是"这个字段能收什么值、落库存成什么"
 * 的口径件；路由文件只管 HTTP 形状，口径判据集中在这里才改得动。
 * 唯一真相源纪律没变：场合词表仍引 `utils/occasionVocab`、版型与厚薄值表仍引
 * `services/topFitBody`、星级上下界仍引 `services/ruleFeedback`，本文件一处没抄第二份。
 * ⛔ 函数体与主文件调用点逐字未改（对账尺见本轮汇报）。
 */
const { asText, asNumber } = require('../../utils/common')
const { occasionValues } = require('../../utils/occasionVocab')
const { SCORE_MIN, SCORE_MAX } = require('../ruleFeedback')
const { FIT_TYPE_VALUES, FABRIC_WEIGHT_VALUES } = require('../topFitBody')

/**
 * 原样绑进 user_wardrobe 的可空标量列。
 * JSON 列表字段先 stringify、fit_style/fabric_weight 走 sanitizeEnum、is_favorite 转 0/1，
 * 都不会绑崩；只有这些"直接进 SQL 参数"的字段需要进门挡一次类型。
 */
const WARDROBE_SCALARS = [
  'name',
  'category',
  'sub_category',
  'color',
  'pattern',
  'condition',
  'price',
  'image_url',
  'sku',
  'shoulder_cm',
  'bust_cm',
  'length_cm',
  'waistband_cm',
]

/**
 * 成衣实测尺寸四格（2026-10-19 第二阶段「最后一公里」新增的列）。
 *
 * 上衣修形向量现在**只从这四格 + 两个真字段（color/fabric_weight）算**
 * （`services/topFitBody.js` 的 `describeTop`）：成品肩宽、成品胸围、衣长、腰头高，
 * 减去人体净尺寸就是"这件往哪个方向修、修多少"。
 * 改前这几维靠认中文商品名（"宽松""落肩""oversize"）—— 同一件衣服换个写法差两三十分，是伪量化。
 *
 * 口径：单位 cm；没填 = NULL = 这一维不进分（docs/依据/README.md:64「缺测不出分」（硬规矩 2））。
 * ⚠️ `waistband_cm` 的 0 是一个真实结论（"这件没有腰头/收口"），所以它的下限是 0；
 *    其余三格的 0 只能当"没量"，不允许当 0cm 的成衣。
 * 区间只挡明显敲错的数（把 39 敲成 390），不参与打分。
 */
const GARMENT_MEASURES = [
  { key: 'shoulder_cm', label: '衣服肩宽', min: 15, max: 70 },
  { key: 'bust_cm', label: '衣服胸围', min: 50, max: 160 },
  { key: 'length_cm', label: '衣服衣长', min: 25, max: 160 },
  { key: 'waistband_cm', label: '腰头/收口高', min: 0, max: 60 },
]

/** 四格实测尺寸的进门校验：没填放行，填了不是数或敲飞了 ⇒ 一句人话 + 400，不静默抹成 NULL */
function measureError(data) {
  for (const m of GARMENT_MEASURES) {
    const raw = data[m.key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = asNumber(raw, NaN)
    if (!Number.isFinite(n))
      return `${m.label}只能填数字（单位 cm），收到的是「${String(raw).slice(0, 20)}」`
    if (n < m.min || n > m.max) {
      return `${m.label}只能填 ${m.min}~${m.max} cm（单位是厘米，收到的是 ${n}）`
    }
  }
  return null
}

/** 落库存值：空 = NULL（没量），填了的数收成一位小数，免得界面出现 39.000000001 */
function measureValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = asNumber(raw, null)
  return n === null ? null : Math.round(n * 10) / 10
}

/** 心愿单与搭配两张表的原样标量列 */
const WISHLIST_SCALARS = ['category', 'color', 'reason', 'priority', 'gap_type']
// 2026-10-21 第十一阶段·第一步（docs/依据/19 §四）：日记加了三格，一并进这道"只能是文本或数字"的闸，
// 否则 `{"wear_date":{}}` 这种载荷会原样进 TEXT 列（值的形状由 utils/outfitWeather 再判一道）。
const OUTFIT_SCALARS = ['occasion', 'season', 'notes', 'wear_date', 'weather_level', 'feels_like_c']

/**
 * 穿搭日记（`wardrobe_outfits`）的场合值域＝**规则库在用的那一组词**，每次现从库里取。
 *
 * 为什么不在这里抄一份常量表：`rule_conditions` 里 `field='occasion'` 的 `value` 存的是 JSON 串
 * （现量 10-20 本机库：`"上班通勤" / "约会聚会" / "婚礼宴会" / "运动健身" / "居家休闲"` 五个词），
 * 规则命中的就是那个串。日记若收了表外的词，采下来也命不中任何一条规则 ⇒ 白采（这正是
 * docs/依据/16 §〇 说的"造了新词规则侧命不上"）。抄第二份值表还会留下"改了那边忘了这边"。
 *
 * 🔴 2026-10-21 第九阶段·第一步：函数体搬到 `utils/occasionVocab.js`（同名同口径），
 * 因为 `item_feedback`（`docs/依据/17` §二）也要收同一组词当值域——两处各抄一份就是两个真相源。
 * 这里留一个同名薄壳，本文件其余 6 个调用点一个字不改。
 * ⚠️ 取不到词时**只许留空**，不收自由文本——宁缺不猜，缺测不出分那条。
 */
function outfitOccasionValues() {
  return occasionValues()
}

/**
 * 搭配表（穿搭日记）的归属过滤条件——**读／改／删三处共用同一把尺子**（10-20 第八阶段·一c）。
 *
 * 为什么要 `session_id OR user_id` 两条口径：历史行 `user_id` 全 NULL（老 INSERT 没写这一列），
 * 从本轮起新行带 `user_id`；只按 session 取 ⇒ 换设备/清 session 就看不见自己前面记的，
 * 只按 user 取 ⇒ 把游客期（NULL）的整段扔掉。⛔ 三处不许各写各的 WHERE：
 * GET 看得见、PUT 回 404（或反过来）就是"两层各算一遍算出两个答案"那一类病灶。
 *
 * ⚠️ 传入的 user 只准来自 `getCurrentUser`（只读），不准用 `optionalUser`——
 * 后者会给认不到的 session **造一行 users**，读接口与"这条不是你的"的判定都不该有写库副作用。
 */
function outfitOwnershipFilter(user) {
  return user
    ? { sql: ' AND (session_id = ? OR user_id = ?)', args: (sessionId) => [sessionId, user.id] }
    : { sql: ' AND session_id = ?', args: (sessionId) => [sessionId] }
}

/** 日记星级进门校验：1~5 整数或空；越界说破（与反馈两把星同一把尺子，上下界从 ruleFeedback 引） */
function ratingError(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
    return `评分只能是 ${SCORE_MIN}~${SCORE_MAX} 的整数星级，收到的是「${String(raw).slice(0, 12)}」`
  }
  return null
}

/** 落库值：空＝NULL（没打），越界＝NULL（进门已被 ratingError 拦掉，这里只是兜底不写脏数） */
function ratingValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX ? n : null
}

/**
 * 版型与面料厚薄两档只认死值，认不到就当没填（缺测不编造，见 docs/依据/08 §10.1）。
 * 值域按 Sakata/Kim/Takatera 2020 实测的两种剪裁走向 + 常用厚薄三档。
 *
 * ⚠️ 10-19 第三阶段起有**两个**版型列，别混：
 *   · `fit_style`（合体/宽松）——老的展示标签，不再进任何算式（值域两档撑不起四档松量）。
 *   · `fit_type`（修身/合身/宽松/廓形）——评分唯一认的版型列，值表就是
 *     `services/topFitBody.js` 的 `FIT_TYPE_VALUES`（引它，不在这儿抄第二遍）。
 * 后端**不强制必填**（库里存量行没有这一列，硬拦会把老数据的 PUT 全打回）；
 * "必填"这条闸门落在前端表单（WardrobeTab 的 fitTypeError），后端只拦畸形值。
 */
const FIT_STYLE_VALUES = ['合体', '宽松']
// 🔴 10-21 第十一阶段·第一步：厚薄三档的值表搬到 `services/topFitBody.js` 当唯一真相源
// （`FABRIC_WEIGHT_VALUES`），因为偏好层的 `warmth` 轴也要认这三个词。
// 原来在这里抄一份＝两处各写一遍，改了录入校验忘了算分侧正是本项目反复清扫的病灶。

function sanitizeEnum(val, allowedVals) {
  const v = typeof val === 'string' ? val.trim() : ''
  return allowedVals.includes(v) ? v : null
}

/**
 * 枚举列的进门校验：没填 / 填空 / 值在表内 → 放行（这列留 NULL，缺测不编造）；
 * 填了却不认识 → 回一句人话，由调用方转 400。
 * 原来只有 sanitizeEnum 一层：PUT 传 fit_style='紧身' 被静默归成 NULL，把用户已填好的
 * '合体' 抹掉，而前端只看 HTTP 200 就弹「已保存修改」（10-13 现量）。
 * 前端两个下拉的取值与下面两张值表逐字一致 ⇒ 拦 400 只挡畸形请求，挡不到真实用户。
 */
function enumError(value, allowedVals, label) {
  if (value === undefined || value === null) return null
  const v = asText(value)
  if (v === '' || allowedVals.includes(v)) return null
  return `${label} 只能是 ${allowedVals.join('/')}，收到的是「${v.slice(0, 20)}」`
}

/** 三格枚举轴一起查（版型两列＋面料厚薄），返回第一条错误话术（没有则 null） */
function volumeAxisError(data) {
  return (
    enumError(data.fit_style, FIT_STYLE_VALUES, 'fit_style') ||
    enumError(data.fit_type, FIT_TYPE_VALUES, 'fit_type') ||
    enumError(data.fabric_weight, FABRIC_WEIGHT_VALUES, 'fabric_weight')
  )
}

module.exports = {
  WARDROBE_SCALARS,
  GARMENT_MEASURES,
  measureError,
  measureValue,
  WISHLIST_SCALARS,
  OUTFIT_SCALARS,
  outfitOccasionValues,
  outfitOwnershipFilter,
  ratingError,
  ratingValue,
  FIT_STYLE_VALUES,
  sanitizeEnum,
  enumError,
  volumeAxisError,
}

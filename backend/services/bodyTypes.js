/**
 * 体型标签的唯一词表（10-19 第一阶段·止血第 1 条）
 *
 * 为什么要单独立一个文件：这颗标签原本在四个地方各写一遍——引擎判定
 * （profileEnricher.computeBodyShape）、规则库存值（rule_conditions.value）、门店表单
 * （CustomerForm）、个人表单（PersonalProfileForm 的 body_type_detail）。四处只要有一处
 * 字不一样，规则就静默不命中：引擎是严格 AND，条件对不上就等于这条规则对这个顾客不存在，
 * 不报错、不留痕，只有顾客看到一套不搭的推荐。
 *
 * 10-19 现量（改前口径，对 backend/db/styleai.db 的仓外只读副本跑 SQL，判据＝下面注释里那条 SELECT；
 * 迁移跑完后本机库现量＝rule_conditions 929 条，其中 field='body_type' 的 26 条全在五档内）：
 *   rule_conditions 共 889 条，其中 field='body_type' 的 28 条——
 *     {"body_type":"苹果形"} 4 条（组 199/200/206/207，store 模式）：引擎出的是「苹果型」，
 *       这 4 条从写下起一次没命中过；
 *     {"body_type":"偏瘦"} 5 条 + {"body_type":"偏胖"} 5 条：这两颗是 BMI 档，不是体型，
 *       本轮由迁移脚本挪到 field='bmi_level'（bmi.js 的 HEALTH_BANDS 里就叫这两个名）；
 *     「沙漏型/梨形/苹果型/直筒型/倒三角型」各若干条：与引擎一字一样，本来就能命中。
 *   全仓字面出现次数（改前）：苹果形 17／苹果型 19／梨形 38／梨型 0／沙漏型 17／直筒型 16／倒三角型 14。
 *   改后（10-19 现量，判据＝grep -ro 只数 backend 的 .js/.json 与 app/src）：苹果形只剩注释与别名表的键，
 *   种子文件里 0 处、库内 0 条。
 *
 * 「梨形」为什么留「形」不留「型」：它没有竞争写法（梨型全仓 0 次），不存在静默失配；
 * 改成「梨型」要连规则库存值一起动（现量 10-19：rule_conditions 里 field='body_type' 且值含
 * 「梨形」的 6 条，本机开发库与种子快照同口径），而服务器那份运行库被 skip-worktree 钉住，
 * 改了名就得等一次手工迁移才生效，空窗期里这 6 条规则反而全部失配——正是本轮要修的那类
 * bug，不能自己再造一遍。
 * 要把五档统一成全「型」，改这一个文件 + 跑一次迁移脚本即可，产品这边点一下头就行。
 */
const { ownValue } = require('../utils/common')

/** 对外唯一的五档取值，顺序与 computeBodyShape 的判定分支一致 */
const BODY_TYPES = ['沙漏型', '梨形', '苹果型', '直筒型', '倒三角型']

/** 英文 key（BODY_SHAPE_OUTFIT 那套兜底文案用它，与中文档一一对应） */
const BODY_TYPE_KEYS = {
  沙漏型: 'hourglass',
  梨形: 'pear',
  苹果型: 'apple',
  直筒型: 'rectangle',
  倒三角型: 'inverted_triangle',
}

/** key → 中文档，从 BODY_TYPE_KEYS 反推，避免两份表各抄一遍再抄歪 */
const BODY_TYPE_BY_KEY = {}
for (const [zh, en] of Object.entries(BODY_TYPE_KEYS)) BODY_TYPE_BY_KEY[en] = zh

/**
 * 同义词归一表：只收「同一个意思、换了个字」的写法，不收语义不同的词。
 * 「标准/偏瘦/偏胖」不在这里——它们不是体型，是 BMI 档，硬翻成五档之一＝编造。
 */
const BODY_TYPE_ALIASES = {
  苹果形: '苹果型',
}

/**
 * 把任意来源的体型标签归一到五档词表。
 * @param {*} v 表单值、档案值或规则库存值
 * @returns {string|null} 归一后的档；空值归到 null；认不出的原样返回（宁可不归一，不覆盖顾客真填过的内容）
 */
function normalizeBodyType(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const alias = ownValue(BODY_TYPE_ALIASES, s)
  if (alias) return alias
  return s
}

/** 这颗取值是不是五档之一（后台校验与守卫测试用） */
function isBodyType(v) {
  const s = normalizeBodyType(v)
  return !!s && BODY_TYPES.includes(s)
}

module.exports = {
  BODY_TYPES,
  BODY_TYPE_KEYS,
  BODY_TYPE_BY_KEY,
  BODY_TYPE_ALIASES,
  normalizeBodyType,
  isBodyType,
}

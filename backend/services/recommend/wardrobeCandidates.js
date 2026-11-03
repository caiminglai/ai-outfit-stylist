// 11-03 大文件拆分轮：这一段从 services/recommendEngine.js 逐字搬来（衣橱实测上衣进候选集）。
// 函数体与口径注释一处未改；⛔ 对外出口仍只走 recommendEngine.js 那份再导出。
const { colorFit, extractColors } = require('../colorMetrics')
const { asText } = require('../../utils/common')
const { topFitBody, isTopCategory, FIT_TYPE_VALUES } = require('../topFitBody')

/**
 * 这一段原本是 `buildRecommendation` 里的「6. 衣橱里量过尺寸的上衣进候选集」，整块搬进来做纯函数。
 * 入参只有三样：`profile`（本次请求体）、`skinLab`（`_skinForColor` 出来的那份 Lab）、`bodyDev`（`bodyDeviation(enriched)`）。
 * ⛔ 不查库、不读全局、不改入参；返回的数组与原位置逐条相同（`wardrobeTops`）。
 * @param {object} profile 本次请求体
 * @param {{skinLab:object|null, bodyDev:object}} opts
 * @returns {Array} 衣橱里带实测/版型依据的上衣候选
 */
function collectWardrobeTops(profile, { skinLab, bodyDev }) {
  // 6. 衣橱里量过尺寸的上衣进候选集（10-19 第二阶段「通脉」；10-21 第九阶段·第一步放开门店模式）
  //    规则命中的那几条是"该买什么"的文字结论，身上没有一件实测过的衣服 ⇒ 廓形那一维永远空转。
  //    真正带成品尺寸的只有衣柜里的那几行，所以把它们也当候选：
  //    它们不是规则命中的 ⇒ 不吃规则基础分那一维，由 rankDims 按在场维归一 + 覆盖率折扣。
  //    ⛔ 四格实测一个都没填、版型也没选的行进不来（不是排最后，是不参与排序）。
  //    10-19 第三阶段·模块一把门槛从"必须量到尺"放宽成"至少有一条算得出的依据"：
  //    只选一档版型的那件也进得来，松量由版型区间中值估出来、在覆盖率里只按半格计，
  //    最后仍要过 `topFitBody` 的覆盖率惩罚 ⇒ "选个版型"占不到便宜，但公式照样能跑。
  //
  //    🔴 10-21 改口的这一条（`docs/依据/17` §五 第 1 条）：原来写死 `mode === 'personal'`，
  //    于是**门店模式看不到任何带尺寸的候选**——身体那一维在门店流程里连进场的机会都没有
  //    （现量 10-21 盘外副本：store 传了 wardrobe_items ⇒ `from_wardrobe=0`）。放开成
  //    "profile 里带了 `wardrobe_items` 就进"，两档都开门。
  //    ⛔ 安全性靠上游而不是这里：这些行只可能是**本次会话自己**扫码/录入的那几件
  //    （`routes/recommend.js` 按 session_id 过滤，见 17 §五 第 2 条），
  //    请求不带这一格时候选池与改前逐条相同（17 §七 那条"默认关得住"的回归防线）。
  const wardrobeTops = []
  if (Array.isArray(profile.wardrobe_items) && profile.wardrobe_items.length > 0) {
    const skinForColor = skinLab
    for (const raw of profile.wardrobe_items || []) {
      if (!raw || typeof raw !== 'object') continue
      if (!isTopCategory(raw.category)) continue
      const hasMeasure = [raw.shoulder_cm, raw.bust_cm, raw.length_cm, raw.waistband_cm].some(
        (v) => v !== null && v !== undefined && String(v).trim() !== '',
      )
      const hasFitType = FIT_TYPE_VALUES.includes(
        typeof raw.fit_type === 'string' ? raw.fit_type.trim() : '',
      )
      if (!hasMeasure && !hasFitType) continue
      const bf = topFitBody(null, raw, bodyDev)
      if (!bf) continue
      delete bf.person // 这个人自己的数整份报告只留一份（见 _computed.body_deviation）
      const entry = {
        source: 'wardrobe',
        wardrobe_item_id: raw.id ?? null,
        group_id: null,
        group_name: `衣橱里的：${raw.name || '没填名字的一件'}`,
        priority: null,
        score: null,
        feedback: null,
        evidence_level: null,
        top_style: raw.name || null,
        bottom_style: null,
        dress_style: null,
        color_combo: raw.color || null,
        // 这条不是规则命中的 ⇒ 不写 explanation（那个对象是"命中了哪些规则条件"的口径，
        // 前端按 ✓ 列表渲染并打"匹配分/优先级"，给它一份算分依据会显示成假的东西）。
        // 算分依据放在 reason 这一句人话里 + body_fit.top.signals 里。
        reason: `衣柜实测：${raw.name || '没填名字的一件'}。${(bf.top.signals || [])
          .slice(0, 4)
          .join('；')}。这一分的依据是你自己量出来的成品尺寸，不是规则文本`,
        body_fit: bf,
        // 🔴 10-21 第十一阶段·第一步（`docs/依据/19` §五 第 3 条）：场合与厚薄这两格要进乘子，
        // 就得先出现在这条候选身上——原来这一路只带颜色与身体，`occasion` 升档等于白升（读不到值就逐条隐身）。
        // ⛔ 只认数组（`utils/common.js:374` 投影出来就是数组），非数组当没填；
        // ⛔ 不在这里判词表：`user_wardrobe.occasion_tags` 由 `routes/wardrobe.js` 写入口收口，
        //   这一层只负责"取得到值"，词表那条尺子不抄第二份。
        occasion_tags: Array.isArray(raw.occasion_tags)
          ? raw.occasion_tags.map((t) => asText(t)).filter(Boolean)
          : [],
        // 厚薄有两个来源：投影带的那一格，或 `topFitBody` 算完挂在 `body_fit.top` 上的那一格
        // （`topFitBody.js:716`，没填是 null）。两个都认，⛔ 只认薄/中/厚三个词——判词的事在 `candAxisValue`。
        fabric_weight: asText(raw.fabric_weight) || bf.top.fabric_weight || null,
      }
      // 衣橱这一处的颜色有两个来源：顾客填的「颜色」栏（raw.color，可以直接写 hex）
      // 和商品名（raw.name，「雾霾蓝卫衣」这种把色写在名字里的写法）。改前只读颜色栏一个字段
      // ⇒ 那一栏空着、色写在名字里的行，色彩维整个缺席；口径与 topFitBody 的体量那一格一致：
      // ⛔ 先试颜色栏、取不到才试名字，不许把两串拼一起（拼串会让 '#111111' 不再是纯 hex 串）。
      const colorCandidates = [asText(raw.color), asText(raw.name)].filter(Boolean)
      let fit = null
      entry.color_text = null
      for (const candidate of colorCandidates) {
        fit = colorFit(skinForColor, candidate)
        if (fit) {
          entry.color_text = candidate
          break
        }
      }
      if (fit) entry.color_fit = fit
      entry.color_basis = fit ? fit.basis : null
      entry.color_parts = fit
        ? extractColors(String(entry.color_text || '')).filter((c) => c.is_specific).length
        : 0
      wardrobeTops.push(entry)
    }
  }
  return wardrobeTops
}

module.exports = {
  collectWardrobeTops,
}

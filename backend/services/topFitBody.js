/**
 * 上衣 × 身体 的按人适配分（这一层不看脸）
 *
 * 建档：2026-10-09。设计口径见 docs/依据/08-上衣适配规则-量化方案.md §5/§8/§9/§10。
 * 脸侧那一半（上衣代表色 vs 肤色锚点）在 colorMetrics.js 的 colorFit，两个分数不许混进一个数。
 *
 * 一句话做法：**先算这个人身上"能被上衣改"的比例偏差（偏差向量），再读这件上衣"往哪个方向修、
 * 修多少"（修形向量），同向得分、反向扣分；缺哪一维就不算哪一维，权重按在场维重新归一化。**
 * 这样"同一件上衣在不同人身上分数不同"是几何出来的，不需要谁背书。
 *
 * 输入只用连续量（cm、BMI、明度）。`body_type` / `kibbe_type` / 色彩四季型这类离散标签
 * 一律不进公式（08 §9.2：分类会把分类自身的信度问题带进分数，还会让人以为系统在"判定体型"）。
 *
 * 六根轴与出处（DOI 均已于 10-08 逐条走 api.crossref.org 自核，记录在 docs/依据/06 §8）：
 *  1) shoulder 肩线宽窄   —— 肩宽÷身高、肩宽÷腰围两条离带距离 + 梨形信号；上衣往肩上加体量还是收
 *       Pazhoohi 2023 的 SHR＝肩围÷臀围（本机原文 p2 逐字：the circumference of the shoulders relative to the hips）；
 *       我们量不到"肩围"⇒ 肩宽÷腰围是站内自建比值，只借它方向（p1 摘要：larger SHRs were considered more attractive）
 *  2) waist 腰线强调      —— 人的胸腰差/臀腰差；上衣收腰还是直筒（顺着身体走，不给不存在腰线硬收）
 *  3) ease 松量           —— Liu/Fan/Lau 2006, PMS 103(1):253-264, DOI 10.2466/pms.103.1.253-264
 *       （9 名中国男性 × 5 档白 T：BMI<20 穿大码被评更胖、20–28 更瘦、>28 两端都罚；最小感知尺寸在胸围松量 2–3 cm）B
 *       + Sakata/Kim/Takatera 2020, IJCSCT 33(3):448-464, DOI 10.1108/ijcst-03-2020-0031
 *       （女式衬衫 fit 款胸围 1–7 cm、straight 款约 4 cm；n=20 低于 ITU-T P.910 的 ≥24）B−，只当先验区间
 *  4) length 视觉腰位     —— 人的腿身比偏差 vs 上衣把视觉重心上移/下移（短款、塞腰头 vs 长款过胯）
 *       Kiire 2016 与 Versluys 2018 对腿长比例结论不一致 ⇒ 参考带只当"偏差原点"，不当判据
 *  5) volume 观感体量     —— 深色收缩：Koutsoumpis/Economou/van der Burg 2021, Perception 50(9):741-756,
 *       DOI 10.1177/03010066211038158（深色独立效应 d=0.35–0.58）B；面料厚薄加体量是 C 档经验
 *  6) pattern 条纹方向    —— 结论对冲（Thompson & Mikellidou 2011 DOI 10.1068/i0405 与 Swami & Harris 2012
 *       DOI 10.2224/sbp.2012.40.8.1239 方向相反；Ashida 2013 DOI 10.1068/i0595rep 指出体型大时减弱甚至反转；
 *       Chen & Peng 2026 DOI 10.1177/20416695261441454 给的是"最瘦判断"不是绝对量）
 *       ⇒ 权重压到最低，且 BMI≥25 直接关掉这根轴；对外措辞禁止写"横条显胖/显瘦"（docs/依据/05）
 *
 * 档位诚实说明：修形向量的**方向**来自上面这些 B 档实验；**刻度**（want 拉到 ±1 的换算、
 * 厚薄分档、六根轴的权重）全是 C 档手拍值，处于"标定中"。没有任何国标/行标/同行评议文献规定
 * "某人穿某件上衣好不好看"（08 开头 + 06 的证伪记录）。对外只可以说"按公开研究的方向给参考分"。
 *
 * ============================================================
 * 2026-10-19 第二阶段「最后一公里」：修形向量改吃**成品实测尺寸**，中文词典整块废除
 * ============================================================
 *
 * 改前这件上衣"往哪修"是从 `name / sub_category / pattern / style_tags` 拼出来的自由文本里
 * 认字（`LEXICON` 四张表：垫肩 +1、落肩 −0.6、oversize −0.7…），再拿"宽松/合体"这两个自填档位
 * 当松量代理。那叫**伪量化**：同一件衣服，商品名写"廓形落肩卫衣"和写"卫衣"会得到两个不同的分，
 * 而这两句话背后没有任何尺寸。⇒ 本轮把词典与自由文本这条路整块删掉，改成四格实测数与人体净尺寸
 * 直接做算术（列在 `user_wardrobe`，录入口径见 `fitSize.js` 的 MEASURE_GUIDE）：
 *
 *   shoulder_cm 成品肩宽 − 净肩宽   → 肩线方向（按身高换算成百分点，与 want.shoulder 同一把尺子）
 *   bust_cm     成品胸围 − 净胸围   → 松量（cm），直接进 easeScore(松量窗口, 实测算出的松量)
 *                               └ 这一格没量时改由 fit_type 版型档估（见下面第三阶段那段）
 *   length_cm   下摆落在人体哪条线  → 视觉腰位（身高×0.40 附近＝胯线，往上为正）
 *   waistband_cm 收口/腰缝带高度    → 腰线强调（0＝明确直筒，5cm 及以上＝拉满收腰）
 *
 * 一列一格、一维一源，不重复收钱（胸围只进松量那一维，不再同时喂"观感体量"）。
 * 体量维仍走两个**真字段**：color 的 Lab 明度（A 档色差侧）＋ fabric_weight 自填厚薄档。
 * 条纹维只读 `pattern` 这一格自填值（认 竖条/横条 四个值），不再从商品名里找"条"字。
 *
 * ⛔ **没有衣柜行 ⇒ 这一件不打分**。规则引擎给的那句 `top_style` 文本（"商务Polo衫"）从此
 * 不再产出 body_fit——这不是退化，是拒绝把"认字"冒充成"量出来的分"。缺测在身体层按**覆盖率惩罚**
 * 打折（见下面第三阶段那段），排序侧只负责"整维缺席 ⇒ 权重退场"，不补 0 分、不猜高分。
 *
 * ============================================================
 * 2026-10-19 第三阶段「注水与校准」：这一层加了两件事
 * ============================================================
 *
 * ① 模块二·覆盖率惩罚（`COVERAGE_PENALTY`）：在场轴归一让"六格只量出一格、那格恰好满分"归出
 *    100 分 ⇒ 靠少填给高分。现在 `score = raw_score ×（floor + span × coverage）`，量得越少扣得越狠，
 *    六格齐全的一件一分不扣。
 *
 * ② 模块一·版型映射（`FIT_TYPE_VALUES`／`FIT_TYPE_EASE`）：真实用户不动软尺，四格门槛把管道饿住了。
 *    所以 `bust_cm` 没量但 `fit_type` 选了档 ⇒ 松量按该档放松量区间的**中值**估出来，让公式照样跑；
 *    代价是估出来的那一维在 `coverage` 里只按 **半格**（`ESTIMATED_AXIS_WEIGHT`）计，
 *    ⇒ "只选一档版型"最多拿到 0.5/6≈0.08 的覆盖率，惩罚照样压在头上（选版型买不到整格分数）。
 *    有 `bust_cm` 实测 ⇒ 只认实测，版型那格一个分都不影响（实测优先，两套依据不重复收钱）。
 *
 * ============================================================
 * 2026-10-20 第五阶段「只填身高体重」接线：估算值进 `person_cm`，只进这一格
 * ============================================================
 *
 * ③ `bodyDeviation(person, est)` 多了一个可选入参（不传时回落到 `person.body_est`，
 *    那是 `profileEnricher.enrichProfile` 挂的独立通道）。估算出来的净胸围／净肩宽**只补
 *    `person_cm` 里没量到的那两格**，用来和成衣实测做减法；⛔ 不回写 `p.bust`／`p.shoulder`、
 *    ⛔ 不参与 `measure`／`want`／体型五分类／规则匹配（口径与七条禁令全在
 *    `docs/依据/13-体型估算输入输出规范-20261020.md` §五，喂与不喂 est 的 `measure`/`want`
 *    逐格相同由 `test/bodyDimEstimator.test.js` 断言）。
 *    顶上来的那一轴按 **半格**（`ESTIMATED_BODY_AXIS_WEIGHT`）计覆盖率、且与版型侧那半格不叠乘，
 *    `person_cm_src`＋`ease_src`/`shoulder_src`＋`based_on` 文案三处都留下"这是估的"的记号。
 */

// 11-03 大文件拆分轮：第 0～4 节的实现搬到 ./topFit/ 四个模块，本文件只做「头注释＋再导出」。
// 公开出口逐字未动：下面 module.exports 的 20 个名字与顺序都和拆前一致，别处 require 的写法一行不改。
// ⛔ 只进口袋里要出口的那 20 个：`clamp`/`r1`/`r2`/`cm` 这些实现段的私有工装不进出口名单。
const {
  meas,
  BODY_REF,
  AXIS_WEIGHTS,
  COVERAGE_PENALTY,
  FIT_TYPE_VALUES,
  FIT_TYPE_EASE,
  easeFromFitType,
  ESTIMATED_AXIS_WEIGHT,
  ESTIMATED_BODY_AXIS_WEIGHT,
  AXIS_CN,
  AXIS_TIER,
} = require('./topFit/refs')
const { bodyDeviation, GARMENT_REF, easeWindowFor } = require('./topFit/deviation')
const { FABRIC_WEIGHT_VALUES, FABRIC_BULK, isTopCategory, describeTop } = require('./topFit/shape')
const { topFitBody, rankTopsByBody } = require('./topFit/scoring')

module.exports = {
  BODY_REF,
  meas,
  easeWindowFor,
  AXIS_WEIGHTS,
  COVERAGE_PENALTY,
  FIT_TYPE_VALUES,
  FIT_TYPE_EASE,
  easeFromFitType,
  ESTIMATED_AXIS_WEIGHT,
  ESTIMATED_BODY_AXIS_WEIGHT,
  AXIS_CN,
  AXIS_TIER,
  GARMENT_REF,
  FABRIC_BULK,
  FABRIC_WEIGHT_VALUES,
  bodyDeviation,
  describeTop,
  isTopCategory,
  topFitBody,
  rankTopsByBody,
}

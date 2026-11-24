/**
 * 色度学工装：把"这件上衣衬不衬这个人"拆成可复算的物理量。
 * 依据档位（2026-10-06 逐条核实，详见 docs/上衣量化依据与公式清单.md）：
 *   A 档（国标/国际标准）：sRGB→CIELAB(D65) 换算、色差公式 —— GB/T 7921-2008《均匀色空间和色差公式》、ISO/CIE 11664 色度学
 *   B 档（同行评议）：CIEDE2000 实现 Sharma et al. 2004 (DOI 10.1002/col.20070)；
 *                     Schloss & Palmer 2011 (DOI 10.3758/s13414-010-0027-0, PMC3037488) 全文里
 *                       有两句方向相反的结论，必须分清用哪一句：
 *                       ① "pair preference and harmony both increase as hue similarity increases"
 *                          —— 两块色当**一个整体**看时，越像越和谐；
 *                       ② "figural color preference ratings increase as hue contrast with the
 *                          background increases" —— **图形色衬背景色**时，色相差越大越被偏好。
 *                       上衣衬脸属于第②句（衣是图形色、脸是背景）⇒ 本模块按对比打分（10-08 改，
 *                       原来这里第①句的口径把 45% 权重加错了边，见 docs/依据/08 §8.2）。
 *                       第①句"越像越和谐"只适用于两件单品之间 ⇒ 它走 outfitHarmony，量的是**单品互相**，
 *                       与②的对象不同（②量衣 vs 脸）。10-19 第一阶段·止血第 4 条起，这个呼应分
 *                       按 30% 份额进 colorFit 总分（HARMONY_SHARE），两个分量各自回在
 *                       contrast_score / harmony_score 里可拆回账；原先"不进这条分"的写法是因为
 *                       ①②若都拿"衣 vs 脸"当对象就会把两句相反的结论加进同一个数——现在不是。
 *                       ⚠️ 这条与 docs/依据/08 §8 通用骨架第 2 条「两者不能加进同一个数」的
 *                       字面仍有出入，已列入本轮待裁事项。
 *                     Gong & Lee 2019, Coloration Technology 135(4):292-304
 *                       (DOI 10.1111/cote.12405) 的和谐四规则是下一步要替换本条轴的东西，尚未实现。
 *                     衣装明度↓⇒面部肤色被评为更显白 Zhang et al. 2025, Coloration Technology 142(2):259-271 (DOI 10.1111/cote.12828)；
 *                     ITA° 分档切点 ⇒ 🟢 10-10 第二十一轮改口（旧写法把这四个切点归给 Osto et al. 2022, DOI 10.1111/php.13562 ＝张冠李戴，那篇证的是"ITA 六档与 Fitzpatrick 六型不可互换"，不含任何切点）。上四档逐字出处＝Saint-Léger 2015, Int J Cosmet Sci 37:259-265, DOI 10.1111/ics.12194 第 2 页「10–28°: Tan/Matt; 28–41°: Intermediate; 41–55°: Light; and >55°: Very Light」⇒【官方原文·本机 PDF】（docs/依据/papers/人类皮肤的颜色：富有成效的科学，却用词不合适.pdf，290,862 B／7 页／md5 d084391dc334e82404036678b5e71742，核对记 docs/依据/10 §2i③）。⛔ 三条限定：① brown/dark 两档本机原文里没有（该文只给到上四档；代码用的 −30 下界与通行 −3 不是同一个数，未裁）⇒【未核实】，属本工程自定；② 该文自己把切点指向 US FDA／Cosmetics Europe 指南 ⇒ 那一层仍【二手】；③ 概念起源 Chardon et al. 1991, DOI 10.1111/j.1467-2494.1991.tb00561.x 本机无原文 ⇒【B·DOI 已证·本机无原文】，不许说成"科学分档"。
 *   C 档（本工程自定，不是文献值）：色名→hex 词表、下面的合成分权重。
 *     换掉 C 档这两样之前，本模块只能算"相对差异"，不能对外宣称"科学测色"。
 *     （肤色档→Lab 锚点原列 C 档，10-29 已换成 CIE 汇编华裔 404 人分位子样实测、升 B 档，
 *       逐档出处与限定见 SKIN_TONE_ANCHORS 块注释；仍非测色仪逐人实测，对外口径不变。）
 */

// 11-03 大文件拆分轮：实现搬到 ./color/ 的五个模块，本文件只做「头注释＋再导出」。
// 公开出口保持原样：下面这块 module.exports 逐字未动，别处 require 到的名字与顺序都和拆前一致。

const {
  hexToLab,
  hueGap,
  deltaE00,
  individualTypologyAngle,
  itaClass,
  ACHROMATIC_C,
} = require('./color/base')
const {
  COLOR_NAME_HEX,
  COLOR_SYNONYMS,
  COLOR_ANTI_SYNONYMS,
  COLOR_FAMILY_WORDS,
  COLOR_FAMILY_OVERRIDES,
  COLOR_HSL_FAMILY_BANDS,
  LIGHTNESS_BANDS,
  LIGHTNESS_TOKENS,
  COLOR_META_WORDS,
} = require('./color/vocab')
const {
  resolveColor,
  normalizeColorName,
  extractColors,
  colorFamily,
  lightnessBand,
  bandOfLab,
  COLOR_CRAFT_WORDS,
  COLOR_ALIAS_SCAN_TOKENS,
} = require('./color/resolve')
const {
  SKIN_TONE_ANCHORS,
  skinToneToLab,
  SKIN_HUE,
  skinUndertoneFromHue,
  synthesizeSkinLab,
} = require('./color/skin')
const {
  WEIGHTS,
  FUSION_GATE,
  HARMONY_SHARE,
  fusionGate,
  colorFit,
  outfitHarmony,
} = require('./color/fit')

module.exports = {
  hexToLab,
  deltaE00,
  hueGap,
  individualTypologyAngle,
  itaClass,
  resolveColor,
  normalizeColorName,
  extractColors,
  colorFamily,
  lightnessBand,
  bandOfLab,
  skinToneToLab,
  skinUndertoneFromHue,
  synthesizeSkinLab,
  SKIN_HUE,
  colorFit,
  outfitHarmony,
  fusionGate,
  ACHROMATIC_C,
  FUSION_GATE,
  HARMONY_SHARE,
  WEIGHTS,
  COLOR_NAME_HEX,
  COLOR_SYNONYMS,
  // 第十三阶段·第一步 §二·2：元词黑名单导出给单测与报告用（⛔ 别处不许再抄一份名单）
  COLOR_META_WORDS,
  // 第十三阶段·第一步 §二·1：工艺词与"句内扫描要走的别名表"同样只有一份真相源
  COLOR_CRAFT_WORDS,
  COLOR_ALIAS_SCAN_TOKENS,
  COLOR_ANTI_SYNONYMS,
  COLOR_FAMILY_WORDS,
  COLOR_FAMILY_OVERRIDES,
  COLOR_HSL_FAMILY_BANDS,
  LIGHTNESS_BANDS,
  LIGHTNESS_TOKENS,
  SKIN_TONE_ANCHORS,
}

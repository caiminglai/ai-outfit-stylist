/**
 * 拆分轮的公开出口体检（11-03 大文件拆分轮新增）
 *
 * 判据来自这里，不来自注释：拆完文件后薄壳里 `module.exports` 的名字与**顺序**必须和拆前逐字相同。
 * 名字漂了消费方不会报错，只会静默拿到 `undefined`——`recommendEngine` 那种一处 require 十几个名字的
 * 写法尤其如此。所以这几份名单写死在本文件里，改动出口必须同时改动这里，等于强制过一次人工确认。
 *
 * ⛔ 本测试只判"出口形状"，不判行为；行为由原有 900 多条测试兜住。
 */
const test = require('node:test')
const assert = require('node:assert')

const EXPECTED = {
  // 拆前＝HEAD `a8599bc` 里的 1131 行版本（34 个名字，顺序照抄）
  'services/colorMetrics.js': [
    'hexToLab',
    'deltaE00',
    'hueGap',
    'individualTypologyAngle',
    'itaClass',
    'resolveColor',
    'normalizeColorName',
    'extractColors',
    'colorFamily',
    'lightnessBand',
    'bandOfLab',
    'skinToneToLab',
    'skinUndertoneFromHue',
    'synthesizeSkinLab',
    'SKIN_HUE',
    'colorFit',
    'outfitHarmony',
    'fusionGate',
    'ACHROMATIC_C',
    'FUSION_GATE',
    'HARMONY_SHARE',
    'WEIGHTS',
    'COLOR_NAME_HEX',
    'COLOR_SYNONYMS',
    'COLOR_META_WORDS',
    'COLOR_CRAFT_WORDS',
    'COLOR_ALIAS_SCAN_TOKENS',
    'COLOR_ANTI_SYNONYMS',
    'COLOR_FAMILY_WORDS',
    'COLOR_FAMILY_OVERRIDES',
    'COLOR_HSL_FAMILY_BANDS',
    'LIGHTNESS_BANDS',
    'LIGHTNESS_TOKENS',
    'SKIN_TONE_ANCHORS',
  ],
  // 拆前＝11-03 输入校验轮之后的 975 行版本（20 个名字）
  'services/topFitBody.js': [
    'BODY_REF',
    'meas',
    'easeWindowFor',
    'AXIS_WEIGHTS',
    'COVERAGE_PENALTY',
    'FIT_TYPE_VALUES',
    'FIT_TYPE_EASE',
    'easeFromFitType',
    'ESTIMATED_AXIS_WEIGHT',
    'ESTIMATED_BODY_AXIS_WEIGHT',
    'AXIS_CN',
    'AXIS_TIER',
    'GARMENT_REF',
    'FABRIC_BULK',
    'FABRIC_WEIGHT_VALUES',
    'bodyDeviation',
    'describeTop',
    'isTopCategory',
    'topFitBody',
    'rankTopsByBody',
  ],
  // 拆前＝11-02 深夜轮之后的 1131 行版本（27 个名字）
  'services/profileEnricher.js': [
    'enrichProfile',
    'computeBmi',
    'computeBodyShape',
    'computeBodyHighlights',
    'computeWhRatio',
    'computeLegRatio',
    'computeShoulderRatio',
    'computeColorMatch',
    'computeColorSeason',
    'computeColorSeason12',
    'computeKibbeType',
    'computeBaziFields',
    'CHROMA_LEVEL',
    'FRAME_LEVEL',
    'LINE_LEVEL',
    'COLOR_SEASON_12_TABLE',
    'KIBBE_TABLE',
    'computeProportionLevels',
    'getBodyShapeOutfitAdvice',
    'getFaceShapeGuide',
    'getFaceProportionGuide',
    'FACE_PROPORTION_GUIDE',
    'EYE_SPACING_GUIDE',
    'getPostureAdvice',
    'OCCASION_TO_SCENARIO',
    'SKIN_TONE_COLOR_MAP',
  ],
  // 拆前＝10-29 拆分轮之后的 990 行版本（20 个名字，含它再导出的 rankDims／色彩槽位那一组）
  'services/recommendEngine.js': [
    'getRecommendations',
    'buildRecommendation',
    'recommendationBodyDeviation',
    'RANK_WEIGHTS',
    'RANK_RULE_REF',
    'RANK_COVERAGE_FLOOR',
    'RANK_ALGO_ABSENCE_PENALTY',
    'RANK_TOP_N',
    'RANK_MIN_ALGO_IN_TOP',
    'rankDims',
    'COLOR_BORROW_WEIGHT',
    'RELATIONAL_WORDS',
    'outfitColorParts',
    'resolveRelationalSlots',
    'relationalTargetsOf',
    'relationalLedger',
    'firstSpecificColor',
    'scoreTopColor',
    'ruleTextBodyFit',
    'rankAndTruncate',
  ],
}

for (const [file, names] of Object.entries(EXPECTED)) {
  test(`${file} 的公开出口：名字与顺序和拆前逐字相同`, () => {
    const keys = Object.keys(require('../' + file))
    assert.deepStrictEqual(
      keys,
      names,
      `${file} 的出口漂了。\n  现在：${keys.join(',')}\n  拆前：${names.join(',')}`,
    )
    for (const n of names) {
      assert.notStrictEqual(keys.filter((k) => k === n).length, 0)
      assert.notStrictEqual(
        require('../' + file)[n],
        undefined,
        `${file} 导出了 ${n} 但值是 undefined`,
      )
    }
  })
}

test('薄壳里没有把内部模块的私有名字漏到对外出口上', () => {
  // 拆分轮的规矩：实现段的私有工装（clamp/r1/align/cm 这类）不进出口名单，
  // 新拆出来的模块入口（collectWardrobeTops）也不许顺手进出口
  const cm = require('../services/colorMetrics')
  const tf = require('../services/topFitBody')
  const eng = require('../services/recommendEngine')
  const privates = [
    'clamp',
    'clamp01',
    'r1',
    'r2',
    'align',
    'easeScore',
    'cm',
    'TOP_CATEGORY_KEYS',
    'collectWardrobeTops',
    'hexToRgb',
    'normalizeHex',
  ]
  for (const privateName of privates) {
    for (const [label, mod] of [
      ['topFitBody', tf],
      ['colorMetrics', cm],
      ['recommendEngine', eng],
    ]) {
      assert.strictEqual(
        mod[privateName],
        undefined,
        `${label} 的出口里出现了私有名 ${privateName} ⇒ 说明薄壳把内部名字也导出去了`,
      )
    }
  }
})

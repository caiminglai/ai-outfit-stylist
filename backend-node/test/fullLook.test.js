/**
 * 完整形象指导（拼一套 + 金属色依据）纯函数测试
 *
 * 运行: node --test test/fullLook.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { pickMetal, buildFullLook } = require('../services/fullLookAdvisor');

const item = (name, category, score = 80, reasons = ['适合该场合']) => ({ name, category, score, reasons });

// ============ 金属色依据 ============

test('冷暖皮明确时按肤色取金属色，并说明依据', () => {
  assert.deepStrictEqual(pickMetal({ skin_tone: '暖皮' }, {}), { metal: '金', basis: '按你的冷暖皮' });
  assert.deepStrictEqual(pickMetal({ skin_tone: '冷白皮' }, {}), { metal: '银', basis: '按你的冷暖皮' });
});

test('肤色属于中性时不硬凑金属色判断', () => {
  assert.deepStrictEqual(pickMetal({ skin_tone: '自然' }, {}), { metal: '', basis: '' });
});

test('肤色没填但档案算出了四季型，退到四季型取色', () => {
  const r = pickMetal({ skin_tone: '' }, { color_season: '秋型' });
  assert.strictEqual(r.metal, '金');
  assert.match(r.basis, /四季型/);
  assert.strictEqual(pickMetal({}, { color_season: '冬型' }).metal, '银');
});

test('十二型也能用作依据，肤色与四季型都没有时返回空', () => {
  assert.strictEqual(pickMetal({}, { color_season_12: '浅夏型' }).metal, '银');
  assert.deepStrictEqual(pickMetal({}, {}), { metal: '', basis: '' });
});

test('肤色优先于四季型，两者矛盾时不推翻肤色原值', () => {
  assert.strictEqual(pickMetal({ skin_tone: '暖皮' }, { color_season: '冬型' }).metal, '金');
});

// ============ 拼一套 ============

test('三柜齐全时衣服+妆容+配饰各出件，且每件带自己的理由', () => {
  const look = buildFullLook({
    outfit: [item('白衬衫', '衬衫'), item('直筒牛仔裤', '裤子')],
    makeup: [item('粉底液', '粉底'), item('豆沙口红', '口红')],
    accessory: [item('锁骨链', '项链')],
  }, '约会');
  const slots = look.pieces.map((p) => p.slot);
  assert.deepStrictEqual(slots, ['上装', '下装', '底妆', '唇色', '颈饰']);
  assert.strictEqual(look.complete, true);
  assert.deepStrictEqual(look.missing_parts, []);
  assert.strictEqual(look.pieces[0].why.length, 1, '理由只带这件单品自己算出来的');
});

test('有连衣裙时不再另配上下装', () => {
  const look = buildFullLook({
    outfit: [item('茶歇连衣裙', '连衣裙'), item('白衬衫', '衬衫'), item('半裙', '半身裙')],
    makeup: [],
    accessory: [],
  });
  assert.deepStrictEqual(look.pieces.map((p) => p.slot), ['一件成套']);
});

test('同一件不会被两个槽位重复占用', () => {
  const look = buildFullLook({
    outfit: [item('针织开衫', '开衫')],
    makeup: [],
    accessory: [],
  });
  assert.strictEqual(look.pieces.length, 1);
  assert.strictEqual(look.pieces[0].slot, '外搭');
});

test('柜子空的时候不编造单品，直接说要先把东西存进柜', () => {
  const look = buildFullLook({ outfit: [], makeup: [], accessory: [] });
  assert.deepStrictEqual(look.pieces, []);
  assert.strictEqual(look.complete, false);
  assert.match(look.note, /还没有可搭配的单品/);
});

test('缺哪一类就点名缺哪一类，并说明是柜子里没有', () => {
  const look = buildFullLook({
    outfit: [item('白衬衫', '衬衫')],
    makeup: [item('粉底液', '粉底')],
    accessory: [],
  });
  assert.deepStrictEqual(look.missing_parts, ['下装', '唇色', '项链或耳环']);
  assert.match(look.note, /柜子里没有这一类/);
});

test('三件以上才算凑成一套，两件不算', () => {
  const two = buildFullLook({
    outfit: [item('白衬衫', '衬衫'), item('直筒牛仔裤', '裤子')],
    makeup: [],
    accessory: [],
  });
  assert.strictEqual(two.pieces.length, 2);
  assert.strictEqual(two.complete, false);
});

test('候选按分数排好，取的是排在最前的那一件', () => {
  const look = buildFullLook({
    outfit: [item('旧衬衫', '衬衫', 55), item('真丝衬衫', '衬衫', 92)],
    makeup: [],
    accessory: [],
  });
  assert.strictEqual(look.pieces[0].name, '旧衬衫', '调用方传的顺序就是排名');
});

test('耳环在没有项链时顶上颈饰位，两者都有时用项链', () => {
  const onlyEar = buildFullLook({ outfit: [], makeup: [], accessory: [item('珍珠耳钉', '耳钉')] });
  assert.strictEqual(onlyEar.pieces[0].slot, '耳饰');
  const both = buildFullLook({
    outfit: [],
    makeup: [],
    accessory: [item('珍珠耳钉', '耳钉'), item('锁骨链', '项链')],
  });
  assert.strictEqual(both.pieces[0].slot, '颈饰');
  assert.strictEqual(both.pieces[0].name, '锁骨链', '项链和耳环都有时取项链');
});

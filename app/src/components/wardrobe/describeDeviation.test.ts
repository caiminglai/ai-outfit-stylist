/**
 * 身材偏差向量拼成人话（11-03 拆分轮跟着 WardrobeTab.tsx 搬出来的那段）
 *
 * 为什么测：这句直接印在衣橱页每张上衣卡上，是"算法算的哪几维"唯一露给顾客看的一行。
 * 口径两条不许动：① 没量到的维度不许写"未知"凑数；② want 的符号与后端 topFitBody.js
 * 一致（+ 想往外加、− 想往里收、0 这一维不推拉）。搬文件时最容易把符号写反。
 */
import { describe, it, expect } from 'vitest'
import { describeDeviation } from './describeDeviation'
import type { TopFitResult } from '../../types'

type Dev = TopFitResult['person_deviation']
const empty = (over: Partial<Dev> = {}): Dev =>
  ({
    want: { shoulder: null, waist: null, length: null, volume: null, pattern: null },
    ...over,
  }) as Dev

describe('describeDeviation', () => {
  it('量到的才写，顺序与写法固定（BMI／肩宽÷身高／肩宽÷腰围／腿身比／胸腰差／臀腰差／腰沟／松量区间）', () => {
    const s = describeDeviation(
      empty({
        bmi: 21.3,
        bust_waist_diff: 18,
        hip_waist_diff: 22,
        waist_groove_cm: 18,
        ease_window_cm: [6, 10],
      }),
    )
    expect(
      s.startsWith('BMI 21.3 / 胸腰差 18cm / 臀腰差 22cm / 腰沟 18cm / 松量合适区间 6~10cm；'),
    ).toBe(true)
  })

  it('want 的正负号：＋写"想加"、−写"想收"、0 写"不推拉"', () => {
    const s = describeDeviation({
      ...empty(),
      want: { shoulder: 1, waist: -2, length: 0, volume: null, pattern: null },
    })
    expect(s).toContain('肩线想加 1')
    expect(s).toContain('腰线想收 2')
    expect(s).toContain('视觉腰位不推拉')
    expect(s).not.toContain('体量')
  })

  it('一个尺寸都没量到 ⇒ 明说"没量到尺寸"，不许编一个数字出来', () => {
    expect(describeDeviation(empty())).toBe('没量到尺寸；没量到能判的尺寸 ⇒ 只按能算的几维打分')
  })
})

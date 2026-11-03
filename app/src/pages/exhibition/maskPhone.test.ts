/**
 * 手机号打码（11-03 大文件拆分轮跟着 ExhibitionHall.tsx 一起搬出来的那段）
 *
 * 为什么测：它从页面文件搬进 src/pages/exhibition/maskPhone.tsx，搬的是"账号面板上
 * 那串号码不能整串露出来"这一条隐私口径。逐字搬完只证明编译得过，这条断言证明没搬丢。
 */
import { describe, it, expect } from 'vitest'
import { maskPhone } from './maskPhone'

describe('maskPhone', () => {
  it('11 位手机号只留前 3 位与后 4 位，中间固定四个星', () => {
    expect(maskPhone('13800001234')).toBe('138****1234')
  })

  it('不是 11 位就原样返回（后台存的可能是座机或手打的备注，不能瞎打码）', () => {
    expect(maskPhone('0571-8888')).toBe('0571-8888')
    expect(maskPhone('')).toBe('')
  })

  it('传进来不是字符串也不炸（账号接口那条字段允许 null）', () => {
    expect(maskPhone(undefined as unknown as string)).toBe('')
    expect(maskPhone(null as unknown as string)).toBe('')
  })
})

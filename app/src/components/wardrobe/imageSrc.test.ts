/**
 * 「只存图」那张图能不能真的让浏览器去取（11-03 拆分轮跟着 WardrobeTab.tsx 搬出来的那段）
 *
 * 为什么测：image_url 后台按短文本存，写入口是文本框，可以填任意串。这一版开始它的值
 * 会进 <img src> ⇒ 放一个外部地址进去，等于让每个顾客的浏览器替那个站点一次（暴露 IP、
 * 给对方计数）。所以这条安全口径只认"单个 / 开头且不是 //"，判据一行不许改。
 */
import { describe, it, expect } from 'vitest'
import { sameOriginImage } from './imageSrc'

describe('sameOriginImage', () => {
  it('我们上传返回的同源相对路径原样放行', () => {
    expect(sameOriginImage('/uploads/a.jpg')).toBe('/uploads/a.jpg')
  })

  it('协议相对写法 //evil.test/x.png 判成没图（它会带着当前协议去外部站）', () => {
    expect(sameOriginImage('//evil.test/x.png')).toBeNull()
  })

  it('绝对外部地址判成没图', () => {
    expect(sameOriginImage('https://evil.test/x.png')).toBeNull()
  })

  it('没填、填了 null、填了非字符串都当没图，不炸也不请求', () => {
    expect(sameOriginImage(undefined)).toBeNull()
    expect(sameOriginImage(null)).toBeNull()
    expect(sameOriginImage(123 as unknown as string)).toBeNull()
  })
})

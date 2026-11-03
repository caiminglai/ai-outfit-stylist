/**
 * 选图预检的行为钉（11-03 前端测试通道第 2 条）
 *
 * 为什么测这份：它是"顾客在手机相册里点一张照片"的第一道闸，判据必须跟后端
 * `backend/middleware/upload.js` 完全同一把尺——那边改了这里没跟上，就会出现
 * 「前端放行的图后端拒收」或反过来「前端把能传的挡掉」。这条口子以前只靠注释提醒。
 * ⚠️ 与后端 `middleware/upload.js` 的逐字对账**不在本文件**（那要 import `node:fs`，而
 * `tsconfig.app.json` 的 `types` 只有 `vite/client` ⇒ `tsc -b` 会报 TS2307，11-03 实测），
 * 对账落在 `backend/test/frontendConstantsParity.test.js`（那边能直接 require 真值）。
 */
import { describe, it, expect } from 'vitest'
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, checkPickedImage } from './imagePick'

/** 造一个 File：bytes 决定 size，type 留空模拟部分安卓相册不给 MIME */
function makeFile(name: string, type: string, bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe('checkPickedImage：四类入参的取舍', () => {
  it('合法 jpg / png / webp ⇒ null（可以传）', () => {
    expect(checkPickedImage(makeFile('a.jpg', 'image/jpeg'))).toBeNull()
    expect(checkPickedImage(makeFile('a.jpeg', 'image/jpeg'))).toBeNull()
    expect(checkPickedImage(makeFile('a.png', 'image/png'))).toBeNull()
    expect(checkPickedImage(makeFile('a.webp', 'image/webp'))).toBeNull()
  })

  it('被挡时回的是「给顾客看的那句话」，不是布尔（话术里带上称呼）', () => {
    const out = checkPickedImage(makeFile('a.gif', 'image/gif'), '人物照片')
    expect(out).toBe('人物照片只能是 JPG / PNG / WebP（当前是类型 image/gif）')
  })

  it('没有 MIME 但扩展名对得上 ⇒ 放行（部分安卓相册就这样）', () => {
    expect(checkPickedImage(makeFile('photo.JPG', ''))).toBeNull()
    expect(checkPickedImage(makeFile('photo.webp', ''))).toBeNull()
  })

  it('没有 MIME 且扩展名也不对 ⇒ 用文件名那句说法', () => {
    const out = checkPickedImage(makeFile('scan.heic', ''), '这张照片')
    expect(out).toContain('文件名「scan.heic」')
    expect(out).toContain('只能是 JPG / PNG / WebP')
  })

  it('超过 10MB ⇒ 说出实际 MB 数并让人压缩', () => {
    const big = makeFile('a.jpg', 'image/jpeg', UPLOAD_MAX_BYTES + 1)
    const out = checkPickedImage(big, '图片')
    expect(out).toContain('10.0 MB')
    expect(out).toContain('超过 10 MB 上限')
  })

  it('刚好 10MB 不算超（判据是 >，不是 >=）', () => {
    expect(checkPickedImage(makeFile('a.jpg', 'image/jpeg', UPLOAD_MAX_BYTES))).toBeNull()
  })

  it('0 字节的空文件 ⇒ 单独那句"换一张再试"', () => {
    const out = checkPickedImage(new File([], 'a.jpg', { type: 'image/jpeg' }))
    expect(out).toContain('0 字节的空文件')
  })

  it('不传 label 时用默认称呼「图片」', () => {
    expect(checkPickedImage(makeFile('a.gif', 'image/gif'))).toContain('图片只能是')
  })
})

describe('这份词表自身不许漂（与后端 upload.js 的逐字对账在 backend/test/frontendConstantsParity.test.js）', () => {
  it('放行的扩展名就是后端那四种，多一个少一个都算漂', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      expect(checkPickedImage(makeFile(`x.${ext}`, '')), `${ext} 应当放行`).toBeNull()
    }
  })

  it('词表外的格式一律被挡（防"前端全放行"这种漂法）', () => {
    for (const ext of ['gif', 'heic', 'tiff', 'bmp', 'svg']) {
      expect(checkPickedImage(makeFile(`x.${ext}`, '')), `${ext} 应当被挡`).toContain('只能是')
    }
  })

  it('accept 串只列 image/*，且与上面放行的三种 MIME 同一组', () => {
    const mimes = UPLOAD_ACCEPT.split(',').map((s) => s.trim())
    expect(mimes).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('上限就是 10×1024×1024 那个字节数（写成 1000 进制会少 7%）', () => {
    expect(UPLOAD_MAX_BYTES).toBe(10485760)
  })
})

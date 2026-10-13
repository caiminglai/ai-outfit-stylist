/**
 * 选图时的本机预检：格式 + 体积
 *
 * 判据照抄后端 middleware/upload.js，两处必须同一把尺（那边改了这里也要改）：
 * · 认 jpg / jpeg / png / webp 四种扩展名，还要过 magic bytes
 * · multer memoryStorage 限 10MB（整份读进内存，两条图片字段各算一份）
 *
 * 为什么要挡在前端：`accept="image/*"` 会让相册里的 gif / heic / tiff 一样能选中，
 * 手机原片又常常 8~20MB——传上去才知道不行，用户白等一趟网络（试穿接口还吃每分钟 5 次的
 * 限流额度，一次废请求就占掉一格）。
 */

/** 给 <input type="file"> 的 accept 值，和 UPLOAD_ALLOWED_TYPES 同一组词 */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp'

/** 与后端 multer limits.fileSize 同值 */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024

const OK_EXT_RE = /\.(jpe?g|png|webp)$/i

/**
 * @param file 用户刚选中的文件
 * @param label 出错话术里对这个文件的称呼（「人物照片」/「这张照片」…）
 * @returns null 表示可以传；字符串是要直接显示给用户的原因
 */
export function checkPickedImage(file: File, label = '图片'): string | null {
  const type = (file.type || '').toLowerCase()
  const typeOk = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp'
  // 部分安卓浏览器/相册导出给的 File 不带 MIME，这种只看扩展名，别一票否决
  const fallbackOk = type === '' && OK_EXT_RE.test(file.name)
  if (!typeOk && !fallbackOk) {
    const got = type ? `类型 ${type}` : `文件名「${file.name}」`
    return `${label}只能是 JPG / PNG / WebP（当前是${got}）`
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return `${label}有 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 10 MB 上限，请压缩后再传`
  }
  if (file.size === 0) {
    return `${label}是 0 字节的空文件，换一张再试`
  }
  return null
}

// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。

// ============ 3D模型查看器 ============
export function ModelViewer({
  iframeRef,
  onLoad,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onLoad?: () => void
}) {
  return (
    <iframe
      ref={iframeRef}
      src="/gallery"
      className="w-full h-full"
      title="3D模型展厅"
      allow="camera; microphone"
      onLoad={onLoad}
    />
  )
}

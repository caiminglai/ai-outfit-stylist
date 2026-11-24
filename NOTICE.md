# 第三方组件与数据许可说明

本项目自行编写的代码按根目录 `LICENSE` 中的 MIT 许可发布。该许可不覆盖第三方文件、依赖或数据；它们保留各自的许可与来源声明。以下为集中索引，不替代随附的上游许可原文。

| 项目 | 来源与仓库内位置 | 许可与保留说明 |
| --- | --- | --- |
| Three.js r160 | npm `three@0.160.0`；本地文件位于 `app/public/three/` | MIT，Copyright © 2010-2023 three.js authors；许可全文见下文。 |
| qrcode.js（QR Code Generator for JavaScript） | `app/public/qrcode.js`，文件头保留原项目地址与许可声明 | MIT，Copyright (c) 2009 Kazuhiko Arase；许可全文见下文。 |
| MakeHuman 测量与体型 JSON 数据 | `backend/vendor/makehuman/measurement_sliders.json`、`backend/vendor/makehuman/bodyshapes_sliders.json`；来自 [makehumancommunity/makehuman](https://github.com/makehumancommunity/makehuman) 固定 commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` 的 `data/modifiers/` | 两份数据按上游 bundled assets 声明登记为 CC0 1.0 Universal；上游许可声明、文件校验与来源见同目录 `LICENSE.md`、`PROVENANCE.md`，CC0 官方文本见 <https://creativecommons.org/publicdomain/zero/1.0/>。 |
| lunar-javascript 1.7.7 | [6tail/lunar-javascript](https://github.com/6tail/lunar-javascript)；本地文件位于 `backend/vendor/lunar/` | 按上游原 MIT 许可保留，Copyright (c) 2018 6tail；原始 `LICENSE` 与 `NOTICE.txt` 均保留在该目录。 |
| PortfolioBot 演示模型 | `models/demo/PortfolioBot.pmx`，由 `scripts/generate-demo-model.cjs` 生成的项目原创几何体 | CC0 1.0 Universal；具体声明与 CC0 说明见 `models/demo/LICENSE.md`。 |
| 展厅模型预览 WebP（28 个） | `app/public/model-previews/`；按现有展示需要原样保留 | 本轮未取得可核验的上游作者与再分发许可，因此不纳入 MIT 授权，也不声明为 CC0。保留这些文件不等于授予第三方再分发权；公开分发前应替换为已授权预览或取得权利人许可。 |

其他 npm 依赖也按各自原许可使用，不因本项目代码采用 MIT 而改变。

## Three.js r160 的 MIT 许可全文

```text
The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## qrcode.js 的 MIT 许可全文

```text
The MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

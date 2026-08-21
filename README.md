# EasyTranslator · 中英法交流助手

面向非洲法语国家传染病防治官员研修班的手机优先口译网页工具。它将一次交流拆成可核对、可编辑、可追溯的发言：录音或输入原文、识别中/法/英语、生成另外两种语言，并可按需播放发音。

> 对话仅存于当前浏览器；API Key 只在页面会话内使用，不会写入浏览器存储、导出文件或 Git 仓库。

## 功能

- 中、法、英三语的语音转写、语言识别、翻译和语音播放
- 约每 4 秒提交一次录音片段，逐段追加转写预览
- 可编辑原文或译文；改写原文后会标记旧译文并支持重新翻译
- 本地 IndexedDB 对话保存、逐句导航、对话备份与恢复
- Markdown、JSON、Word 与 PDF 导出，可导出原文或统一指定语言
- 本地请求、tokens、音频时长与费用估算；价目表可在本次会话调整
- 中文、法语、英语界面，深色模式，以及手机友好的布局

## 快速开始

需要 Node.js 22 或更新版本。

```bash
npm install
npm run dev
```

打开页面后：

1. 阅读首次使用说明。
2. 在右上角 **设置** 中填写兼容 OpenAI 的 Base URL 与 API Key。
3. 使用“测试 API”确认翻译接口可用。
4. 新建对话，录音或输入一句话，选择来源语言（或保留“待确认”），点击“识别并翻译”。

默认配置为 CloseAI 的 OpenAI 兼容地址：`https://api.openai-proxy.org/v1`。服务必须同时支持浏览器 CORS、`/audio/transcriptions`、`/responses` 和 `/audio/speech`；第三方服务的可用性与账单以其自身规则为准。

## 隐私与现场使用

- 请勿输入不必要的患者姓名、病例号或其他可识别健康信息。
- 音频只在调用转写期间存在于浏览器内存，不会保存为文件。
- API Key 不会被保存，刷新或关闭页面后即清除。
- 本地费用为估算值，不等同于 API 服务商的最终账单。
- 导出的 JSON 不含 API Key 或音频；导入时仅恢复对话、译文和用量记录。

完整操作说明见 [用户指南](docs/user-guide.md)，设计、数据与 API 约定见 [实现方案](docs/implementation-spec.md)。

## 质量检查

```bash
npm run typecheck
npm run lint
npm run build
```

`npm run build` 会将 GitHub Pages 所需的纯静态文件生成到 `out/`。

## 部署到 GitHub Pages

仓库内已提供 [GitHub Actions 工作流](.github/workflows/deploy-pages.yml)。首次部署时，在仓库 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**；此后推送到 `main` 将自动构建并发布。

详细操作及常见问题见 [部署说明](docs/deployment.md)。

## 技术栈

Next.js（静态导出） · TypeScript · IndexedDB · MediaRecorder · OpenAI-compatible API

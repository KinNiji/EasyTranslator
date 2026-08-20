# GitHub Pages 部署说明

## 首次配置

1. 将本项目推送到 GitHub 仓库的 `main` 分支。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **GitHub Actions**。
4. 等待 `Deploy GitHub Pages` 工作流完成；部署地址会显示在工作流摘要和 Pages 设置中。

工作流使用 Node.js 22 执行 `npm ci` 与 `npm run build`，然后发布 `out/` 静态目录。项目不依赖服务端 API Route，适合 GitHub Pages。

## 发布后检查

- 首次访问会显示 3 秒使用说明；确认后再使用功能。
- 在设置中手动填写 API Key，刷新页面后确认 Key 已被清除。
- 测试录音、文字翻译、语音播放、JSON 备份导入与 Word/PDF 导出。
- 在手机浏览器检查长对话 PDF 的分页效果。

## 常见问题

### 网页能打开，但 API 请求失败

GitHub Pages 只能运行浏览器端代码，无法绕过 API 的跨域限制。请确认服务商允许 GitHub Pages 域名的 CORS 请求，并且其 OpenAI 兼容接口支持本项目调用的端点。

### 工作流无法部署

确认 Pages 的发布源已设置为 GitHub Actions，并查看 Actions 中 `Deploy GitHub Pages` 的失败日志。仓库默认分支必须为 `main`，或相应调整工作流的触发分支。

### 本地记录消失

记录只存放在当前浏览器的 IndexedDB。无痕模式、清理网站数据、更换浏览器或设备都会导致记录不可见；使用 JSON 导出作为备份。

# EasyTranslator

面向中、英、法交流场景的手机优先网页工具。对话只保存于当前浏览器；API Key 只存在于当前页面会话内。

## 本地运行

```bash
npm install
npm run dev
```

执行 `npm run build` 会生成可部署到 GitHub Pages 的静态文件至 `out/`。

## 部署 GitHub Pages

将仓库推送到 GitHub 后，在仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。`main` 分支的推送会触发 `.github/workflows/deploy-pages.yml`。

完整设计与分期计划见 [implementation-spec](docs/implementation-spec.md)。

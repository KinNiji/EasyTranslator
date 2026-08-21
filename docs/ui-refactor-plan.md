# EasyTranslator UI 组件化重构计划

**状态：** 待实施
**范围：** 仅重构界面组件、样式体系与交互可访问性；不改变 CloseAI 调用、浏览器本地存储、录音分段、翻译、TTS、导入导出或 GitHub Pages 静态部署策略。

## 1. 决策

采用 **shadcn/ui + Tailwind CSS + Lucide React**，不采用 MUI、Ant Design，也不在本阶段引入 AI Elements / Vercel AI SDK。

| 方案 | 决定 | 原因 |
| --- | --- | --- |
| shadcn/ui | 采用 | 组件以源码形式加入本仓库，可按既有蓝色主题与移动交互修改；`Input Group`、`Sheet`、`Dialog`、`Select` 和 `Tooltip` 直接覆盖当前主要 UI。 |
| Tailwind CSS | 采用 | shadcn/ui 的组件源码基于 Tailwind；用于统一间距、断点、状态与深浅主题，逐步替代页面中大量重复的手写布局规则。 |
| Lucide React | 采用 | 提供一致、可访问、可调尺寸的菜单、麦克风、编辑、信息、导出、删除、设置等图标，取代文字符号。 |
| AI Elements / AI SDK | 暂不采用 | 本项目是“录音 → STT → 翻译 → TTS”的逐句工具，不使用服务端模型聊天流。引入 AI SDK 会增加无关依赖与 GitHub Pages 静态部署复杂度。若以后增加流式模型对话，再独立评估。 |
| MUI / Ant Design | 不采用 | 对当前单页工具体积和默认视觉侵入过大，且会与既有轻量、移动优先的设计目标冲突。 |

shadcn 的 Input Group 支持 `InputGroupTextarea`、尾部 Addon 与按钮；官方建议将 Addon 写在输入控件之后，保证焦点导航正确。详见 [Input Group 文档](https://ui.shadcn.com/docs/components/input-group)。现有 Next.js 工程可按 shadcn 的[已有项目安装流程](https://ui.shadcn.com/docs/installation/next)初始化。

## 2. 目标体验

- 手机：聊天区自动全屏；底部输入区为满宽文本框和整行按住录音按钮；对话历史为 Sheet 抽屉。
- 桌面：文本框与右侧圆形麦克风按钮同一行；聊天区可进入沉浸模式。
- 所有图标有文字 `aria-label`、悬停 Tooltip 和可见键盘焦点；不会只依靠颜色传达录音、处理中或错误状态。
- 保留现有浅色 / 深色模式、中文 / 法语 / 英语界面，以及国旗语言识别方式。

## 3. 组件映射

| 当前区域 | 目标组件 | 说明 |
| --- | --- | --- |
| 顶部工具栏 | `Button`、`Tooltip`、`Select` | Lucide `Menu`、`Sun/Moon`、`Maximize`、`CircleHelp`、`Settings`；语言选择使用可访问的 Select。 |
| 历史记录 | `Sheet` + `ScrollArea` | 左侧抽屉、遮罩、焦点捕获与内部滚动统一由组件处理。 |
| 发言卡 | `Card`、`Badge`、`Button` | 来源语、三语翻译、播放、编辑状态使用一致的卡片层级。 |
| 桌面输入区 | `InputGroup` + `InputGroupTextarea` + `InputGroupAddon` | 右侧使用 `Mic` 圆形按钮；沿用现有 Pointer 录音事件。 |
| 移动录音区 | `Button` | 整行大按钮；按住 / 松开语义保持不变。 |
| 导出 / 详情 / 设置 / 重命名 | `Dialog` + `Select` + `Field` | 统一标题、关闭按钮、可滚动内容和底部操作栏。 |
| API 状态与提示 | `Toast` / `Sonner` | 统一成功、额度、网络、权限和导出反馈；保留自动关闭机制。 |
| 空状态与加载 | `Empty`（或本地轻量组件）+ `Skeleton` | 避免页面加载时布局跳动。 |

## 4. 实施步骤

### P0：建立组件基础设施

1. 在独立分支安装 Tailwind CSS，保留现有 `:root` 蓝色、深蓝、红色设计 Token，并映射为 shadcn 主题 CSS 变量。
2. 初始化 `components.json`；安装 `lucide-react`、shadcn 所需的轻量 class 工具与生成组件依赖。
3. 先加入 `button`、`tooltip`、`dialog`、`sheet`、`select`、`textarea`、`input-group`、`scroll-area`、`badge`、`card`、`separator`、`skeleton` 和 toast 组件；仅加入实际使用的组件。
4. 增加 `src/lib/utils.ts` 的 `cn()`，并规定 `src/components/ui/` 只放 shadcn 可维护源码，业务组件放入 `src/components/translator/`。

### P1：输入与录音区（首个可验收切片）

1. 提取 `TranscriptComposer`：接收文本、编辑回调、录音状态、处理状态和 Pointer 事件回调。
2. 桌面断点以 `InputGroupTextarea + InputGroupAddon` 实现右侧 `Mic`；移动断点切换为整行 `Mic` 按住按钮。
3. 保持目前的自动识别与翻译队列，不改动 `MediaRecorder`、分段大小或 API client。
4. 验收：390px、768px、1280px 下文本框无溢出；按住、松开、取消、离开按钮与禁用状态的行为不变。

### P2：导航、发言流与对话操作

1. 将顶栏、历史抽屉、发言卡、标题工具条拆为 `AppHeader`、`ConversationSheet`、`UtteranceCard`、`ConversationActions`。
2. 用 Lucide 替换 `☰`、`✎`、`ⓘ`、`⇧`、`⌫`、`▷` 等文本符号；所有按钮保留标题与屏幕阅读器标签。
3. 用 `Sheet` 替换自定义抽屉，用 `ScrollArea` 管理长对话与长历史记录；不再由页面手写锁定滚动。
4. 验收：手机历史记录可独立滚动和关闭；切换发言、TTS、编辑译文、重命名和删除均不丢失 IndexedDB 数据。

### P3：表单与二级弹层

1. 导出、详情、设置、重命名统一迁移到 `Dialog`，内容区允许滚动、背景锁定、Escape 可关闭。
2. API 设置表单使用 `Field` / `Label` / `Input`，保持 API Key 仅在会话内存中存在。
3. 费用明细用卡片和语义化列表展示；JSON/Word/PDF/Markdown 导出逻辑维持原样。
4. 验收：在 390px 高度较短设备上，设置和详情可滚动到末尾并关闭；无背景滚动穿透。

### P4：清理、测试与发布

1. 按组件迁移完成情况删除重复的全局 CSS；保留仅用于全局 token、页面壳、动画和第三方导出打印的少量规则。
2. 加入组件级测试：录音按钮状态、语言选择、Dialog/Sheet 可访问性、重命名和导出配置。
3. 运行 `npm run typecheck`、`npm run lint`、`npm run build`；用 390px、768px、1280px 浏览器视图验证主要流程。
4. 验证 GitHub Pages 的 `NEXT_PUBLIC_BASE_PATH` 下所有静态图片与路由仍正确；提交前检查不包含 API Key 或音频文件。

## 5. 文件组织（目标）

```text
src/
├─ components/
│  ├─ ui/                         # shadcn 源码，按 CLI 生成后本地维护
│  └─ translator/
│     ├─ app-header.tsx
│     ├─ conversation-sheet.tsx
│     ├─ transcript-composer.tsx
│     ├─ utterance-card.tsx
│     ├─ conversation-details-dialog.tsx
│     └─ settings-dialog.tsx
├─ lib/
│  ├─ api-client.ts               # 保持既有业务与安全边界
│  ├─ conversation-db.ts
│  └─ utils.ts
└─ app/
   ├─ page.tsx                    # 只组装状态与业务组件
   └─ globals.css                 # 主题 Token、基础样式和极少量全局规则
```

## 6. 风险与控制

- **Tailwind 迁移影响现有样式：** 先建立 Token 映射，再按 P1–P3 分片替换；每片均可回退，不进行一次性重写。
- **组件生成时覆盖文件：** shadcn 组件生成前检查目录；对生成源码的改动以小提交记录，后续升级人工合并。
- **静态部署兼容性：** 不引入 server action、API route、服务端密钥或 AI SDK 流式后端；继续保持 `output: 'export'`。
- **录音交互回归：** 所有 UI 组件只接收事件回调，录音队列仍留在页面状态/业务 hook 中；特别测试移动端 Pointer Cancel 和权限拒绝。
- **组件数量失控：** 只添加上表列出的组件；没有明确交互收益的组件不纳入。

## 7. 完成定义

1. 现有关键路径（新建、录音、转写、自动翻译、TTS、编辑、导出、导入、删除、设置、帮助）均可运行。
2. 手机上输入区与录音按钮满宽，桌面端输入区和圆形麦克风按钮同列。
3. 键盘可访问，Dialog/Sheet 具有正确焦点管理；移动端无页面滚动穿透。
4. 深色、三种界面语言、品牌资源和 GitHub Pages 路径均正确。
5. `typecheck`、`lint`、静态生产构建通过，且不增加 API Key、本地对话或音频的持久化范围。

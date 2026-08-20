# EasyTranslator：中英法三语研修班口译工具实现方案

**版本：** 0.1（MVP 设计稿）  
**目标用户：** 使用中文或英语的带班人员，与主要使用法语的研修班学员进行面对面沟通。  
**目标平台：** 手机优先的网页应用，可作为 GitHub Pages 静态站点部署；Chrome / Edge / Safari 的较新移动版。

## 1. 产品定位与边界

本工具是“按句轮流”的辅助口译，而不是无间断的会议同传。一次发言的流程为：录音或手动录入原文 → 语音转文字（STT）→ 自动识别中、英、法语言 → 生成另两种语言的文本 → 按需播放任一文本的语音（TTS）。

这样设计可在网络条件一般、多人轮流发言、需要核对文本的培训现场稳定使用，也能让用户修订识别或翻译错误后重新翻译。首版不处理实时双向流式音频、多人自动分离声纹、离线识别或账户/云端协作；录音中提供约 4 秒一段的转写预览。

### 核心约束

- 应用以 GitHub Pages 静态托管为目标，不设置后端，不上传或持久保存录音。
- API Key 仅由用户在设备上输入并在浏览器会话内使用；绝不写入 `localStorage`、IndexedDB、导出文件、日志或 Git 仓库，刷新或关闭页面即清除。
- 对话文本和用量明细保存于该浏览器的 IndexedDB，用户可随时删除或导出。
- 用户可填 OpenAI 或兼容 OpenAI 的 `Base URL` 与 API Key；但第三方服务能否使用取决于它是否实现所需端点且允许该网页来源的 CORS 请求。
- 用于传染病防治的谈话可能包含敏感个人或健康信息。界面须在首次使用时提示：避免输入姓名、病例号等不必要的可识别信息；由用户确认其机构的数据合规要求。

## 2. 成功标准（MVP）

1. 在手机上能建立、续接、浏览和删除本地对话。
2. 在 4G/Wi-Fi 下，一条短发言能完成录音、转写、双语翻译和三语文本展示。
3. 每个三语文本均可单独请求并播放语音；音频播放完毕或切换内容后释放内存 URL，不落盘。
4. 出现无效 Key、网络问题、限流、余额/额度不足、模型不支持等问题时，有可理解且可操作的中文提示。
5. 每次 API 调用、每段发言和整场对话均能看到 tokens / 音频时长 / 计费估算及其准确性状态。
6. 可导出原文记录，或导出统一指定语言的完整对话，导出内容含发言者所用语言与时间。

## 3. 推荐 API 与模型

### 3.1 默认工作流（首选）

| 环节 | 调用方式 | 默认模型 | 选择理由 |
| --- | --- | --- | --- |
| 录音 | 浏览器 `MediaRecorder` | 不适用 | 保持麦克风会话，每约 4 秒生成一个内存 `webm/opus` 片段并提交转写，结果追加到预览；不保存音频。 |
| STT | `POST /v1/audio/transcriptions` | `gpt-4o-mini-transcribe` | 专用语音识别模型；官方说明相较 Whisper 有更好的语言识别与准确性，且公开估算约 $0.003/分钟。 |
| 识别语言 + 翻译 | `POST /v1/responses`（Structured Outputs） | `gpt-4o-mini` | 对短文本翻译足够快、低成本，支持结构化输出；输出固定为来源语言和 `zh`、`en`、`fr` 三个字段，便于可靠渲染。 |
| TTS | `POST /v1/audio/speech` | `gpt-4o-mini-tts` | 可按语言文本生成自然语音，并支持声音风格指令。首次 MVP 用固定、清晰的声音与语速。 |

`gpt-4o-mini-transcribe`、`gpt-4o-mini-tts` 与 `gpt-4o-mini` 均有专用、低延迟/低成本定位；翻译请求应设置很低输出长度与不使用推理。实际可用模型须以“测试 API”结果和供应商返回的模型列表为准。

模型和价格均应作为可更新的本地“价目表”，而不是写死在业务逻辑中。OpenAI 当前公开价格中，`gpt-4o-mini-transcribe` 的估算为 $0.003/分钟；`gpt-4o-mini` 为输入 $0.15 / 1M tokens、输出 $0.60 / 1M tokens；`gpt-4o-mini-tts` 为输入 $0.60 / 1M text tokens、输出 $12 / 1M audio tokens。价格会变化，设置页要显示价目表的更新时间并允许用户编辑单价。

相关官方资料：[模型总览](https://developers.openai.com/api/docs/models/models-overview)、[GPT-4o mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe)、[GPT-4o mini TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)、[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)、[OpenAI 价格表](https://platform.openai.com/pricing)。

### 3.2 为什么不在 MVP 中直接用“实时同传”模型

OpenAI 目前也列出实时翻译/语音模型。它适合以后做连续、低延迟的流式语音模式，但需要 WebRTC / WebSocket 会话、打断处理、流量控制和更复杂的费用呈现。当前需求强调逐句留档、可编辑重译、逐句前后切换和详细用量，拆分为 STT → 文本翻译 → TTS 可控性更好。

当前版本已经实现“分段实时预览”：在服务端未验证 Realtime 会话的前提下，每约 4 秒调用一次文件转写接口并追加文本。这不是 WebSocket/WebRTC 的 token 级实时字幕，可能有片段边界误识别及额外请求费用；不得将预览直接覆盖已确认的发言。真正的低延迟增量转写需要 Realtime 模型与实时会话（参见 [GPT-Realtime-Whisper](https://developers.openai.com/api/docs/models/gpt-realtime-whisper)）；待中转服务明确支持后再增加该模式。

### 3.3 API 兼容性说明

应用只承诺 OpenAI 的以下 HTTP 契约：

- `GET /v1/models`：连通性与模型列表测试；
- `POST /v1/audio/transcriptions`：multipart 音频转写；
- `POST /v1/responses`：文本翻译与结构化 JSON；
- `POST /v1/audio/speech`：返回音频二进制。

一些“OpenAI 兼容”服务只兼容聊天接口，未实现音频接口或未返回 `usage`。测试页必须逐项探测，显示“可用 / 不支持 / CORS 被拦截 / 认证失败”，而非笼统地显示连接成功。

### 3.4 CloseAI 当前接入配置与验证结果

CloseAI 的 OpenAI 兼容文档要求 Base URL 使用 `https://api.openai-proxy.org/v1`，`/v1` 不可省略。该服务说明不支持 `file`、fine-tune、assistants 等有状态接口；本应用的逐句 STT、无状态 Responses 翻译和 TTS 不依赖这些接口。

在 2026-08-20 的最小付费测试中，以下接口均已返回成功：`/v1/chat/completions`（含 tokens）、`/v1/responses`、Responses JSON Schema Structured Outputs、`/v1/audio/speech`（MP3）以及 `/v1/audio/transcriptions`。模型列表未列出音频模型，因此应用不得仅以模型列表决定音频功能是否可用，必须在“测试 API”时实际探测各能力。

参考：[CloseAI OpenAI 兼容接口说明](https://doc.closeai-asia.com/tutorial/api/openai.html)。

## 4. 架构

```text
手机浏览器（Next.js 静态导出）
├─ 设置：Base URL、会话内 API Key、模型与本地价目表
├─ 对话 UI / 状态管理
├─ IndexedDB：对话、发言、用量明细、用户偏好
├─ MediaRecorder：音频 Blob（仅内存）
└─ API Client ── HTTPS + Authorization Bearer ──> 用户指定的 API 服务
      ├─ transcription
      ├─ responses（语言识别与翻译）
      └─ speech（按需返回音频 Blob）
```

建议使用 Next.js App Router + TypeScript，并配置 `output: 'export'` 生成静态文件。因为 GitHub Pages 没有安全的运行时密钥存储，**不得**实现 Next.js API Route 作为“隐藏密钥”的伪后端；将 Key 编译到环境变量也同样不安全。

建议库：

- UI：Tailwind CSS、shadcn/ui 的可复制组件、Lucide 图标；
- 客户端状态：Zustand；
- 本地数据库：Dexie（IndexedDB）；
- schema / 表单：Zod + React Hook Form；
- 测试：Vitest + React Testing Library，浏览器流程用 Playwright；
- 导出：浏览器 `Blob` / `URL.createObjectURL`，不引入服务器端生成依赖。

## 5. 用户流程与界面

### 5.1 首次设置和 API 测试

设置抽屉包含：`Base URL`、`API Key`、STT/翻译/TTS 模型、语音、语速、可编辑价目表，以及“仅本次会话保存 Key”的说明。Key 输入框默认密码遮罩，可显示/清空。

点击“测试 API”后按顺序执行：规范化 URL → `GET /v1/models` → 小文本翻译测试 → 小段内置音频转写测试（可跳过，避免额外费用）→ 短文本 TTS 测试（可跳过）。结果逐项呈现，失败项目提供 HTTP 状态、请求 ID（若响应头存在）与不含密钥的诊断信息。

不得把“模型列表能读到”误认为全部功能可用；功能按钮根据测试能力和最终请求返回动态禁用或提示。

### 5.2 对话与发言

- 首页显示最近对话、新建对话、导入/导出、总计费用；对话可重命名、复制、删除。
- 新建对话创建第一条空发言，并将该发言展开。手机上以单列卡片呈现；桌面可在左侧显示发言列表。
- 当前发言卡含：发言者（可选“我 / 学员 / 自定义”）、分段录音与转写预览、文本输入区、识别语言徽标、翻译状态、三个语言区和每个语言区的播放按钮。
- 发言完成后点击“确认并翻译”；若来源是录音，先完成 STT。用户也可直接输入文本，避免录音失败时无法使用。
- “上一句 / 下一句”仅切换已经创建的发言。下一条空发言只能在当前发言已有**确认的来源文本**后新建；若空白则禁用并提示“请先录入或确认本句内容”。
- 识别/翻译进行中禁用重复提交；可以取消当前请求（`AbortController`），但已发出的 API 费用仍可能产生。
- 改写来源文本后，清除过时的两个翻译，标为“待重新翻译”；确认后只重新走翻译步骤，不再重跑 STT。
- 对单个译文允许手动修订；它标记为“人工修改”，除非用户明确“重新翻译”，否则不得覆盖。

### 5.3 三语呈现约定

固定顺序为中文、法语、英语（设置可切换为中文、英语、法语），每块标题明确显示“原文”或“译文”。来源语言只使用 `zh`、`en`、`fr`；无法可靠判断时标为“待确认”，让用户点选后再翻译。

翻译提示词须要求保留数字、日期、专名、药名、缩写、否定词和不确定性；使用简明、礼貌、适合口头交流的语言；对疑似术语歧义保留原术语并附短注，而不是擅自编造。MVP 可允许在设置中输入一份“研修班术语表”（疾病名、机构名、药物、地名），随翻译请求传递。

## 6. 翻译接口契约

翻译请求只发送当前句的确认原文与可选术语表，避免把整段历史重复发送、增加延迟和成本。使用 JSON Schema / Structured Outputs，逻辑结果为：

```json
{
  "sourceLanguage": "fr",
  "sourceTextNormalized": "...",
  "translations": {
    "zh": "...",
    "en": "...",
    "fr": "..."
  },
  "notes": []
}
```

客户端验证返回 schema。来源文本字段必须保留用户确认的原文（最多只展示模型的规范化建议，不能静默替换）；来源语言对应的 `translations` 内容必须回填为确认原文，以避免“原文被重新翻译”。解析失败时显示可复制的原始响应摘要，并允许用户以手动语言选择再次提交。

## 7. 本地数据模型

建议 IndexedDB 版本化 schema：

```ts
type Lang = 'zh' | 'en' | 'fr' | 'und';

type Conversation = {
  id: string; title: string; createdAt: string; updatedAt: string;
  version: 1; settingsSnapshot: ModelSettingsPublic; totalCostUsd: number;
};
type Utterance = {
  id: string; conversationId: string; sequence: number;
  speakerLabel?: string; createdAt: string; updatedAt: string;
  source: { text: string; language: Lang; inputMode: 'voice' | 'typed'; confirmedAt?: string };
  translations: Record<'zh' | 'en' | 'fr', { text: string; status: 'generated' | 'edited' | 'stale' | 'empty'; }>;
  stt?: { model: string; audioDurationMs: number; status: RequestStatus };
  translation?: { model: string; glossaryVersion?: string; status: RequestStatus };
};
type UsageEvent = {
  id: string; conversationId: string; utteranceId?: string; createdAt: string;
  operation: 'stt' | 'translation' | 'tts' | 'test'; model: string;
  inputTokens?: number; outputTokens?: number; audioDurationMs?: number; characters?: number;
  costUsd?: number; costKind: 'api-reported' | 'calculated' | 'estimated' | 'unavailable';
  httpStatus?: number; requestId?: string; outcome: 'success' | 'cancelled' | 'failed'; errorCode?: string;
};
```

`ModelSettingsPublic` 只能保存 Base URL、模型名、声音、速度和价目表，**没有** API Key。数据库升级必须保留旧对话并有导出兜底。

## 8. 用量、token 与费用

### 8.1 展示规则

- **每次请求：** 操作、模型、时间、输入/输出 tokens、音频秒数或字符数、美元估算、状态、HTTP 请求 ID。
- **每条发言：** 聚合 STT + 翻译 + 已播放的 TTS 请求；不会把未点击的播放按钮计入。
- **整段对话：** 累加所有成功和可能已计费的取消/失败请求，按操作和模型分组。
- **导出：** 可选附带完整 `usage.json`；默认文本导出不含 Key 和技术诊断信息。

### 8.2 计费准确性

文本翻译响应若带 `usage`，可用 `input_tokens × 输入单价 + output_tokens × 输出单价` 计算，标为“计算值”。STT 可按实际录音毫秒与公开的每分钟估价计算；TTS 因常返回音频二进制而未必带完整 usage，首版按输入字符/令牌与价目表换算，明确标为“估算值”。如果兼容 API 不返回 usage 或采用不同账单单位，则显示“无法精确核算”，但仍保留请求次数与可观测的长度。

网页不应调用组织级 Usage/Billing API：这类接口通常需要更高权限，且用户输入的常规项目 Key 未必有权访问。应用的统计是本地估算，不等同于供应商账单，设置页和导出文件均须标注这一点。

## 9. 错误处理与恢复

| 情况 | 识别方式 | 面向用户的提示与操作 |
| --- | --- | --- |
| Key 无效 | 401 | “API Key 无效或已失效。请在设置中更新后重试。” |
| 权限/模型不可用 | 403、模型不存在 | 显示具体模型，提供跳转设置。 |
| 余额或额度不足 | 402、OpenAI `insufficient_quota` 等 | “额度不足，未能完成本次请求。请充值/更换 Key 后重试。”记录一次失败事件。 |
| 限流 | 429 | 显示可用的重试倒计时；只自动重试幂等的文本翻译，最多一次并支持取消。 |
| 网络/超时 | `fetch` 错误、超时 | 保留文本和录音尚未确认状态；允许重试，不自动重复 TTS。 |
| CORS | 浏览器网络错误且 URL 测试不可读 | “该服务未允许此网页直接访问，GitHub Pages 不能绕过此限制。”建议换支持 CORS 的兼容服务或后续部署受控代理。 |
| 录音权限 | `NotAllowedError` | 说明如何在浏览器站点权限中允许麦克风，并继续提供文字输入。 |
| 返回格式异常 | Zod 校验失败 | 不覆盖原文，提供重新翻译与“复制诊断”。 |

所有错误提示不得回显 API Key、完整 Authorization 头、音频内容或原始敏感文本。错误状态的可访问性使用 `aria-live="polite"`。

## 10. 导出格式

支持下载 UTF-8 `Markdown (.md)` 与 `JSON (.json)`，并在 P2 增加 Word（`.docx`）与 PDF（`.pdf`）导出：

- **原始语言导出：** 每条保留“发言者（法语发言）”/“发言者（中文发言）”等来源语言标签，输出该条确认原文；
- **指定语言导出：** 用户选择中文、法语或英语，每条输出对应译文，同时保留“原发言语言：法语”的审计标签；缺译文时可选择跳过、保留原文并标注，或调用批量重新翻译；
- **JSON 完整备份：** 对话、发言、翻译、模型快照与用量事件，可导入恢复；不包含 API Key、临时音频和 TTS 音频。
- **Word / PDF：** 使用同一份导出中间数据生成，包含标题、导出时间、句号、发言者与来源语言标签；PDF 需内嵌支持中法英的字体，并在移动浏览器上进行下载验证。

推荐 Markdown 格式：

```md
# 研修班交流记录：2026-08-20

## 1. 学员（原发言语言：法语）｜10:12
请问如何安排病例报告？

## 2. 带班老师（原发言语言：中文）｜10:13
请在当天结束前完成电子报告。
```

## 11. 工程目录建议

```text
src/
  app/                    # 首页、对话页、设置页
  components/             # 移动端 UI、录音器、语言卡片、用量抽屉
  features/
    api/                  # fetch 客户端、能力测试、错误标准化
    conversation/         # 状态、导航、编辑/重译流程
    audio/                # MediaRecorder、Audio 播放与资源释放
    export/               # Markdown / JSON 导入导出
    usage/                # 价目表、计算和聚合
  db/                     # Dexie schema 与 migration
  lib/                    # zod schema、语言/时间/金额工具
  types/
docs/
  implementation-spec.md
```

## 12. 分期实施与验收

### P0：可演示骨架

- 初始化 Next.js、TypeScript、静态导出、Git、GitHub Actions 和 GitHub Pages 预览。
- 完成响应式壳、对话 CRUD、IndexedDB 保存、发言导航、手动文本输入、原始语言 Markdown 导出。
- 完成设置页，但先用 mock API 驱动 UI。

**验收：** 刷新网页后本地对话仍在；空发言不能切到下一句；手机 360px 宽度不横向溢出。

### P1：真实 API 闭环

- 实现安全的浏览器端 API Client、逐项能力测试、STT、Structured Outputs 翻译、TTS 播放。
- 实现语言识别、术语表、编辑后重译、取消与标准化错误提示。

**验收：** 用 OpenAI Key 完成中文/英语/法语任一短句的录入、双语显示与任一语言播放；断网和无效 Key 不会丢失已输入文本。

### P2：成本、导出与可靠性

- 用量事件、价目表、发言/对话汇总、JSON 备份导入、指定语言导出，以及 Word/PDF 导出。
- 单元测试费用计算/状态机/schema；Playwright 覆盖关键移动流程；无障碍键盘与屏幕阅读器检查。

**验收：** 每次调用可追溯且不会重复统计；导出不含 Key；修改原文后旧译文不再被误标为最新。

### P3：现场打磨（可选）

- 安装式 PWA、术语表导入、真正的 Realtime 转写实验功能、受控后端代理部署选项。界面深色模式及中文/法语/英语 UI 已实现。

## 13. Git 与部署规范

- 使用 `main` 作为稳定分支；每个功能走短生命周期分支与 Pull Request。
- 提交信息采用 Conventional Commits，如 `feat(stt): add recorder transcription flow`。
- `.gitignore` 覆盖 `.env*`（保留 `.env.example`）、测试下载物、Playwright 录像及本地数据库导出。任何 Key 泄露须立即在供应商控制台撤销，而不是仅删除 Git 历史中的文件。
- GitHub Actions 在 PR 上执行 lint、typecheck、unit tests、build；仅 `main` 成功构建后部署静态 `out/` 到 GitHub Pages。
- GitHub Pages 的自定义域名配置可由 GitHub 仓库设置完成；全站必须 HTTPS，麦克风功能也要求安全上下文。

## 14. 开工前需确认的产品决定

以下决定不阻塞搭建 P0，但在接入真实服务前应确认：

1. 默认服务是否仅面向 OpenAI，还是必须优先兼容某个特定中转/国产 API？这决定 CORS 与模型映射策略。
2. 是否需要把 API Key 跨浏览器重启保存？建议默认“不保存”；若强烈需要，可另设带风险警示的“仅此设备保存”选项，不能伪称加密安全。
3. 学员的法语是否包含特定地区术语或本地语言混杂？若有，请准备疾病、机构、地名与药品的中法英术语表，能显著提升现场翻译稳定性。后续术语表可扩展至学员姓名、性别、国家、职称等人口学资料，但 P0/P1 暂不实现。

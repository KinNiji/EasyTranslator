import type { Language, UsageEvent } from '@/lib/types';

export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
  transcriptionModel: string;
  translationModel: string;
  ttsModel: string;
  voice: string;
};

type TokenUsage = { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export function normalizeBaseUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(url) ? url : `${url}/v1`;
}

function headers(config: ApiConfig, json = true): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function throwForFailure(response: Response): Promise<never> {
  let data: { error?: { message?: string; code?: string; type?: string } } | undefined;
  try { data = await response.json(); } catch { /* Ignore a non-JSON error body. */ }
  const code = data?.error?.code ?? data?.error?.type;
  const commonMessage = response.status === 401
    ? 'API Key 无效或已失效。'
    : response.status === 429
      ? '请求过于频繁或额度不足，请稍后重试并检查余额。'
      : response.status === 402 || code === 'insufficient_quota'
        ? '额度不足，未能完成本次请求。'
        : data?.error?.message ?? `请求失败（HTTP ${response.status}）。`;
  throw new ApiRequestError(commonMessage, response.status, code, response.headers.get('x-request-id') ?? undefined);
}

async function parseJson(response: Response): Promise<{ data: Record<string, unknown>; requestId?: string }> {
  if (!response.ok) await throwForFailure(response);
  try {
    return { data: await response.json() as Record<string, unknown>, requestId: response.headers.get('x-request-id') ?? undefined };
  } catch {
    throw new ApiRequestError('服务返回的数据格式无法识别。', response.status, undefined, response.headers.get('x-request-id') ?? undefined);
  }
}

function getTokenUsage(usage: unknown): { inputTokens?: number; outputTokens?: number } {
  const item = usage as TokenUsage | undefined;
  return {
    inputTokens: item?.input_tokens ?? item?.prompt_tokens,
    outputTokens: item?.output_tokens ?? item?.completion_tokens,
  };
}

function createUsage(
  partial: Omit<UsageEvent, 'id' | 'createdAt'>,
): UsageEvent {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...partial };
}

export async function testApi(config: ApiConfig): Promise<UsageEvent> {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/responses`, {
    method: 'POST', headers: headers(config),
    body: JSON.stringify({ model: config.translationModel, input: 'Reply only with: ok', max_output_tokens: 16 }),
  });
  const { data, requestId } = await parseJson(response);
  const tokens = getTokenUsage(data.usage);
  return createUsage({
    operation: 'test', model: config.translationModel, ...tokens,
    costUsd: calculateTextCost(tokens.inputTokens, tokens.outputTokens), costKind: 'calculated', requestId, outcome: 'success',
  });
}

export async function transcribeAudio(
  config: ApiConfig,
  audio: Blob,
  durationMs: number,
): Promise<{ text: string; usage: UsageEvent }> {
  const form = new FormData();
  form.append('model', config.transcriptionModel);
  form.append('file', audio, 'utterance.webm');
  form.append('prompt', 'The speaker may use Chinese, French, or English. Preserve public-health terms, numbers, names, and abbreviations exactly.');
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/audio/transcriptions`, {
    method: 'POST', headers: headers(config, false), body: form,
  });
  const { data, requestId } = await parseJson(response);
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) throw new ApiRequestError('未能从录音中识别出文字，请重试或直接输入。', response.status, undefined, requestId);
  const tokens = getTokenUsage(data.usage);
  return {
    text,
    usage: createUsage({
      operation: 'stt', model: config.transcriptionModel, ...tokens, audioDurationMs: durationMs,
      costUsd: durationMs / 60000 * 0.003, costKind: 'estimated', requestId, outcome: 'success',
    }),
  };
}

const translationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceLanguage', 'translations', 'notes'],
  properties: {
    sourceLanguage: { type: 'string', enum: ['zh', 'fr', 'en'] },
    translations: {
      type: 'object', additionalProperties: false, required: ['zh', 'fr', 'en'],
      properties: { zh: { type: 'string' }, fr: { type: 'string' }, en: { type: 'string' } },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

export async function translateText(
  config: ApiConfig,
  sourceText: string,
): Promise<{ sourceLanguage: Exclude<Language, 'und'>; translations: Record<Exclude<Language, 'und'>, string>; usage: UsageEvent }> {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/responses`, {
    method: 'POST', headers: headers(config),
    body: JSON.stringify({
      model: config.translationModel,
      instructions: 'You are a careful interpreter for a public-health training workshop. Identify whether the source is Chinese, French, or English. Return the confirmed source unchanged in its language field and translate it into the other two languages. Keep numbers, dates, medical terms, names, organizations, abbreviations, negation, and uncertainty faithful. Use concise, polite spoken language. Do not add explanations except short notes for genuine ambiguity.',
      input: sourceText,
      max_output_tokens: 800,
      text: { format: { type: 'json_schema', name: 'trilingual_translation', strict: true, schema: translationSchema } },
    }),
  });
  const { data, requestId } = await parseJson(response);
  const output = Array.isArray(data.output) ? data.output : [];
  const content = output.flatMap((item) => Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []);
  const jsonText = content.find((item) => (item as { type?: string }).type === 'output_text') as { text?: string } | undefined;
  if (!jsonText?.text) throw new ApiRequestError('翻译服务没有返回可解析的文本。', response.status, undefined, requestId);
  let translated: { sourceLanguage: Exclude<Language, 'und'>; translations: Record<Exclude<Language, 'und'>, string> };
  try { translated = JSON.parse(jsonText.text) as typeof translated; } catch { throw new ApiRequestError('翻译结果不是有效的结构化数据。', response.status, undefined, requestId); }
  if (!['zh', 'fr', 'en'].includes(translated.sourceLanguage) || !translated.translations?.zh || !translated.translations?.fr || !translated.translations?.en) {
    throw new ApiRequestError('翻译结果缺少必要的语言内容。', response.status, undefined, requestId);
  }
  const tokens = getTokenUsage(data.usage);
  return {
    ...translated,
    usage: createUsage({ operation: 'translation', model: config.translationModel, ...tokens, costUsd: calculateTextCost(tokens.inputTokens, tokens.outputTokens), costKind: 'calculated', requestId, outcome: 'success' }),
  };
}

export async function synthesizeSpeech(
  config: ApiConfig,
  text: string,
): Promise<{ audio: Blob; usage: UsageEvent }> {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/audio/speech`, {
    method: 'POST', headers: headers(config),
    body: JSON.stringify({ model: config.ttsModel, voice: config.voice, input: text, response_format: 'mp3', speed: 1 }),
  });
  if (!response.ok) await throwForFailure(response);
  const audio = await response.blob();
  if (!audio.size) throw new ApiRequestError('语音服务未返回音频。', response.status, undefined, response.headers.get('x-request-id') ?? undefined);
  return {
    audio,
    usage: createUsage({
      operation: 'tts', model: config.ttsModel, characters: text.length,
      costUsd: text.length * 0.000015, costKind: 'estimated', requestId: response.headers.get('x-request-id') ?? undefined, outcome: 'success',
    }),
  };
}

export function calculateTextCost(inputTokens?: number, outputTokens?: number): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) * 0.15 / 1_000_000 + (outputTokens ?? 0) * 0.60 / 1_000_000;
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return '请求已取消。';
  if (error instanceof TypeError) return '网络连接失败，或该 API 未允许网页跨域访问（CORS）。';
  return '发生了未知错误，请稍后重试。';
}

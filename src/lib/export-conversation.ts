import { createUtterance, languageSpeakerName, type Conversation, type Language, type Translation, type UsageEvent, type Utterance } from '@/lib/types';

export type ExportLanguage = Exclude<Language, 'und'> | 'source';

type ExportRow = {
  sequence: number;
  speakerLabel: string;
  sourceLanguage: Language;
  text: string;
  fallback: boolean;
};

function exportRows(conversation: Conversation, language: ExportLanguage): ExportRow[] {
  return conversation.utterances.map((utterance) => {
    const translated = language === 'source' ? '' : utterance.translations[language].text;
    return {
      sequence: utterance.sequence,
      speakerLabel: utterance.speakerLabel || '发言者',
      sourceLanguage: utterance.source.language,
      text: language === 'source' ? utterance.source.text : translated || utterance.source.text,
      fallback: language !== 'source' && !translated,
    };
  });
}

function exportedAt(): string {
  return new Date().toLocaleString('zh-CN');
}

export function toMarkdown(conversation: Conversation, language: ExportLanguage = 'source'): string {
  const content = exportRows(conversation, language).map((row) => {
    const fallback = row.fallback ? '\n\n> 未翻译，保留原文。' : '';
    return `## ${row.sequence}. ${row.speakerLabel}（${languageSpeakerName[row.sourceLanguage]}）\n\n${row.text || '（未录入）'}${fallback}`;
  });
  return `# ${conversation.title}\n\n导出时间：${exportedAt()}\n\n${content.join('\n\n')}`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(filename: string, text: string, type = 'text/markdown;charset=utf-8'): void {
  downloadBlob(filename, new Blob([text], { type }));
}

export async function downloadDocx(conversation: Conversation, language: ExportLanguage): Promise<void> {
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const rows = exportRows(conversation, language);
  const children = [
    new Paragraph({ text: conversation.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `导出时间：${exportedAt()}`, color: '666666', size: 20 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ text: '' }),
    ...rows.flatMap((row) => [
      new Paragraph({ text: `${row.sequence}. ${row.speakerLabel}（${languageSpeakerName[row.sourceLanguage]}）`, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ children: [new TextRun({ text: row.text || '（未录入）', font: 'Microsoft YaHei', size: 22 })] }),
      ...(row.fallback ? [new Paragraph({ children: [new TextRun({ text: '未翻译，保留原文。', italics: true, color: '666666', size: 18 })] })] : []),
    ]),
  ];
  const document = new Document({ sections: [{ properties: {}, children }] });
  downloadBlob(`${conversation.title}-${language}.docx`, await Packer.toBlob(document));
}

function makePdfElement(conversation: Conversation, language: ExportLanguage): HTMLDivElement {
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;left:-20000px;top:0;width:760px;padding:56px;background:#fff;color:#17212b;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;font-size:16px;line-height:1.7;box-sizing:border-box;z-index:-1;';
  const title = document.createElement('h1');
  title.textContent = conversation.title;
  title.style.cssText = 'margin:0;text-align:center;font-size:28px;line-height:1.35;';
  root.append(title);
  const time = document.createElement('p');
  time.textContent = `导出时间：${exportedAt()}`;
  time.style.cssText = 'margin:8px 0 32px;text-align:center;color:#64748b;font-size:13px;';
  root.append(time);
  for (const row of exportRows(conversation, language)) {
    const section = document.createElement('section');
    section.style.cssText = 'margin:0 0 26px;padding:0 0 18px;border-bottom:1px solid #d8e1e8;break-inside:avoid;';
    const heading = document.createElement('h2');
    heading.textContent = `${row.sequence}. ${row.speakerLabel}（${languageSpeakerName[row.sourceLanguage]}）`;
    heading.style.cssText = 'margin:0 0 8px;font-size:18px;line-height:1.45;color:#0f5d89;';
    const body = document.createElement('p');
    body.textContent = row.text || '（未录入）';
    body.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;';
    section.append(heading, body);
    if (row.fallback) {
      const fallback = document.createElement('p');
      fallback.textContent = '未翻译，保留原文。';
      fallback.style.cssText = 'margin:6px 0 0;color:#64748b;font-size:13px;font-style:italic;';
      section.append(fallback);
    }
    root.append(section);
  }
  return root;
}

export async function downloadPdf(conversation: Conversation, language: ExportLanguage): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const element = makePdfElement(conversation, language);
  document.body.append(element);
  try {
    const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const margin = 38;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = canvas.height * imageWidth / canvas.width;
    const image = canvas.toDataURL('image/png');
    let remaining = imageHeight;
    let y = margin;
    pdf.addImage(image, 'PNG', margin, y, imageWidth, imageHeight);
    remaining -= pageHeight - margin * 2;
    while (remaining > 0) {
      pdf.addPage();
      y = margin - (imageHeight - remaining);
      pdf.addImage(image, 'PNG', margin, y, imageWidth, imageHeight);
      remaining -= pageHeight - margin * 2;
    }
    downloadBlob(`${conversation.title}-${language}.pdf`, pdf.output('blob'));
  } finally {
    element.remove();
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function language(value: unknown): Language {
  return value === 'zh' || value === 'fr' || value === 'en' || value === 'und' ? value : 'und';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function date(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function translation(value: unknown): Translation {
  const item = object(value);
  const status = item?.status;
  return { text: text(item?.text), status: status === 'generated' || status === 'edited' || status === 'stale' ? status : 'empty' };
}

function usageEvent(value: unknown, fallbackDate: string, utteranceIds: Map<string, string>): UsageEvent | undefined {
  const item = object(value);
  if (!item || !['stt', 'translation', 'tts', 'test'].includes(String(item.operation))) return undefined;
  const operation = item.operation as UsageEvent['operation'];
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    id: crypto.randomUUID(), utteranceId: utteranceIds.get(text(item.utteranceId)) || undefined, operation, model: text(item.model) || 'unknown', createdAt: date(item.createdAt, fallbackDate),
    inputTokens: number(item.inputTokens), outputTokens: number(item.outputTokens), audioDurationMs: number(item.audioDurationMs), characters: number(item.characters), costUsd: number(item.costUsd),
    costKind: item.costKind === 'calculated' || item.costKind === 'estimated' ? item.costKind : 'unavailable', requestId: text(item.requestId) || undefined,
    outcome: item.outcome === 'failed' ? 'failed' : 'success', errorCode: text(item.errorCode) || undefined,
  };
}

/** Imports only documented data fields, intentionally excluding settings and API keys. */
export function importConversationJson(source: string): Conversation {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('该文件不是有效的 JSON。'); }
  const backup = object(parsed);
  if (!backup || !Array.isArray(backup.utterances)) throw new Error('未找到可恢复的对话内容。');
  const now = new Date().toISOString();
  const utteranceIds = new Map<string, string>();
  const utterances = backup.utterances.map((value, index): Utterance => {
    const item = object(value) ?? {};
    const sourceItem = object(item.source) ?? {};
    const translations = object(item.translations) ?? {};
    const id = crypto.randomUUID();
    if (text(item.id)) utteranceIds.set(text(item.id), id);
    return {
      id, sequence: index + 1, speakerLabel: text(item.speakerLabel) || '发言者',
      source: { text: text(sourceItem.text), language: language(sourceItem.language), confirmedAt: typeof sourceItem.confirmedAt === 'string' ? sourceItem.confirmedAt : undefined },
      translations: { zh: translation(translations.zh), fr: translation(translations.fr), en: translation(translations.en) },
      createdAt: date(item.createdAt, now), updatedAt: date(item.updatedAt, now),
    };
  });
  const usageEvents = Array.isArray(backup.usageEvents) ? backup.usageEvents.map((entry) => usageEvent(entry, now, utteranceIds)).filter((entry): entry is UsageEvent => Boolean(entry)) : [];
  return {
    id: crypto.randomUUID(), title: text(backup.title).trim() || '导入的交流记录', utterances: utterances.length ? utterances : [createUtterance(1)],
    createdAt: date(backup.createdAt, now), updatedAt: now, usageEvents,
  };
}

import { languageSpeakerName, type Conversation, type Language } from '@/lib/types';

type ExportLanguage = Exclude<Language, 'und'> | 'source';

export function toMarkdown(conversation: Conversation, language: ExportLanguage = 'source'): string {
  const content = conversation.utterances.map((utterance) => {
    const text = language === 'source'
      ? utterance.source.text
      : utterance.translations[language].text || utterance.source.text;
    const fallback = language !== 'source' && !utterance.translations[language].text
      ? '\n\n> 未翻译，保留原文。'
      : '';
    return `## ${utterance.sequence}. ${utterance.speakerLabel}（${languageSpeakerName[utterance.source.language]}）\n\n${text || '（未录入）'}${fallback}`;
  });
  return `# ${conversation.title}\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n${content.join('\n\n')}`;
}

export function downloadText(filename: string, text: string, type = 'text/markdown;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

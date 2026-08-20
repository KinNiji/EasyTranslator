export type Language = 'zh' | 'fr' | 'en' | 'und';

export type Translation = {
  text: string;
  status: 'empty' | 'generated' | 'edited' | 'stale';
};

export type Utterance = {
  id: string;
  sequence: number;
  speakerLabel: string;
  source: {
    text: string;
    language: Language;
    confirmedAt?: string;
  };
  translations: Record<'zh' | 'fr' | 'en', Translation>;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  utterances: Utterance[];
  createdAt: string;
  updatedAt: string;
};

export const languageName: Record<Language, string> = {
  zh: '中文',
  fr: 'Français',
  en: 'English',
  und: '待确认',
};

export const languageSpeakerName: Record<Language, string> = {
  zh: '中文发言',
  fr: '法语发言',
  en: '英语发言',
  und: '语言待确认',
};

export function createUtterance(sequence: number): Utterance {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sequence,
    speakerLabel: '发言者',
    source: { text: '', language: 'und' },
    translations: {
      zh: { text: '', status: 'empty' },
      fr: { text: '', status: 'empty' },
      en: { text: '', status: 'empty' },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createConversation(): Conversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: `交流记录 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date())}`,
    utterances: [createUtterance(1)],
    createdAt: now,
    updatedAt: now,
  };
}

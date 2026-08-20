'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadText, toMarkdown } from '@/lib/export-conversation';
import { listConversations, removeConversation, saveConversation } from '@/lib/conversation-db';
import {
  createConversation,
  createUtterance,
  languageName,
  type Conversation,
  type Language,
  type Utterance,
} from '@/lib/types';

const displayLanguages: Array<Exclude<Language, 'und'>> = ['zh', 'fr', 'en'];
const defaultBaseUrl = 'https://api.openai-proxy.org';

function withUpdatedAt(conversation: Conversation): Conversation {
  return { ...conversation, updatedAt: new Date().toISOString() };
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [activeUtteranceId, setActiveUtteranceId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    listConversations()
      .then((items) => {
        setConversations(items);
        if (items[0]) {
          setActiveId(items[0].id);
          setActiveUtteranceId(items[0].utterances[0]?.id);
        }
      })
      .catch(() => setToast('无法读取本地记录；请确认浏览器未禁用站点存储。'))
      .finally(() => setReady(true));
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [activeId, conversations],
  );
  const activeIndex = activeConversation?.utterances.findIndex((item) => item.id === activeUtteranceId) ?? -1;
  const activeUtterance = activeIndex >= 0 ? activeConversation?.utterances[activeIndex] : undefined;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function commit(next: Conversation) {
    const updated = withUpdatedAt(next);
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
    void saveConversation(updated).catch(() => setToast('本地保存失败，请先导出重要记录。'));
  }

  function createNewConversation() {
    const next = createConversation();
    setActiveId(next.id);
    setActiveUtteranceId(next.utterances[0].id);
    commit(next);
  }

  function selectConversation(conversation: Conversation) {
    setActiveId(conversation.id);
    setActiveUtteranceId(conversation.utterances[0]?.id);
  }

  function updateActive(mutator: (utterance: Utterance) => Utterance) {
    if (!activeConversation || !activeUtterance) return;
    const utterances = activeConversation.utterances.map((utterance) =>
      utterance.id === activeUtterance.id ? mutator(utterance) : utterance,
    );
    commit({ ...activeConversation, utterances });
  }

  function updateSource(text: string) {
    updateActive((utterance) => ({
      ...utterance,
      source: { ...utterance.source, text, confirmedAt: undefined },
      translations: displayLanguages.reduce((all, language) => ({
        ...all,
        [language]: language === utterance.source.language
          ? { text, status: 'generated' as const }
          : { text: utterance.translations[language].text, status: text ? 'stale' as const : 'empty' as const },
      }), {} as Utterance['translations']),
      updatedAt: new Date().toISOString(),
    }));
  }

  function setSourceLanguage(language: Language) {
    updateActive((utterance) => ({
      ...utterance,
      source: { ...utterance.source, language, confirmedAt: undefined },
      translations: {
        ...utterance.translations,
        ...(language === 'und' ? {} : { [language]: { text: utterance.source.text, status: 'generated' as const } }),
      },
      updatedAt: new Date().toISOString(),
    }));
  }

  function confirmSource() {
    if (!activeUtterance?.source.text.trim()) {
      setToast('请先录入这一句的内容。');
      return;
    }
    if (activeUtterance.source.language === 'und') {
      setToast('请先选择来源语言；接入 API 后这里会自动识别。');
      return;
    }
    updateActive((utterance) => ({
      ...utterance,
      source: { ...utterance.source, confirmedAt: new Date().toISOString() },
      translations: {
        ...utterance.translations,
        [utterance.source.language]: { text: utterance.source.text, status: 'generated' },
      },
      updatedAt: new Date().toISOString(),
    }));
    setToast('原文已确认。P1 将在此自动生成另两种语言的翻译。');
  }

  function updateTranslation(language: Exclude<Language, 'und'>, text: string) {
    updateActive((utterance) => ({
      ...utterance,
      translations: { ...utterance.translations, [language]: { text, status: 'edited' } },
      updatedAt: new Date().toISOString(),
    }));
  }

  function goPrevious() {
    if (activeIndex > 0 && activeConversation) setActiveUtteranceId(activeConversation.utterances[activeIndex - 1].id);
  }

  function goNext() {
    if (!activeConversation || !activeUtterance) return;
    if (!activeUtterance.source.confirmedAt) {
      setToast('请先确认当前发言，才可以新增下一句。');
      return;
    }
    const nextItem = activeConversation.utterances[activeIndex + 1];
    if (nextItem) {
      setActiveUtteranceId(nextItem.id);
      return;
    }
    const created = createUtterance(activeConversation.utterances.length + 1);
    commit({ ...activeConversation, utterances: [...activeConversation.utterances, created] });
    setActiveUtteranceId(created.id);
  }

  function exportMarkdown(language: Exclude<Language, 'und'> | 'source') {
    if (!activeConversation) return;
    const suffix = language === 'source' ? 'original' : language;
    downloadText(`${activeConversation.title}-${suffix}.md`, toMarkdown(activeConversation, language));
  }

  async function deleteActiveConversation() {
    if (!activeConversation || !window.confirm(`删除“${activeConversation.title}”？此操作只删除当前浏览器中的记录。`)) return;
    await removeConversation(activeConversation.id);
    const remaining = conversations.filter((item) => item.id !== activeConversation.id);
    setConversations(remaining);
    setActiveId(remaining[0]?.id);
    setActiveUtteranceId(remaining[0]?.utterances[0]?.id);
  }

  if (!ready) return <main className="loading">正在读取本地对话…</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">EASYTRANSLATOR · P0</p>
          <h1>中英法交流助手</h1>
        </div>
        <button className="icon-button" aria-label="打开设置" onClick={() => setSettingsOpen(true)}>⚙</button>
      </header>

      <section className="safety-note">
        <span>本地记录</span>
        对话仅保存在当前浏览器；API Key 不会保存。
      </section>

      <div className="workspace">
        <aside className="conversation-list" aria-label="对话列表">
          <button className="primary-button" onClick={createNewConversation}>＋ 新建对话</button>
          {conversations.length === 0 ? (
            <p className="empty-list">还没有记录。创建一个对话开始吧。</p>
          ) : conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-item ${conversation.id === activeId ? 'selected' : ''}`}
              onClick={() => selectConversation(conversation)}
            >
              <strong>{conversation.title}</strong>
              <small>{conversation.utterances.length} 句 · {new Date(conversation.updatedAt).toLocaleDateString('zh-CN')}</small>
            </button>
          ))}
        </aside>

        <section className="conversation-panel">
          {!activeConversation || !activeUtterance ? (
            <div className="empty-state">
              <p>建立一个新对话后，即可逐句记录交流内容。</p>
              <button className="primary-button" onClick={createNewConversation}>新建对话</button>
            </div>
          ) : (
            <>
              <div className="conversation-heading">
                <input
                  aria-label="对话标题"
                  value={activeConversation.title}
                  onChange={(event) => commit({ ...activeConversation, title: event.target.value })}
                />
                <div className="heading-actions">
                  <details className="export-menu">
                    <summary>导出</summary>
                    <button onClick={() => exportMarkdown('source')}>原文 Markdown</button>
                    <button onClick={() => exportMarkdown('zh')}>中文 Markdown</button>
                    <button onClick={() => exportMarkdown('fr')}>法语 Markdown</button>
                    <button onClick={() => exportMarkdown('en')}>英语 Markdown</button>
                  </details>
                  <button className="text-button danger" onClick={() => void deleteActiveConversation()}>删除</button>
                </div>
              </div>

              <nav className="utterance-strip" aria-label="发言导航">
                {activeConversation.utterances.map((utterance) => (
                  <button
                    key={utterance.id}
                    className={utterance.id === activeUtteranceId ? 'current' : ''}
                    onClick={() => setActiveUtteranceId(utterance.id)}
                  >
                    {utterance.sequence}
                    {utterance.source.confirmedAt ? ' ✓' : ''}
                  </button>
                ))}
              </nav>

              <article className="utterance-card">
                <div className="card-topline">
                  <span>第 {activeUtterance.sequence} 句</span>
                  <label>
                    发言者
                    <input
                      value={activeUtterance.speakerLabel}
                      onChange={(event) => updateActive((item) => ({ ...item, speakerLabel: event.target.value, updatedAt: new Date().toISOString() }))}
                    />
                  </label>
                </div>

                <div className="input-mode">
                  <button disabled title="P1 将启用录音与转写">● 录音（P1）</button>
                  <span>或直接输入</span>
                </div>

                <label className="field-label" htmlFor="source-text">原文</label>
                <textarea
                  id="source-text"
                  placeholder="录音转写或直接输入本句内容…"
                  value={activeUtterance.source.text}
                  onChange={(event) => updateSource(event.target.value)}
                  rows={4}
                />
                <div className="language-picker" aria-label="来源语言">
                  {(Object.keys(languageName) as Language[]).map((language) => (
                    <button
                      key={language}
                      className={activeUtterance.source.language === language ? 'active' : ''}
                      onClick={() => setSourceLanguage(language)}
                    >{languageName[language]}</button>
                  ))}
                  <button className="confirm-button" onClick={confirmSource}>确认本句</button>
                </div>

                <div className="translation-grid">
                  {displayLanguages.map((language) => {
                    const translation = activeUtterance.translations[language];
                    const isSource = language === activeUtterance.source.language;
                    return (
                      <section className="translation" key={language}>
                        <div className="translation-title">
                          <strong>{languageName[language]}</strong>
                          <span>{isSource ? '原文' : translation.status === 'stale' ? '待重译' : translation.status === 'edited' ? '已手动修改' : '译文'}</span>
                          <button disabled title="P1 将接入语音播放">▷ 发音</button>
                        </div>
                        <textarea
                          aria-label={`${languageName[language]}文本`}
                          value={isSource ? activeUtterance.source.text : translation.text}
                          disabled={isSource}
                          placeholder={isSource ? '' : 'P1 接入翻译后显示于此'}
                          onChange={(event) => updateTranslation(language, event.target.value)}
                          rows={4}
                        />
                      </section>
                    );
                  })}
                </div>
              </article>

              <div className="pager">
                <button onClick={goPrevious} disabled={activeIndex <= 0}>← 上一句</button>
                <span>{activeIndex + 1} / {activeConversation.utterances.length}</span>
                <button onClick={goNext}>下一句 →</button>
              </div>
            </>
          )}
        </section>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title"><h2 id="settings-title">API 设置</h2><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div>
            <p>输入内容仅保留在当前页面内存中；关闭或刷新页面后 API Key 将被清除。</p>
            <label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="url" /></label>
            <label>API Key<input value={apiKey} type="password" onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="sk-…" /></label>
            <div className="model-grid">
              <label>转写模型<input defaultValue="gpt-4o-mini-transcribe" disabled /></label>
              <label>翻译模型<input defaultValue="gpt-4o-mini" disabled /></label>
              <label>TTS 模型<input defaultValue="gpt-4o-mini-tts" disabled /></label>
            </div>
            <button className="secondary-button" onClick={() => setToast(apiKey ? 'P1 将在这里逐项测试转写、翻译和语音接口。' : '请先输入 API Key。')}>测试 API（P1）</button>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

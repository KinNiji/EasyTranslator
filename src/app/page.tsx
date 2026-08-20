'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { describeApiError, synthesizeSpeech, testApi, transcribeAudio, translateText, type ApiConfig } from '@/lib/api-client';
import { listConversations, removeConversation, saveConversation } from '@/lib/conversation-db';
import { downloadText, toMarkdown } from '@/lib/export-conversation';
import { createConversation, createUtterance, languageName, type Conversation, type Language, type UsageEvent, type Utterance } from '@/lib/types';

const displayLanguages: Array<Exclude<Language, 'und'>> = ['zh', 'fr', 'en'];
const initialConfig: ApiConfig = {
  baseUrl: 'https://api.openai-proxy.org/v1', apiKey: '',
  transcriptionModel: 'gpt-4o-mini-transcribe', translationModel: 'gpt-4o-mini', ttsModel: 'gpt-4o-mini-tts', voice: 'alloy',
};

function withUpdatedAt(conversation: Conversation): Conversation { return { ...conversation, updatedAt: new Date().toISOString() }; }
function failureEvent(operation: UsageEvent['operation'], model: string, utteranceId: string | undefined, message: string): UsageEvent {
  return { id: crypto.randomUUID(), utteranceId, operation, model, createdAt: new Date().toISOString(), costKind: 'unavailable', outcome: 'failed', errorCode: message };
}
function formatCost(cost: number | undefined): string { return cost === undefined ? '—' : `$${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(3)}`; }

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [activeUtteranceId, setActiveUtteranceId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<ApiConfig>(initialConfig);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState<'testing' | 'transcribing' | 'translating' | 'speaking' | undefined>();
  const [recording, setRecording] = useState(false);
  const [apiTestMessage, setApiTestMessage] = useState('尚未测试');
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  useEffect(() => {
    listConversations().then((items) => {
      setConversations(items);
      if (items[0]) { setActiveId(items[0].id); setActiveUtteranceId(items[0].utterances[0]?.id); }
    }).catch(() => setToast('无法读取本地记录；请确认浏览器未禁用站点存储。')).finally(() => setReady(true));
  }, []);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [activeId, conversations]);
  const activeIndex = activeConversation?.utterances.findIndex((item) => item.id === activeUtteranceId) ?? -1;
  const activeUtterance = activeIndex >= 0 ? activeConversation?.utterances[activeIndex] : undefined;
  const totalCost = (activeConversation?.usageEvents ?? []).reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timer); }, [toast]);

  function commit(next: Conversation) {
    const updated = withUpdatedAt(next);
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
    void saveConversation(updated).catch(() => setToast('本地保存失败，请先导出重要记录。'));
  }
  function updateActive(mutator: (utterance: Utterance) => Utterance, usage?: UsageEvent) {
    if (!activeConversation || !activeUtterance) return;
    const utterances = activeConversation.utterances.map((utterance) => utterance.id === activeUtterance.id ? mutator(utterance) : utterance);
    commit({ ...activeConversation, utterances, usageEvents: usage ? [...(activeConversation.usageEvents ?? []), usage] : activeConversation.usageEvents ?? [] });
  }
  function appendUsage(usage: UsageEvent) { if (activeConversation) commit({ ...activeConversation, usageEvents: [...(activeConversation.usageEvents ?? []), usage] }); }
  function createNewConversation() { const next = createConversation(); setActiveId(next.id); setActiveUtteranceId(next.utterances[0].id); commit(next); }
  function selectConversation(conversation: Conversation) { setActiveId(conversation.id); setActiveUtteranceId(conversation.utterances[0]?.id); }
  function updateSource(text: string) {
    updateActive((utterance) => ({ ...utterance, source: { ...utterance.source, text, confirmedAt: undefined }, translations: displayLanguages.reduce((all, language) => ({ ...all, [language]: { text: utterance.translations[language].text, status: text ? 'stale' as const : 'empty' as const } }), {} as Utterance['translations']), updatedAt: new Date().toISOString() }));
  }
  function setSourceLanguage(language: Language) { updateActive((utterance) => ({ ...utterance, source: { ...utterance.source, language, confirmedAt: undefined }, updatedAt: new Date().toISOString() })); }
  function updateTranslation(language: Exclude<Language, 'und'>, text: string) { updateActive((utterance) => ({ ...utterance, translations: { ...utterance.translations, [language]: { text, status: 'edited' } }, updatedAt: new Date().toISOString() })); }
  function requireApiKey(): boolean { if (config.apiKey.trim()) return true; setSettingsOpen(true); setToast('请先在设置中输入 API Key。'); return false; }

  async function translateCurrent() {
    if (!activeUtterance?.source.text.trim()) { setToast('请先录入这一句的内容。'); return; }
    if (!requireApiKey() || busy) return;
    setBusy('translating');
    try {
      const result = await translateText(config, activeUtterance.source.text.trim());
      const usage = { ...result.usage, utteranceId: activeUtterance.id };
      updateActive((utterance) => ({ ...utterance, source: { ...utterance.source, language: result.sourceLanguage, confirmedAt: new Date().toISOString() }, translations: {
        zh: { text: result.sourceLanguage === 'zh' ? utterance.source.text : result.translations.zh, status: 'generated' },
        fr: { text: result.sourceLanguage === 'fr' ? utterance.source.text : result.translations.fr, status: 'generated' },
        en: { text: result.sourceLanguage === 'en' ? utterance.source.text : result.translations.en, status: 'generated' },
      }, updatedAt: new Date().toISOString() }), usage);
      setToast(`已识别为${languageName[result.sourceLanguage]}，并生成另外两种语言。`);
    } catch (error) {
      const message = describeApiError(error); appendUsage(failureEvent('translation', config.translationModel, activeUtterance.id, message)); setToast(message);
    } finally { setBusy(undefined); }
  }
  async function transcribe(blob: Blob, durationMs: number, utteranceId: string) {
    setBusy('transcribing');
    try {
      const result = await transcribeAudio(config, blob, durationMs);
      updateActive((utterance) => ({ ...utterance, source: { ...utterance.source, text: result.text, language: 'und', confirmedAt: undefined }, translations: { zh: { text: '', status: 'empty' }, fr: { text: '', status: 'empty' }, en: { text: '', status: 'empty' } }, updatedAt: new Date().toISOString() }), { ...result.usage, utteranceId });
      setToast('转写完成。请核对原文后点击“识别并翻译”。');
    } catch (error) {
      const message = describeApiError(error); appendUsage(failureEvent('stt', config.transcriptionModel, utteranceId, message)); setToast(message);
    } finally { setBusy(undefined); }
  }
  async function startRecording() {
    if (!activeUtterance || !requireApiKey() || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setToast('此浏览器不支持录音，请直接输入文字。'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
      chunksRef.current = []; startedAtRef.current = Date.now(); recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); setRecording(false); const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }); void transcribe(audio, Date.now() - startedAtRef.current, activeUtterance.id); };
      recorder.start(); setRecording(true);
    } catch (error) { setToast(error instanceof DOMException && error.name === 'NotAllowedError' ? '未获得麦克风权限。请在浏览器站点权限中允许后重试。' : '无法启动录音，请检查麦克风后重试。'); }
  }
  function stopRecording() { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }
  async function playLanguage(language: Exclude<Language, 'und'>) {
    if (!activeUtterance || !requireApiKey() || busy) return;
    const text = language === activeUtterance.source.language ? activeUtterance.source.text : activeUtterance.translations[language].text;
    if (!text.trim()) { setToast('该语言尚没有可播放的内容。'); return; }
    setBusy('speaking');
    try {
      const result = await synthesizeSpeech(config, text.trim()); appendUsage({ ...result.usage, utteranceId: activeUtterance.id });
      const url = URL.createObjectURL(result.audio); const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url); audio.onerror = () => { URL.revokeObjectURL(url); setToast('音频无法播放，请检查设备音量或重试。'); };
      await audio.play();
    } catch (error) { const message = describeApiError(error); appendUsage(failureEvent('tts', config.ttsModel, activeUtterance.id, message)); setToast(message); } finally { setBusy(undefined); }
  }
  async function runApiTest() {
    if (!requireApiKey() || busy) return;
    setBusy('testing'); setApiTestMessage('正在验证 Responses 接口…');
    try { const usage = await testApi(config); setApiTestMessage(`通过 · ${usage.inputTokens ?? 0} 输入 / ${usage.outputTokens ?? 0} 输出 tokens`); }
    catch (error) { setApiTestMessage(`失败 · ${describeApiError(error)}`); } finally { setBusy(undefined); }
  }
  function goPrevious() { if (activeIndex > 0 && activeConversation) setActiveUtteranceId(activeConversation.utterances[activeIndex - 1].id); }
  function goNext() {
    if (!activeConversation || !activeUtterance) return;
    if (!activeUtterance.source.confirmedAt) { setToast('请先完成当前句的识别与翻译，才可以新增下一句。'); return; }
    const next = activeConversation.utterances[activeIndex + 1];
    if (next) { setActiveUtteranceId(next.id); return; }
    const created = createUtterance(activeConversation.utterances.length + 1); commit({ ...activeConversation, utterances: [...activeConversation.utterances, created] }); setActiveUtteranceId(created.id);
  }
  function exportMarkdown(language: Exclude<Language, 'und'> | 'source') { if (activeConversation) downloadText(`${activeConversation.title}-${language}.md`, toMarkdown(activeConversation, language)); }
  function exportJson() { if (activeConversation) downloadText(`${activeConversation.title}-backup.json`, JSON.stringify(activeConversation, null, 2), 'application/json;charset=utf-8'); }
  async function deleteActiveConversation() {
    if (!activeConversation || !window.confirm(`删除“${activeConversation.title}”？此操作只删除当前浏览器中的记录。`)) return;
    await removeConversation(activeConversation.id); const remaining = conversations.filter((item) => item.id !== activeConversation.id);
    setConversations(remaining); setActiveId(remaining[0]?.id); setActiveUtteranceId(remaining[0]?.utterances[0]?.id);
  }

  if (!ready) return <main className="loading">正在读取本地对话…</main>;
  const isBusy = Boolean(busy);
  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">EASYTRANSLATOR · P1</p><h1>中英法交流助手</h1></div><button className="icon-button" aria-label="打开设置" onClick={() => setSettingsOpen(true)}>⚙</button></header>
    <section className="safety-note"><span>本地记录</span>对话仅保存在当前浏览器；API Key 只在本页面内存中使用。</section>
    <div className="workspace">
      <aside className="conversation-list" aria-label="对话列表"><button className="primary-button" onClick={createNewConversation}>＋ 新建对话</button>{conversations.length === 0 ? <p className="empty-list">还没有记录。创建一个对话开始吧。</p> : conversations.map((conversation) => <button key={conversation.id} className={`conversation-item ${conversation.id === activeId ? 'selected' : ''}`} onClick={() => selectConversation(conversation)}><strong>{conversation.title}</strong><small>{conversation.utterances.length} 句 · {new Date(conversation.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}</aside>
      <section className="conversation-panel">
        {!activeConversation || !activeUtterance ? <div className="empty-state"><p>建立一个新对话后，即可逐句记录交流内容。</p><button className="primary-button" onClick={createNewConversation}>新建对话</button></div> : <>
          <div className="conversation-heading"><input aria-label="对话标题" value={activeConversation.title} onChange={(event) => commit({ ...activeConversation, title: event.target.value })} /><div className="heading-actions"><details className="export-menu"><summary>导出</summary><button onClick={() => exportMarkdown('source')}>原文 Markdown</button><button onClick={() => exportMarkdown('zh')}>中文 Markdown</button><button onClick={() => exportMarkdown('fr')}>法语 Markdown</button><button onClick={() => exportMarkdown('en')}>英语 Markdown</button><button onClick={exportJson}>完整 JSON 备份</button></details><button className="text-button danger" onClick={() => void deleteActiveConversation()}>删除</button></div></div>
          <nav className="utterance-strip" aria-label="发言导航">{activeConversation.utterances.map((utterance) => <button key={utterance.id} className={utterance.id === activeUtteranceId ? 'current' : ''} onClick={() => setActiveUtteranceId(utterance.id)}>{utterance.sequence}{utterance.source.confirmedAt ? ' ✓' : ''}</button>)}</nav>
          <article className="utterance-card">
            <div className="card-topline"><span>第 {activeUtterance.sequence} 句</span><label>发言者<input value={activeUtterance.speakerLabel} onChange={(event) => updateActive((item) => ({ ...item, speakerLabel: event.target.value, updatedAt: new Date().toISOString() }))} /></label></div>
            <div className="input-mode"><button className={recording ? 'recording' : ''} onClick={recording ? stopRecording : () => void startRecording()} disabled={isBusy}>{recording ? '■ 停止并转写' : '● 开始录音'}</button><span>{recording ? '正在录音…再次点击即可停止。' : '或直接输入'}</span></div>
            <label className="field-label" htmlFor="source-text">原文</label><textarea id="source-text" placeholder="录音转写或直接输入本句内容…" value={activeUtterance.source.text} onChange={(event) => updateSource(event.target.value)} rows={4} disabled={isBusy} />
            <div className="language-picker" aria-label="来源语言">{(Object.keys(languageName) as Language[]).map((language) => <button key={language} className={activeUtterance.source.language === language ? 'active' : ''} onClick={() => setSourceLanguage(language)} disabled={isBusy}>{languageName[language]}</button>)}<button className="confirm-button" onClick={() => void translateCurrent()} disabled={isBusy}>{busy === 'translating' ? '翻译中…' : '识别并翻译'}</button></div>
            <div className="translation-grid">{displayLanguages.map((language) => { const translation = activeUtterance.translations[language]; const isSource = language === activeUtterance.source.language; return <section className="translation" key={language}><div className="translation-title"><strong>{languageName[language]}</strong><span>{isSource ? '原文' : translation.status === 'stale' ? '待重译' : translation.status === 'edited' ? '已手动修改' : '译文'}</span><button onClick={() => void playLanguage(language)} disabled={isBusy}>▷ 发音</button></div><textarea aria-label={`${languageName[language]}文本`} value={isSource ? activeUtterance.source.text : translation.text} disabled={isSource || isBusy} placeholder={isSource ? '' : '翻译结果将显示于此'} onChange={(event) => updateTranslation(language, event.target.value)} rows={4} /></section>; })}</div>
          </article>
          <div className="pager"><button onClick={goPrevious} disabled={activeIndex <= 0 || isBusy}>← 上一句</button><span>{activeIndex + 1} / {activeConversation.utterances.length}</span><button onClick={goNext} disabled={isBusy}>下一句 →</button></div>
          <section className="usage-panel"><div><strong>本对话用量</strong><span>本地估算 · {activeConversation.usageEvents?.length ?? 0} 次请求</span></div><b>{formatCost(totalCost)}</b>{activeConversation.usageEvents?.slice(-4).reverse().map((event) => <small key={event.id}>{event.operation.toUpperCase()} · {event.model} · {event.inputTokens ?? event.characters ?? 0}{event.outputTokens !== undefined ? ` / ${event.outputTokens} tokens` : ''} · {formatCost(event.costUsd)} {event.outcome === 'failed' ? '· 失败' : ''}</small>)}</section>
        </>}
      </section>
    </div>
    {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-title"><h2 id="settings-title">API 设置</h2><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div><p>API Key 不会保存；刷新或关闭此页面后将清除。CloseAI 地址须含 <code>/v1</code>。</p><label>Base URL<input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} autoComplete="url" /></label><label>API Key<input value={config.apiKey} type="password" onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} autoComplete="off" placeholder="sk-…" /></label><div className="model-grid"><label>转写模型<input value={config.transcriptionModel} onChange={(event) => setConfig({ ...config, transcriptionModel: event.target.value })} /></label><label>翻译模型<input value={config.translationModel} onChange={(event) => setConfig({ ...config, translationModel: event.target.value })} /></label><label>TTS 模型<input value={config.ttsModel} onChange={(event) => setConfig({ ...config, ttsModel: event.target.value })} /></label><label>声音<input value={config.voice} onChange={(event) => setConfig({ ...config, voice: event.target.value })} /></label></div><button className="secondary-button" onClick={() => void runApiTest()} disabled={isBusy}>{busy === 'testing' ? '测试中…' : '测试 API'}</button><p className="test-result" aria-live="polite">{apiTestMessage}</p></section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

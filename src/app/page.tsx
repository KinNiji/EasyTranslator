'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { OnboardingDialog } from '@/components/onboarding-dialog';
import { describeApiError, synthesizeSpeech, testApi, transcribeAudio, translateText, type ApiConfig } from '@/lib/api-client';
import { listConversations, removeConversation, saveConversation } from '@/lib/conversation-db';
import { downloadDocx, downloadPdf, downloadText, importConversationJson, toMarkdown, type ExportLanguage } from '@/lib/export-conversation';
import { languageLabels, translator, type UiLanguage } from '@/lib/i18n';
import { createConversation, createUtterance, languageName, type Conversation, type Language, type UsageEvent, type Utterance } from '@/lib/types';

const displayLanguages: Array<Exclude<Language, 'und'>> = ['zh', 'fr', 'en'];
const initialConfig: ApiConfig = {
  baseUrl: 'https://api.openai-proxy.org/v1', apiKey: '',
  transcriptionModel: 'gpt-4o-mini-transcribe', translationModel: 'gpt-4o-mini', ttsModel: 'gpt-4o-mini-tts', voice: 'alloy',
};
const spokenLanguageLabels: Record<UiLanguage, Record<Language, string>> = {
  'zh-CN': { zh: '中文', fr: '法语', en: '英语', und: '待确认' },
  fr: { zh: 'Chinois', fr: 'Français', en: 'Anglais', und: 'À confirmer' },
  en: { zh: 'Chinese', fr: 'French', en: 'English', und: 'To confirm' },
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
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('zh-CN');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [acknowledged, setAcknowledged] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<ApiConfig>(initialConfig);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState<'testing' | 'transcribing' | 'translating' | 'speaking' | undefined>();
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState<'docx' | 'pdf' | undefined>();
  const [apiTestMessage, setApiTestMessage] = useState('尚未测试');
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const recordingActiveRef = useRef(false);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcriptionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const conversationsRef = useRef<Conversation[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem('easy-translator-language') as UiLanguage | null;
    const savedTheme = window.localStorage.getItem('easy-translator-theme') as 'light' | 'dark' | null;
    const hasAcknowledged = window.localStorage.getItem('easy-translator-disclaimer-acknowledged') === '1';
    const frame = window.requestAnimationFrame(() => {
      if (savedLanguage && savedLanguage in languageLabels) setUiLanguage(savedLanguage);
      if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme);
      setAcknowledged(hasAcknowledged);
      setHelpOpen(!hasAcknowledged);
      setPreferencesReady(true);
    });
    listConversations().then((items) => {
      setConversations(items);
      if (items[0]) { setActiveId(items[0].id); setActiveUtteranceId(items[0].utterances[0]?.id); }
    }).catch(() => setToast('无法读取本地记录；请确认浏览器未禁用站点存储。')).finally(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => {
    recordingActiveRef.current = false;
    if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('easy-translator-theme', theme);
  }, [theme, preferencesReady]);
  useEffect(() => {
    if (preferencesReady) window.localStorage.setItem('easy-translator-language', uiLanguage);
  }, [uiLanguage, preferencesReady]);
  useEffect(() => {
    if (!ready || acknowledged || !helpOpen || secondsLeft === 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [ready, acknowledged, helpOpen, secondsLeft]);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [activeId, conversations]);
  const activeIndex = activeConversation?.utterances.findIndex((item) => item.id === activeUtteranceId) ?? -1;
  const activeUtterance = activeIndex >= 0 ? activeConversation?.utterances[activeIndex] : undefined;
  const totalCost = (activeConversation?.usageEvents ?? []).reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  const t = translator(uiLanguage);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timer); }, [toast]);

  function commit(next: Conversation) {
    const updated = withUpdatedAt(next);
    const nextItems = [updated, ...conversationsRef.current.filter((item) => item.id !== updated.id)];
    conversationsRef.current = nextItems;
    setConversations(nextItems);
    void saveConversation(updated).catch(() => setToast('本地保存失败，请先导出重要记录。'));
  }
  function updateUtterance(conversationId: string, utteranceId: string, mutator: (utterance: Utterance) => Utterance, usage?: UsageEvent) {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) return;
    const utterances = conversation.utterances.map((utterance) => utterance.id === utteranceId ? mutator(utterance) : utterance);
    commit({ ...conversation, utterances, usageEvents: usage ? [...(conversation.usageEvents ?? []), usage] : conversation.usageEvents ?? [] });
  }
  function updateActive(mutator: (utterance: Utterance) => Utterance, usage?: UsageEvent) {
    if (!activeConversation || !activeUtterance) return;
    updateUtterance(activeConversation.id, activeUtterance.id, mutator, usage);
  }
  function appendUsage(usage: UsageEvent, conversationId = activeConversation?.id) {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (conversation) commit({ ...conversation, usageEvents: [...(conversation.usageEvents ?? []), usage] });
  }
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
  async function transcribe(blob: Blob, durationMs: number, conversationId: string, utteranceId: string, append = false) {
    setBusy('transcribing');
    try {
      const result = await transcribeAudio(config, blob, durationMs);
      updateUtterance(conversationId, utteranceId, (utterance) => ({
        ...utterance,
        source: { ...utterance.source, text: append && utterance.source.text ? `${utterance.source.text.trimEnd()} ${result.text}` : result.text, language: 'und', confirmedAt: undefined },
        translations: { zh: { text: '', status: 'empty' }, fr: { text: '', status: 'empty' }, en: { text: '', status: 'empty' } },
        updatedAt: new Date().toISOString(),
      }), { ...result.usage, utteranceId });
      setToast(append ? '已更新转写预览。' : '转写完成。请核对原文后点击“识别并翻译”。');
    } catch (error) {
      const message = describeApiError(error); appendUsage(failureEvent('stt', config.transcriptionModel, utteranceId, message), conversationId); setToast(message);
    } finally { setBusy(undefined); }
  }
  async function startRecording() {
    if (!activeUtterance || !requireApiKey() || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setToast('此浏览器不支持录音，请直接输入文字。'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const conversationId = activeConversation?.id;
      if (!conversationId) return;
      streamRef.current = stream;
      recordingActiveRef.current = true;
      setRecording(true);
      const beginSegment = () => {
        if (!recordingActiveRef.current) return;
        const chunks: Blob[] = [];
        const startedAt = Date.now();
        const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (audio.size) {
            transcriptionQueueRef.current = transcriptionQueueRef.current
              .then(() => transcribe(audio, Date.now() - startedAt, conversationId, activeUtterance.id, true))
              .catch(() => undefined);
          }
          if (recordingActiveRef.current) beginSegment();
          else {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = undefined;
            setRecording(false);
          }
        };
        recorder.start();
        segmentTimerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 4000);
      };
      beginSegment();
    } catch (error) { setToast(error instanceof DOMException && error.name === 'NotAllowedError' ? '未获得麦克风权限。请在浏览器站点权限中允许后重试。' : '无法启动录音，请检查麦克风后重试。'); }
  }
  function stopRecording() {
    recordingActiveRef.current = false;
    if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }
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
  function exportMarkdown(language: ExportLanguage) { if (activeConversation) downloadText(`${activeConversation.title}-${language}.md`, toMarkdown(activeConversation, language)); }
  function exportJson() { if (activeConversation) downloadText(`${activeConversation.title}-backup.json`, JSON.stringify(activeConversation, null, 2), 'application/json;charset=utf-8'); }
  async function exportOffice(format: 'docx' | 'pdf', language: ExportLanguage) {
    if (!activeConversation || exporting) return;
    setExporting(format);
    try {
      if (format === 'docx') await downloadDocx(activeConversation, language);
      else await downloadPdf(activeConversation, language);
      setToast(format === 'docx' ? 'Word 文件已开始下载。' : 'PDF 文件已开始下载。');
    } catch {
      setToast('导出失败。请在较新的 Chrome、Edge 或 Safari 中重试。');
    } finally { setExporting(undefined); }
  }
  async function importConversation(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件过大，请选择 5MB 以内的 JSON 备份。');
      const restored = importConversationJson(await file.text());
      commit(restored);
      setActiveId(restored.id);
      setActiveUtteranceId(restored.utterances[0]?.id);
      setToast(`已导入“${restored.title}”。`);
    } catch (error) { setToast(error instanceof Error ? error.message : '导入失败，请选择本工具导出的 JSON 文件。');
    } finally { if (importInputRef.current) importInputRef.current.value = ''; }
  }
  async function deleteActiveConversation() {
    if (!activeConversation || !window.confirm(`删除“${activeConversation.title}”？此操作只删除当前浏览器中的记录。`)) return;
    await removeConversation(activeConversation.id); const remaining = conversations.filter((item) => item.id !== activeConversation.id);
    setConversations(remaining); setActiveId(remaining[0]?.id); setActiveUtteranceId(remaining[0]?.utterances[0]?.id);
  }
  function acknowledgeDisclaimer() {
    window.localStorage.setItem('easy-translator-disclaimer-acknowledged', '1');
    setAcknowledged(true); setHelpOpen(false);
  }

  if (!ready || !preferencesReady) return <main className="loading">正在读取本地对话…</main>;
  const isBusy = Boolean(busy);
  return <main className="app-shell" lang={uiLanguage}>
    <header className="topbar"><div><p className="eyebrow">EASYTRANSLATOR · P2</p><h1>{t('appName')}</h1></div><div className="top-actions"><button className="text-button" onClick={() => setHelpOpen(true)}>{t('help')}</button><button className="icon-button" aria-label={theme === 'dark' ? t('light') : t('dark')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '◐'}</button><button className="icon-button" aria-label={t('apiSettings')} onClick={() => setSettingsOpen(true)}>⚙</button></div></header>
    <section className="safety-note"><span>{t('localOnly')}</span>{t('localNotice')}</section>
    <div className="workspace">
      <aside className="conversation-list" aria-label={t('newConversation')}><button className="primary-button" onClick={createNewConversation} disabled={!acknowledged}>{t('newConversation')}</button><button className="import-button" onClick={() => importInputRef.current?.click()} disabled={!acknowledged || recording}>{t('import')}</button>{conversations.length === 0 ? <p className="empty-list">{t('noConversations')}</p> : conversations.map((conversation) => <button key={conversation.id} className={`conversation-item ${conversation.id === activeId ? 'selected' : ''}`} onClick={() => selectConversation(conversation)} disabled={!acknowledged || recording}><strong>{conversation.title}</strong><small>{conversation.utterances.length} · {new Date(conversation.updatedAt).toLocaleDateString(uiLanguage)}</small></button>)}</aside>
      <section className="conversation-panel">
        {!activeConversation || !activeUtterance ? <div className="empty-state"><p>{t('startConversation')}</p><button className="primary-button" onClick={createNewConversation} disabled={!acknowledged}>{t('newConversation')}</button></div> : <>
          <div className="conversation-heading"><input aria-label="Conversation title" value={activeConversation.title} onChange={(event) => commit({ ...activeConversation, title: event.target.value })} disabled={!acknowledged || recording} /><div className="heading-actions"><details className="export-menu"><summary>{exporting ? t('exporting') : t('export')}</summary><strong>Markdown</strong><button onClick={() => exportMarkdown('source')}>{t('sourceExport')}</button><button onClick={() => exportMarkdown('zh')}>{t('chineseExport')}</button><button onClick={() => exportMarkdown('fr')}>{t('frenchExport')}</button><button onClick={() => exportMarkdown('en')}>{t('englishExport')}</button><strong>Word</strong><button disabled={Boolean(exporting)} onClick={() => void exportOffice('docx', 'source')}>{t('sourceDocx')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('docx', 'zh')}>{t('chineseDocx')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('docx', 'fr')}>{t('frenchDocx')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('docx', 'en')}>{t('englishDocx')}</button><strong>PDF</strong><button disabled={Boolean(exporting)} onClick={() => void exportOffice('pdf', 'source')}>{t('sourcePdf')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('pdf', 'zh')}>{t('chinesePdf')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('pdf', 'fr')}>{t('frenchPdf')}</button><button disabled={Boolean(exporting)} onClick={() => void exportOffice('pdf', 'en')}>{t('englishPdf')}</button><strong>Backup</strong><button onClick={exportJson}>{t('jsonExport')}</button></details><button className="text-button danger" onClick={() => void deleteActiveConversation()} disabled={!acknowledged || recording}>{t('remove')}</button></div></div>
          <nav className="utterance-strip" aria-label="Utterance navigation">{activeConversation.utterances.map((utterance) => <button key={utterance.id} className={utterance.id === activeUtteranceId ? 'current' : ''} onClick={() => setActiveUtteranceId(utterance.id)} disabled={!acknowledged || recording}>{utterance.sequence}{utterance.source.confirmedAt ? ' ✓' : ''}</button>)}</nav>
          <article className="utterance-card">
            <div className="card-topline"><span>#{activeUtterance.sequence}</span><label>{t('speaker')}<input value={activeUtterance.speakerLabel} onChange={(event) => updateActive((item) => ({ ...item, speakerLabel: event.target.value, updatedAt: new Date().toISOString() }))} disabled={!acknowledged || recording} /></label></div>
            <div className="input-mode"><button className={recording ? 'recording' : ''} onClick={recording ? stopRecording : () => void startRecording()} disabled={!acknowledged || (isBusy && !recording)}>{recording ? t('stopRecording') : t('startRecording')}</button><span>{recording ? t('recording') : t('directInput')}</span></div>
            <label className="field-label" htmlFor="source-text">{t('source')}</label><textarea id="source-text" placeholder={t('sourcePlaceholder')} value={activeUtterance.source.text} onChange={(event) => updateSource(event.target.value)} rows={4} disabled={!acknowledged || isBusy || recording} />
            <div className="language-picker" aria-label={t('source')}>{(Object.keys(languageName) as Language[]).map((language) => <button key={language} className={activeUtterance.source.language === language ? 'active' : ''} onClick={() => setSourceLanguage(language)} disabled={!acknowledged || isBusy || recording}>{spokenLanguageLabels[uiLanguage][language]}</button>)}<button className="confirm-button" onClick={() => void translateCurrent()} disabled={!acknowledged || isBusy || recording}>{busy === 'translating' ? t('translating') : t('detectTranslate')}</button></div>
            <div className="translation-grid">{displayLanguages.map((language) => { const translation = activeUtterance.translations[language]; const isSource = language === activeUtterance.source.language; return <section className="translation" key={language}><div className="translation-title"><strong>{spokenLanguageLabels[uiLanguage][language]}</strong><span>{isSource ? t('original') : translation.status === 'stale' ? t('stale') : translation.status === 'edited' ? t('manuallyEdited') : t('translation')}</span><button onClick={() => void playLanguage(language)} disabled={!acknowledged || isBusy || recording}>{t('pronunciation')}</button></div><textarea aria-label={`${spokenLanguageLabels[uiLanguage][language]} text`} value={isSource ? activeUtterance.source.text : translation.text} disabled={!acknowledged || isSource || isBusy || recording} placeholder={isSource ? '' : t('translationPlaceholder')} onChange={(event) => updateTranslation(language, event.target.value)} rows={4} /></section>; })}</div>
          </article>
          <div className="pager"><button onClick={goPrevious} disabled={!acknowledged || activeIndex <= 0 || isBusy || recording}>{t('previous')}</button><span>{activeIndex + 1} / {activeConversation.utterances.length}</span><button onClick={goNext} disabled={!acknowledged || isBusy || recording}>{t('next')}</button></div>
          <section className="usage-panel"><div><strong>{t('usage')}</strong><span>{t('estimate')} · {activeConversation.usageEvents?.length ?? 0} {t('requests')}</span></div><b>{formatCost(totalCost)}</b>{activeConversation.usageEvents?.slice(-4).reverse().map((event) => <small key={event.id}>{event.operation.toUpperCase()} · {event.model} · {event.inputTokens ?? event.characters ?? 0}{event.outputTokens !== undefined ? ` / ${event.outputTokens} tokens` : ''} · {formatCost(event.costUsd)} {event.outcome === 'failed' ? '· failed' : ''}</small>)}</section>
        </>}
      </section>
    </div>
    {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-title"><h2 id="settings-title">{t('apiSettings')}</h2><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div><p>{t('apiPrivacy')} <code>/v1</code>。</p><label>{t('language')}<select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>{(Object.keys(languageLabels) as UiLanguage[]).map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}</select></label><label>Base URL<input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} autoComplete="url" /></label><label>API Key<input value={config.apiKey} type="password" onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} autoComplete="off" placeholder="sk-…" /></label><div className="model-grid"><label>STT<input value={config.transcriptionModel} onChange={(event) => setConfig({ ...config, transcriptionModel: event.target.value })} /></label><label>Translation<input value={config.translationModel} onChange={(event) => setConfig({ ...config, translationModel: event.target.value })} /></label><label>TTS<input value={config.ttsModel} onChange={(event) => setConfig({ ...config, ttsModel: event.target.value })} /></label><label>Voice<input value={config.voice} onChange={(event) => setConfig({ ...config, voice: event.target.value })} /></label></div><button className="secondary-button" onClick={() => void runApiTest()} disabled={isBusy}>{busy === 'testing' ? t('testing') : t('apiTest')}</button><p className="test-result" aria-live="polite">{apiTestMessage}</p></section></div>}
    <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importConversation(event.target.files?.[0])} />
    {helpOpen && <OnboardingDialog language={uiLanguage} translate={t} secondsLeft={secondsLeft} required={!acknowledged} onAcknowledge={acknowledgeDisclaimer} onClose={() => setHelpOpen(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

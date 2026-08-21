'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, CircleHelp, Download, Info, Languages, Maximize2, Menu, Mic, Minimize2, Moon, Pencil, Settings, Square, Sun, Trash2, Volume2 } from 'lucide-react';
import { OnboardingDialog } from '@/components/onboarding-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetCloseButton, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { defaultPricing, describeApiError, synthesizeSpeech, testApi, transcribeAudio, translateText, type ApiConfig, type Pricing } from '@/lib/api-client';
import { listConversations, removeConversation, saveConversation } from '@/lib/conversation-db';
import { downloadDocx, downloadPdf, downloadText, importConversationJson, toMarkdown, type ExportLanguage } from '@/lib/export-conversation';
import { languageLabels, translator, type UiLanguage } from '@/lib/i18n';
import { createConversation, createUtterance, type Conversation, type Language, type UsageEvent, type Utterance } from '@/lib/types';

const displayLanguages: Array<Exclude<Language, 'und'>> = ['zh', 'fr', 'en'];
const initialConfig: ApiConfig = {
  baseUrl: 'https://api.openai-proxy.org/v1', apiKey: '', transcriptionModel: 'gpt-4o-mini-transcribe', translationModel: 'gpt-4o-mini', ttsModel: 'gpt-4o-mini-tts', voice: 'alloy', pricing: defaultPricing,
};
const spokenLanguageLabels: Record<UiLanguage, Record<Language, string>> = {
  'zh-CN': { zh: '中文', fr: '法语', en: '英语', und: '待确认' },
  fr: { zh: 'Chinois', fr: 'Français', en: 'Anglais', und: 'À confirmer' },
  en: { zh: 'Chinese', fr: 'French', en: 'English', und: 'To confirm' },
};
const languageFlags: Record<Language, string> = { zh: '🇨🇳', fr: '🇫🇷', en: '🇬🇧', und: '🌐' };
const interfaceLanguageFlags: Record<UiLanguage, string> = { 'zh-CN': '🇨🇳', fr: '🇫🇷', en: '🇬🇧' };
const assetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type ExportFormat = 'md' | 'docx' | 'pdf' | 'json';

function withUpdatedAt(conversation: Conversation): Conversation { return { ...conversation, updatedAt: new Date().toISOString() }; }
function failureEvent(operation: UsageEvent['operation'], model: string, utteranceId: string | undefined, message: string): UsageEvent {
  return { id: crypto.randomUUID(), utteranceId, operation, model, createdAt: new Date().toISOString(), costKind: 'unavailable', outcome: 'failed', errorCode: message };
}
function formatCost(cost: number | undefined): string { return cost === undefined ? '—' : `$${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(3)}`; }
function priceValue(value: string, fallback: number): number { if (!value.trim()) return fallback; const next = Number(value); return Number.isFinite(next) && next >= 0 ? next : fallback; }

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportLanguage, setExportLanguage] = useState<ExportLanguage>('source');
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
  const feedRef = useRef<HTMLDivElement>(null);

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
      if (items[0]) { setActiveId(items[0].id); setActiveUtteranceId(items[0].utterances.at(-1)?.id); }
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
  useEffect(() => { if (preferencesReady) window.localStorage.setItem('easy-translator-language', uiLanguage); }, [uiLanguage, preferencesReady]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 650px)');
    const update = () => { setIsMobile(media.matches); setFocusMode(media.matches); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!ready || acknowledged || !helpOpen || secondsLeft === 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [ready, acknowledged, helpOpen, secondsLeft]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timer); }, [toast]);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [conversations, activeId]);
  const activeIndex = activeConversation?.utterances.findIndex((item) => item.id === activeUtteranceId) ?? -1;
  const activeUtterance = activeIndex >= 0 ? activeConversation?.utterances[activeIndex] : undefined;
  const totalCost = (activeConversation?.usageEvents ?? []).reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  const t = translator(uiLanguage);
  const isBusy = Boolean(busy);
  const conversationMessages = activeConversation?.utterances.filter((utterance) => utterance.source.text.trim()) ?? [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: recording ? 'auto' : 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversation?.updatedAt, activeUtteranceId, recording]);

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
  function createNewConversation() {
    const next = createConversation();
    setActiveId(next.id); setActiveUtteranceId(next.utterances[0].id); commit(next); setHistoryOpen(false);
  }
  function selectConversation(conversation: Conversation) {
    setActiveId(conversation.id); setActiveUtteranceId(conversation.utterances.at(-1)?.id); setHistoryOpen(false);
  }
  function updateSource(text: string) {
    updateActive((utterance) => ({ ...utterance, source: { ...utterance.source, text, confirmedAt: undefined }, translations: displayLanguages.reduce((all, language) => ({ ...all, [language]: { text: utterance.translations[language].text, status: text ? 'stale' as const : 'empty' as const } }), {} as Utterance['translations']), updatedAt: new Date().toISOString() }));
  }
  function updateTranslation(language: Exclude<Language, 'und'>, text: string) { updateActive((utterance) => ({ ...utterance, translations: { ...utterance.translations, [language]: { text, status: 'edited' } }, updatedAt: new Date().toISOString() })); }
  function updatePricing(key: keyof Pricing, value: string) { setConfig((current) => ({ ...current, pricing: { ...current.pricing, [key]: priceValue(value, current.pricing[key]) } })); }
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
      setToast(`已识别为${spokenLanguageLabels[uiLanguage][result.sourceLanguage]}，并生成另外两种语言。`);
    } catch (error) {
      const message = describeApiError(error); appendUsage(failureEvent('translation', config.translationModel, activeUtterance.id, message)); setToast(message);
    } finally { setBusy(undefined); }
  }
  async function transcribe(blob: Blob, durationMs: number, conversationId: string, utteranceId: string, append = false, translateAfter = false) {
    setBusy('transcribing');
    try {
      const result = await transcribeAudio(config, blob, durationMs);
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const current = conversation?.utterances.find((item) => item.id === utteranceId);
      const sourceText = append && current?.source.text ? `${current.source.text.trimEnd()} ${result.text}` : result.text;
      updateUtterance(conversationId, utteranceId, (utterance) => ({
        ...utterance,
        source: { ...utterance.source, text: sourceText, language: 'und', confirmedAt: undefined },
        translations: { zh: { text: '', status: 'empty' }, fr: { text: '', status: 'empty' }, en: { text: '', status: 'empty' } }, updatedAt: new Date().toISOString(),
      }), { ...result.usage, utteranceId });
      if (!translateAfter || !sourceText.trim()) { setToast(append ? '已更新转写预览。' : '转写完成。'); return; }
      setBusy('translating');
      const translated = await translateText(config, sourceText.trim());
      updateUtterance(conversationId, utteranceId, (utterance) => ({ ...utterance, source: { ...utterance.source, language: translated.sourceLanguage, confirmedAt: new Date().toISOString() }, translations: {
        zh: { text: translated.sourceLanguage === 'zh' ? sourceText : translated.translations.zh, status: 'generated' },
        fr: { text: translated.sourceLanguage === 'fr' ? sourceText : translated.translations.fr, status: 'generated' },
        en: { text: translated.sourceLanguage === 'en' ? sourceText : translated.translations.en, status: 'generated' },
      }, updatedAt: new Date().toISOString() }), { ...translated.usage, utteranceId });
      setToast(`已识别为${spokenLanguageLabels[uiLanguage][translated.sourceLanguage]}，并生成另外两种语言。`);
    } catch (error) {
      const message = describeApiError(error); appendUsage(failureEvent('stt', config.transcriptionModel, utteranceId, message), conversationId); setToast(message);
    } finally { setBusy(undefined); }
  }
  async function startRecording() {
    if (!activeUtterance || !requireApiKey() || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setToast('此浏览器不支持录音，请直接输入文字。'); return; }
    recordingActiveRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recordingActiveRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const conversationId = activeConversation?.id;
      if (!conversationId) return;
      streamRef.current = stream; setRecording(true);
      const beginSegment = () => {
        if (!recordingActiveRef.current) return;
        const chunks: Blob[] = [];
        const startedAt = Date.now();
        const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const isFinalSegment = !recordingActiveRef.current;
          if (audio.size) transcriptionQueueRef.current = transcriptionQueueRef.current.then(() => transcribe(audio, Date.now() - startedAt, conversationId, activeUtterance.id, true, isFinalSegment)).catch(() => undefined);
          if (recordingActiveRef.current) beginSegment();
          else { stream.getTracks().forEach((track) => track.stop()); streamRef.current = undefined; setRecording(false); }
        };
        recorder.start();
        segmentTimerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 4000);
      };
      beginSegment();
    } catch (error) {
      recordingActiveRef.current = false;
      setToast(error instanceof DOMException && error.name === 'NotAllowedError' ? '未获得麦克风权限。请在浏览器站点权限中允许后重试。' : '无法启动录音，请检查麦克风后重试。');
    }
  }
  function stopRecording() {
    recordingActiveRef.current = false;
    if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }
  function toggleDesktopRecording() {
    if (recording || recordingActiveRef.current) stopRecording();
    else void startRecording();
  }
  async function playLanguage(language: Exclude<Language, 'und'>, utterance = activeUtterance) {
    if (!utterance || !requireApiKey() || busy) return;
    const text = language === utterance.source.language ? utterance.source.text : utterance.translations[language].text;
    if (!text.trim()) { setToast('该语言尚没有可播放的内容。'); return; }
    setBusy('speaking');
    try {
      const result = await synthesizeSpeech(config, text.trim()); appendUsage({ ...result.usage, utteranceId: utterance.id });
      const url = URL.createObjectURL(result.audio); const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url); audio.onerror = () => { URL.revokeObjectURL(url); setToast('音频无法播放，请检查设备音量或重试。'); };
      await audio.play();
    } catch (error) { const message = describeApiError(error); appendUsage(failureEvent('tts', config.ttsModel, utterance.id, message)); setToast(message); } finally { setBusy(undefined); }
  }
  async function runApiTest() {
    if (!requireApiKey() || busy) return;
    setBusy('testing'); setApiTestMessage('正在验证 Responses 接口…');
    try { const usage = await testApi(config); setApiTestMessage(`通过 · ${usage.inputTokens ?? 0} 输入 / ${usage.outputTokens ?? 0} 输出 tokens`); }
    catch (error) { setApiTestMessage(`失败 · ${describeApiError(error)}`); } finally { setBusy(undefined); }
  }
  function createNextTurn() {
    if (!activeConversation || !activeUtterance) return;
    if (!activeUtterance.source.confirmedAt) { setToast('请先完成当前句的识别与翻译。'); return; }
    const next = activeConversation.utterances[activeIndex + 1];
    if (next) { setActiveUtteranceId(next.id); return; }
    const created = createUtterance(activeConversation.utterances.length + 1);
    commit({ ...activeConversation, utterances: [...activeConversation.utterances, created] }); setActiveUtteranceId(created.id);
  }
  function selectPreviousTurn() {
    if (!activeConversation || activeIndex <= 0) return;
    setActiveUtteranceId(activeConversation.utterances[activeIndex - 1].id);
  }
  function exportMarkdown(language: ExportLanguage) { if (activeConversation) downloadText(`${activeConversation.title}-${language}.md`, toMarkdown(activeConversation, language)); }
  function exportJson() { if (activeConversation) downloadText(`${activeConversation.title}-backup.json`, JSON.stringify(activeConversation, null, 2), 'application/json;charset=utf-8'); }
  async function exportOffice(format: 'docx' | 'pdf', language: ExportLanguage) {
    if (!activeConversation || exporting) return;
    setExporting(format);
    try {
      if (format === 'docx') await downloadDocx(activeConversation, language); else await downloadPdf(activeConversation, language);
      setToast(format === 'docx' ? 'Word 文件已开始下载。' : 'PDF 文件已开始下载。'); setExportOpen(false);
    } catch { setToast('导出失败。请在较新的 Chrome、Edge 或 Safari 中重试。'); }
    finally { setExporting(undefined); }
  }
  async function submitExport() {
    if (exportFormat === 'json') { exportJson(); setExportOpen(false); return; }
    if (exportFormat === 'md') { exportMarkdown(exportLanguage); setExportOpen(false); return; }
    await exportOffice(exportFormat, exportLanguage);
  }
  async function importConversation(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件过大，请选择 5MB 以内的 JSON 备份。');
      const restored = importConversationJson(await file.text());
      commit(restored); setActiveId(restored.id); setActiveUtteranceId(restored.utterances.at(-1)?.id); setToast(`已导入“${restored.title}”。`); setHistoryOpen(false);
    } catch (error) { setToast(error instanceof Error ? error.message : '导入失败，请选择本工具导出的 JSON 文件。'); }
    finally { if (importInputRef.current) importInputRef.current.value = ''; }
  }
  async function deleteActiveConversation() {
    if (!activeConversation || !window.confirm(`删除“${activeConversation.title}”？此操作只删除当前浏览器中的记录。`)) return;
    await removeConversation(activeConversation.id);
    const remaining = conversationsRef.current.filter((item) => item.id !== activeConversation.id);
    conversationsRef.current = remaining; setConversations(remaining); setActiveId(remaining[0]?.id); setActiveUtteranceId(remaining[0]?.utterances.at(-1)?.id);
  }
  function openRename() {
    if (!activeConversation) return;
    setRenameDraft(activeConversation.title); setRenameOpen(true);
  }
  function saveRename() {
    if (!activeConversation) return;
    const title = renameDraft.trim();
    if (title) commit({ ...activeConversation, title });
    setRenameOpen(false);
  }
  function acknowledgeDisclaimer() { window.localStorage.setItem('easy-translator-disclaimer-acknowledged', '1'); setAcknowledged(true); setHelpOpen(false); }

  if (!ready || !preferencesReady) return <main className="loading">正在读取本地对话…</main>;

  return <main className={`app-shell chat-shell ${focusMode ? 'focus-mode' : ''}`} lang={uiLanguage}>
    <header className="chat-header">
      <Button className="header-icon" variant="ghost" size="icon-sm" aria-label={t('menu')} title={t('menu')} onClick={() => setHistoryOpen(true)}><Menu /></Button>
      <div className="header-spacer" />
      <div className="header-actions">
        <label className="toolbar-language" aria-label={t('language')}><span aria-hidden="true">{interfaceLanguageFlags[uiLanguage]}</span><select className="toolbar-language-select" value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>{(Object.keys(languageLabels) as UiLanguage[]).map((language) => <option key={language} value={language}>{interfaceLanguageFlags[language]} {languageLabels[language]}</option>)}</select></label>
        <Button className="header-icon" variant="ghost" size="icon-sm" aria-label={theme === 'dark' ? t('light') : t('dark')} title={theme === 'dark' ? t('light') : t('dark')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
        {!isMobile && <Button className="header-icon" variant="ghost" size="icon-sm" aria-label={focusMode ? t('exitFullscreen') : t('fullscreen')} title={focusMode ? t('exitFullscreen') : t('fullscreen')} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 /> : <Maximize2 />}</Button>}
        <Button className="header-icon" variant="ghost" size="icon-sm" aria-label={t('help')} title={t('help')} onClick={() => setHelpOpen(true)}><CircleHelp /></Button>
        <Button className="header-icon" variant="ghost" size="icon-sm" aria-label={t('apiSettings')} title={t('apiSettings')} onClick={() => setSettingsOpen(true)}><Settings /></Button>
      </div>
    </header>

    <section className="chat-stage">
      {!activeConversation || !activeUtterance ? <div className="chat-empty">
        <div className="empty-language-mark" aria-hidden="true"><Languages /></div>
        <p className="empty-eyebrow">中文 · Français · English</p>
        <h1>{t('emptyWelcomeTitle')}</h1>
        <p className="empty-intro">{t('emptyWelcomeText')}</p>
        <ol className="empty-steps">
          <li><span>1</span><p><strong>{t('emptyStepOneTitle')}</strong><small>{t('emptyStepOneText')}</small></p></li>
          <li><span>2</span><p><strong>{t('emptyStepTwoTitle')}</strong><small>{t('emptyStepTwoText')}</small></p></li>
          <li><span>3</span><p><strong>{t('emptyStepThreeTitle')}</strong><small>{t('emptyStepThreeText')}</small></p></li>
          <li><span>4</span><p><strong>{t('emptyStepFourTitle')}</strong><small>{t('emptyStepFourText')}</small></p></li>
        </ol>
        <Button className="empty-start" onClick={createNewConversation} disabled={!acknowledged}>{t('newConversation')}</Button>
        <p className="empty-note">{t('localNotice')}</p>
      </div> : <>
        <div className="conversation-toolbar"><strong className="conversation-title">{activeConversation.title}</strong><div className="turn-navigation" aria-label={t('liveTurn')}><Button className="turn-nav-button" variant="ghost" size="icon-sm" title={t('previous')} aria-label={t('previous')} onClick={selectPreviousTurn} disabled={!acknowledged || recording || activeIndex <= 0}><ChevronLeft /></Button><span aria-label={`${t('liveTurn')} ${activeIndex + 1} / ${activeConversation.utterances.length}`}>{activeIndex + 1}<i>/</i>{activeConversation.utterances.length}</span><Button className="turn-nav-button" variant="ghost" size="icon-sm" title={t('next')} aria-label={t('next')} onClick={createNextTurn} disabled={!acknowledged || recording || !activeUtterance.source.confirmedAt}><ChevronRight /></Button></div><div className="toolbar-actions"><Button className="tool-icon" variant="ghost" size="icon-sm" title={t('rename')} aria-label={t('rename')} onClick={openRename} disabled={!acknowledged || recording}><Pencil /></Button><Button className="tool-icon" variant="ghost" size="icon-sm" title={t('details')} aria-label={t('details')} onClick={() => setDetailsOpen(true)} disabled={!acknowledged}><Info /></Button><Button className="tool-icon" variant="ghost" size="icon-sm" title={t('export')} aria-label={t('export')} onClick={() => setExportOpen(true)} disabled={!acknowledged}><Download /></Button><Button className="tool-icon danger" variant="destructive" size="icon-sm" title={t('remove')} aria-label={t('remove')} onClick={() => void deleteActiveConversation()} disabled={!acknowledged || recording}><Trash2 /></Button></div></div>
        <div className="chat-feed" ref={feedRef}>
          {conversationMessages.length === 0 && <div className="chat-welcome"><p>{t('startConversation')}</p><span>{t('localNotice')}</span></div>}
          {conversationMessages.map((utterance) => <article className={`message-card ${utterance.id === activeUtterance.id ? 'current' : ''}`} key={utterance.id} onClick={() => setActiveUtteranceId(utterance.id)}>
            <header className="message-source"><span className="source-language">#{utterance.sequence} · {languageFlags[utterance.source.language]} {spokenLanguageLabels[uiLanguage][utterance.source.language]}</span><p>{utterance.source.text}</p>{utterance.source.language !== 'und' && <Button className="speech-button" variant="ghost" size="icon-sm" title={t('speak')} aria-label={t('speak')} onClick={(event) => { event.stopPropagation(); void playLanguage(utterance.source.language as Exclude<Language, 'und'>, utterance); }}><Volume2 /></Button>}</header>
            <div className="message-translations">{displayLanguages.filter((language) => language !== utterance.source.language).map((language) => <section className="translation-row" key={language}><strong>{languageFlags[language]} {spokenLanguageLabels[uiLanguage][language]}</strong>{utterance.id === activeUtterance.id ? <textarea aria-label={`${spokenLanguageLabels[uiLanguage][language]} ${t('editTurn')}`} value={utterance.translations[language].text} onClick={(event) => event.stopPropagation()} onChange={(event) => updateTranslation(language, event.target.value)} rows={2} /> : <p>{utterance.translations[language].text || '—'}</p>}<Button className="speech-button" variant="ghost" size="icon-sm" title={t('speak')} aria-label={t('speak')} onClick={(event) => { event.stopPropagation(); void playLanguage(language, utterance); }}><Volume2 /></Button></section>)}</div>
          </article>)}
        </div>
        <section className="composer-card">
          <InputGroup className="composer-input-row"><InputGroupTextarea value={activeUtterance.source.text} onChange={(event) => updateSource(event.target.value)} onBlur={() => { if (activeUtterance.source.text.trim() && !activeUtterance.source.confirmedAt && !isBusy) void translateCurrent(); }} placeholder={t('sourcePlaceholder')} rows={3} disabled={!acknowledged || recording || isBusy} /><InputGroupAddon className="desktop-record-addon"><Button className={`desktop-record ${recording ? 'recording' : ''}`} variant="default" size="icon" aria-label={recording ? t('stopRecording') : t('startRecording')} title={recording ? t('stopRecording') : t('startRecording')} onClick={toggleDesktopRecording} disabled={!acknowledged || (isBusy && !recording)}>{recording ? <Square /> : <Mic />}</Button></InputGroupAddon></InputGroup>
          <div className="record-dock mobile-record"><Button className={`hold-record ${recording ? 'recording' : ''}`} variant="default" aria-label={recording ? t('releaseToStop') : t('holdToRecord')} onPointerDown={(event) => { event.preventDefault(); void startRecording(); }} onPointerUp={stopRecording} onPointerCancel={stopRecording} onPointerLeave={(event) => { if (event.buttons) stopRecording(); }} disabled={!acknowledged || (isBusy && !recording)}><span>{recording ? <Square /> : <Mic />}</span><div>{recording ? t('releaseToStop') : t('holdToRecord')}<small>{recording ? t('recording') : t('automaticTranslation')}</small></div></Button></div>
        </section>
      </>}
    </section>

    <Sheet open={historyOpen} onOpenChange={setHistoryOpen}><SheetContent className="history-drawer" aria-label={t('conversationHistory')}><header><div><Image src={`${assetBasePath}/brand/institute-logo.png`} alt={t('instituteAlt')} width={388} height={95} /><SheetTitle>{t('conversationHistory')}</SheetTitle></div><SheetCloseButton /></header><Button className="drawer-new" onClick={createNewConversation} disabled={!acknowledged}>{t('newConversation')}</Button><Button className="drawer-import" variant="outline" onClick={() => importInputRef.current?.click()} disabled={!acknowledged}>{t('import')}</Button><ScrollArea className="min-h-0 flex-1"><nav>{conversations.length === 0 ? <p>{t('noConversations')}</p> : conversations.map((conversation) => <button key={conversation.id} className={conversation.id === activeId ? 'active' : ''} onClick={() => selectConversation(conversation)}><strong>{conversation.title}</strong><small>{conversation.utterances.filter((item) => item.source.text).length} · {new Date(conversation.updatedAt).toLocaleDateString(uiLanguage)}</small></button>)}</nav></ScrollArea><footer>© 2026 Zheng Haoyu</footer></SheetContent></Sheet>

    <Dialog open={exportOpen} onOpenChange={setExportOpen}><DialogContent className="export-modal"><DialogHeader><DialogTitle>{t('exportDialog')}</DialogTitle><DialogCloseButton aria-label={t('close')} /></DialogHeader><label>{t('exportFormat')}<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}><option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="md">Markdown (.md)</option><option value="json">JSON backup</option></select></label>{exportFormat !== 'json' && <label>{t('exportLanguage')}<select value={exportLanguage} onChange={(event) => setExportLanguage(event.target.value as ExportLanguage)}><option value="source">{t('sourceExport')}</option><option value="zh">{t('chineseExport')}</option><option value="fr">{t('frenchExport')}</option><option value="en">{t('englishExport')}</option></select></label>}<div className="modal-actions"><Button variant="secondary" onClick={() => setExportOpen(false)}>{t('cancel')}</Button><Button onClick={() => void submitExport()} disabled={Boolean(exporting)}>{exporting ? t('exporting') : t('confirmExport')}</Button></div></DialogContent></Dialog>

    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>{activeConversation && <DialogContent className="details-modal"><DialogHeader><DialogTitle>{t('conversationDetails')}</DialogTitle><DialogCloseButton aria-label={t('close')} /></DialogHeader><dl className="conversation-summary"><div><dt>{t('conversationTitle')}</dt><dd>{activeConversation.title}</dd></div><div><dt>{t('usage')}</dt><dd>{formatCost(totalCost)}</dd></div><div><dt>{t('requests')}</dt><dd>{activeConversation.usageEvents?.length ?? 0}</dd></div><div><dt>{t('liveTurn')}</dt><dd>{activeConversation.utterances.filter((item) => item.source.text.trim()).length}</dd></div></dl><p className="details-note">{t('estimate')}</p><div className="usage-events">{activeConversation.usageEvents?.length ? activeConversation.usageEvents.slice().reverse().map((event) => <article key={event.id}><strong>{event.operation.toUpperCase()}</strong><span>{event.model}</span><small>{new Date(event.createdAt).toLocaleString(uiLanguage)} · {event.inputTokens ?? event.characters ?? 0}{event.outputTokens !== undefined ? ` / ${event.outputTokens} tokens` : ''} · {formatCost(event.costUsd)}</small></article>) : <p>{t('noConversations')}</p>}</div></DialogContent>}</Dialog>

    <Dialog open={renameOpen} onOpenChange={setRenameOpen}><DialogContent className="rename-modal"><DialogHeader><DialogTitle>{t('renameConversation')}</DialogTitle><DialogCloseButton aria-label={t('close')} /></DialogHeader><label>{t('conversationTitle')}<input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveRename(); }} /></label><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameOpen(false)}>{t('cancel')}</Button><Button onClick={saveRename}>{t('save')}</Button></div></DialogContent></Dialog>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="settings-modal"><DialogHeader><DialogTitle>{t('apiSettings')}</DialogTitle><DialogCloseButton aria-label={t('close')} /></DialogHeader><p>{t('apiPrivacy')} <code>/v1</code>。</p><label>Base URL<input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} autoComplete="url" /></label><label>API Key<input value={config.apiKey} type="password" onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} autoComplete="off" placeholder="sk-…" /></label><div className="model-grid"><label>STT<input value={config.transcriptionModel} onChange={(event) => setConfig({ ...config, transcriptionModel: event.target.value })} /></label><label>Translation<input value={config.translationModel} onChange={(event) => setConfig({ ...config, translationModel: event.target.value })} /></label><label>TTS<input value={config.ttsModel} onChange={(event) => setConfig({ ...config, ttsModel: event.target.value })} /></label><label>Voice<input value={config.voice} onChange={(event) => setConfig({ ...config, voice: event.target.value })} /></label></div><fieldset className="price-grid"><legend>{t('pricing')}</legend><label>{t('sttPerMinute')}<input type="number" min="0" step="0.0001" value={config.pricing.sttPerMinute} onChange={(event) => updatePricing('sttPerMinute', event.target.value)} /></label><label>{t('textInputPerMillion')}<input type="number" min="0" step="0.01" value={config.pricing.textInputPerMillion} onChange={(event) => updatePricing('textInputPerMillion', event.target.value)} /></label><label>{t('textOutputPerMillion')}<input type="number" min="0" step="0.01" value={config.pricing.textOutputPerMillion} onChange={(event) => updatePricing('textOutputPerMillion', event.target.value)} /></label><label>{t('ttsPerCharacter')}<input type="number" min="0" step="0.000001" value={config.pricing.ttsPerCharacter} onChange={(event) => updatePricing('ttsPerCharacter', event.target.value)} /></label></fieldset><p className="pricing-notice">{t('pricingNotice')}</p><Button variant="secondary" onClick={() => void runApiTest()} disabled={isBusy}>{busy === 'testing' ? t('testing') : t('apiTest')}</Button><p className="test-result" aria-live="polite">{apiTestMessage}</p></DialogContent></Dialog>
    <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importConversation(event.target.files?.[0])} />
    {helpOpen && <OnboardingDialog language={uiLanguage} translate={t} secondsLeft={secondsLeft} required={!acknowledged} onAcknowledge={acknowledgeDisclaimer} onClose={() => setHelpOpen(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, resolveUploadUrl } from '../lib/api';
import { getChatPageContext, useChatPageContext, buildAssistantContext } from '../lib/chat-context';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import ChatSkillsPanel from './ChatSkillsPanel';
import VoiceOrb, { TextComposer } from './VoiceOrb';
import VoicePlanCard from './VoicePlanCard';
import ElementPicker from './ElementPicker';
import CopyTextButton from './CopyTextButton';

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';
const MAX_FILES = 8;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function AttachmentPreview({ file, onRemove }) {
  const isImage = file.type?.startsWith('image/');
  const preview = file.preview || (isImage && file instanceof File ? URL.createObjectURL(file) : null);

  return (
    <div className="relative group flex items-center gap-2 bg-white border border-neya-border rounded-lg px-3 py-2 text-sm">
      {preview ? (
        <img src={preview} alt="" className="w-10 h-10 rounded object-cover" />
      ) : (
        <span className="w-10 h-10 rounded bg-neya-cream flex items-center justify-center text-lg">📄</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neya-ink max-w-[140px]">{file.name}</p>
        <p className="text-xs text-neya-muted">{formatSize(file.size || 0)}</p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-neya-muted hover:text-neya-error text-lg leading-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((a, i) => {
        const url = a.url?.startsWith('http') ? a.url : resolveUploadUrl(a.url);
        const isImage = /image/i.test(a.type || a.name || '');
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border border-white/20 rounded-lg overflow-hidden hover:opacity-90"
          >
            {isImage ? (
              <img src={url} alt={a.name} className="max-h-32 max-w-[200px] object-cover" />
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 bg-black/10 text-xs">
                <span>📎</span>
                <span className="truncate max-w-[120px]">{a.name}</span>
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}

function VoiceResponseCard({ userText, reply, loading, contextLabel, onOpenChat, onDismiss, onAttach }) {
  if (!userText && !reply && !loading) return null;

  return (
    <div
      className="fixed z-[55] right-3 left-3 bottom-[calc(var(--dock-clearance)+4.25rem)] lg:left-auto lg:right-8 lg:bottom-28 lg:w-[min(360px,calc(100vw-12rem))] animate-voice-card-in"
      role="status"
      aria-live="polite"
    >
      <div className={`voice-halo-bubble relative ${loading ? 'voice-halo-bubble--busy' : ''}`}>
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-[18%] right-[18%] w-8 h-8 rounded-full bg-white/80 border border-neya-border text-neya-muted hover:text-neya-ink flex items-center justify-center text-lg leading-none"
          aria-label="Fermer"
        >
          ×
        </button>

        <div className="flex items-start justify-between gap-2 pr-8">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neya-orange mb-1">
            {loading ? 'En cours' : 'Lia'}
          </p>
          {!loading && reply && <CopyTextButton text={reply} className="-mt-1" />}
        </div>
        {contextLabel && (
          <p className="text-[10px] text-neya-muted mb-2 truncate max-w-[70%]">{contextLabel}</p>
        )}

        {userText && (
          <p className="text-[11px] text-neya-muted mb-2 line-clamp-2 max-w-[85%]">
            <span className="font-medium text-neya-ink">Vous :</span> {userText}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-2 text-sm text-neya-muted">
            <span className="voice-dots flex gap-1">
              <span /><span /><span />
            </span>
            Réflexion…
          </div>
        ) : (
          reply && <div className="voice-halo-bubble-body">{reply}</div>
        )}

        <div className="mt-3 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={onOpenChat}
            className="text-[11px] text-neya-orange font-medium hover:underline"
          >
            Historique
          </button>
          {onAttach && (
            <button
              type="button"
              onClick={onAttach}
              className="text-[11px] text-neya-muted font-medium hover:text-neya-orange"
            >
              📎 Joindre
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatAssistant() {
  const router = useRouter();
  const pageContext = useChatPageContext();
  const [expanded, setExpanded] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [voiceCard, setVoiceCard] = useState({ userText: '', reply: '', visible: false });
  const [voicePhase, setVoicePhase] = useState(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voicePlan, setVoicePlan] = useState(null);
  const [launcherMenuOpen, setLauncherMenuOpen] = useState(false);
  const [textComposerOpen, setTextComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [pickMode, setPickMode] = useState(false);
  const [pickedElement, setPickedElement] = useState(null);
  const pickedElementRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const sendingRef = useRef(false);

  const contextLabel = pickedElement?.label || pageContext?.label || null;

  useEffect(() => {
    pickedElementRef.current = pickedElement;
  }, [pickedElement]);

  useEffect(() => {
    api('/assistant/history')
      .then(history =>
        setMessages(
          history.map(m => ({
            role: m.role,
            content: m.content,
            attachments: typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments || [],
          }))
        )
      )
      .catch(() =>
        setMessages([
          {
            role: 'assistant',
            content:
              "Bonjour ! Je suis Lia, l'assistant NEYA.\n\nJe me souviens de notre conversation et je connais vos projets/clients.\n\n• Créer tâches, projets, dépenses\n• Planifier au calendrier\n• « Retiens que… » pour mémoriser une préférence\n• Joindre photos, plans PDF, reçus — Lia les lit, classe et range",
            attachments: [],
          },
        ])
      );
  }, []);

  useEffect(() => {
    if (expanded || mobileSheetOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, expanded, mobileSheetOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-bar-h', '0px');
  }, [expanded, mobileSheetOpen]);

  useEffect(() => {
    if (expanded || mobileSheetOpen) {
      setLauncherMenuOpen(false);
      setTextComposerOpen(false);
    }
  }, [expanded, mobileSheetOpen]);

  const scheduleDismiss = useCallback(() => {
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setVoiceCard(v => ({ ...v, visible: false }));
    }, 10000);
  }, []);

  useEffect(() => () => clearTimeout(dismissTimerRef.current), []);

  const sendMessage = useCallback(async (userMsg, sentFiles = []) => {
    if ((!userMsg.trim() && sentFiles.length === 0) || sendingRef.current) return;

    sendingRef.current = true;
    setLoading(true);
    // Pendant l'attente : pas de grosse carte — halo bleu seulement, navigation libre
    setVoiceCard({ userText: userMsg, reply: '', visible: false });
    setVoicePhase(null);

    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: userMsg,
        attachments: sentFiles.map(f => ({ name: f.name, type: f.type, size: f.size, preview: f.preview })),
      },
    ]);

    try {
      const form = new FormData();
      form.append('message', userMsg);
      sentFiles.forEach(f => form.append('files', f));
      const ctx = buildAssistantContext(pickedElementRef.current);
      if (ctx) form.append('context', JSON.stringify(ctx));

      const result = await api('/assistant/chat', { method: 'POST', body: form });

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply,
          attachments: result.attachments || [],
        },
      ]);

      // Réponse : popup une fois terminé
      setVoiceCard({ userText: userMsg, reply: result.reply, visible: true });
      scheduleDismiss();
      // Garder l'élément pointé jusqu'à clear manuel (plusieurs messages sur la même cible)

      if (result.actions?.length > 0) {
        const nav = result.actions.find(a => a.type === 'navigate');
        if (nav?.data?.href) {
          router.push(nav.data.href);
        }
        window.dispatchEvent(new CustomEvent('neya:assistant-action', { detail: result.actions }));
      }

      const attachRequest = result.actions?.find(a => a.type === 'request_attachment');
      if (attachRequest) {
        setTextComposerOpen(true);
        setTimeout(() => fileInputRef.current?.click(), 200);
      }
    } catch (err) {
      const errMsg = `Erreur : ${err.message}`;
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg, attachments: [] }]);
      setVoiceCard({ userText: userMsg, reply: errMsg, visible: true });
    } finally {
      setLoading(false);
      sendingRef.current = false;
      sentFiles.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
    }
  }, [scheduleDismiss, router]);

  const speech = useSpeechRecognition({ lang: 'fr-CA' });

  function cancelVoiceFlow() {
    if (speech.listening) speech.stop();
    setVoicePhase(null);
    setVoiceTranscript('');
    setVoicePlan(null);
  }

  function handleStopRecording() {
    // stop() renvoie finals + interim (refs) — ne pas lire le state React (trop tard)
    const full = (speech.stop() || speech.getFullText?.() || '').trim();
    if (!full) {
      setVoicePhase(null);
      setVoiceCard({
        userText: '',
        reply: 'Aucun texte capté. Réessayez ou utilisez « Écrire ».',
        visible: true,
      });
      scheduleDismiss();
      return;
    }
    setVoiceTranscript(full);
    setVoicePhase('reviewing');
  }

  async function handleBuildPlan() {
    const text = voiceTranscript.trim();
    if (!text) return;
    // Plan en arrière-plan : halo bleu, on peut naviguer
    setVoicePhase(null);
    setLoading(true);
    try {
      const ctx = buildAssistantContext(pickedElementRef.current);
      const plan = await api('/assistant/plan', {
        method: 'POST',
        body: JSON.stringify({ transcript: text, context: ctx }),
      });
      setVoicePlan(plan);
      if (plan.transcript) setVoiceTranscript(plan.transcript);
      setVoicePhase('plan_ready');
    } catch (err) {
      setVoicePhase('reviewing');
      setVoiceCard({
        userText: text,
        reply: `Plan indisponible (${err.message}). Corrigez le texte puis réessayez, ou envoyez via « Écrire ».`,
        visible: true,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmPlan() {
    const plan = voicePlan;
    const text = (plan?.transcript || voiceTranscript || '').trim();
    if (!text && !plan?.steps?.length) return;

    const actionable = (plan?.steps || []).filter(s => s?.action_type);
    // Plan structuré → exécuter les steps ERP (évite plan_day qui découpe la prose en 30 min)
    if (actionable.length > 0) {
      setVoicePhase('executing');
      setLoading(true);
      try {
        const ctx = buildAssistantContext(pickedElementRef.current);
        const result = await api('/assistant/execute-plan', {
          method: 'POST',
          body: JSON.stringify({ plan, context: ctx }),
        });
        const reply = result.reply || 'Plan exécuté.';
        setMessages(prev => [
          ...prev,
          { role: 'user', content: text || plan.summary || 'Exécuter le plan', attachments: [] },
          { role: 'assistant', content: reply, attachments: [] },
        ]);
        setVoiceCard({ userText: text || plan.summary || '', reply, visible: true });
        scheduleDismiss();
        if (result.actions?.length) {
          window.dispatchEvent(new CustomEvent('neya:assistant-action', { detail: result.actions }));
        }
        setVoicePhase(null);
        setVoicePlan(null);
      } catch (err) {
        setVoicePhase('plan_ready');
        setVoiceCard({
          userText: text,
          reply: `Exécution impossible (${err.message}). Réessayez ou envoyez via « Écrire ».`,
          visible: true,
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    setVoicePhase(null);
    setVoicePlan(null);
    await sendMessage(text);
  }

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming).slice(0, MAX_FILES - files.length);
    const enriched = list.map(f => Object.assign(f, {
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }));
    setFiles(prev => [...prev, ...enriched].slice(0, MAX_FILES));
    if (!textComposerOpen) {
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
        setExpanded(true);
      } else {
        setMobileSheetOpen(true);
      }
    }
  }, [files.length, textComposerOpen]);

  function removeFile(index) {
    setFiles(prev => {
      const next = [...prev];
      if (next[index]?.preview) URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }

  async function send() {
    if ((!input.trim() && files.length === 0) || loading) return;
    const userMsg = input.trim() || 'Pièces jointes';
    const sentFiles = [...files];
    setInput('');
    setFiles([]);
    setExpanded(true);
    await sendMessage(userMsg, sentFiles);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function openChatHistory() {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
    if (isDesktop) setExpanded(true);
    else setMobileSheetOpen(true);
    setVoiceCard(v => ({ ...v, visible: false }));
    setTextComposerOpen(false);
    setLauncherMenuOpen(false);
  }

  function closeLauncher() {
    setLauncherMenuOpen(false);
    setTextComposerOpen(false);
  }

  function handleSelectVoice() {
    setLauncherMenuOpen(false);
    setTextComposerOpen(false);

    if (speech.error) speech.clearError();

    if (!speech.supported) {
      setVoiceCard({
        userText: '',
        reply: 'Micro non disponible — utilisez « Écrire » ou Chrome/Edge.',
        visible: true,
      });
      scheduleDismiss();
      return;
    }

    setVoiceCard(v => ({ ...v, visible: false }));
    setVoicePlan(null);
    setVoiceTranscript('');
    setVoicePhase('recording');
    speech.start();
  }

  function handleSelectText() {
    setLauncherMenuOpen(false);
    setTextComposerOpen(true);
    if (speech.listening) speech.stop();
  }

  function handleSelectAttach() {
    setLauncherMenuOpen(false);
    setTextComposerOpen(true);
    setTimeout(() => fileInputRef.current?.click(), 150);
  }

  function handleSelectPickElement() {
    setLauncherMenuOpen(false);
    setTextComposerOpen(false);
    setPickMode(true);
  }

  function handleElementPicked(el) {
    setPickedElement(el);
    pickedElementRef.current = el;
    setPickMode(false);
    setTextComposerOpen(true);
    setComposerText((prev) => prev || '');
  }

  function clearPickedElement() {
    setPickedElement(null);
    pickedElementRef.current = null;
  }

  async function sendComposerText() {
    const text = composerText.trim();
    if ((!text && files.length === 0) || loading) return;
    const sentFiles = [...files];
    setComposerText('');
    setFiles([]);
    setTextComposerOpen(false);
    await sendMessage(text || 'Pièces jointes', sentFiles);
  }

  function handleOrbClick() {
    if (voicePhase === 'recording' || speech.listening) {
      handleStopRecording();
      return;
    }

    if (voicePhase === 'reviewing' || voicePhase === 'plan_ready') return;

    if (textComposerOpen) {
      setTextComposerOpen(false);
      return;
    }

    // Pendant l'IA ou s'il y a une dernière réponse : afficher/masquer la bulle ronde
    if (loading || voiceCard.userText || voiceCard.reply) {
      setLauncherMenuOpen(false);
      clearTimeout(dismissTimerRef.current);
      setVoiceCard(v => ({ ...v, visible: !v.visible }));
      return;
    }

    setLauncherMenuOpen(v => !v);
  }

  function handleOrbState() {
    if (speech.error) return 'error';
    if (loading) return 'processing';
    if (speech.listening || voicePhase === 'recording') return 'listening';
    return 'idle';
  }

  const suggestions = pageContext?.type === 'project'
    ? ['Cocher finition', 'Demain finition, mail client', 'Ajouter étape', 'Liste tâches']
    : pageContext?.type === 'client'
      ? ['Nouveau projet', 'Créer devis', 'Liste projets']
      : pageContext?.type === 'quote'
        ? ['Ajoute une ligne', 'Change le prix', 'Voir le devis', 'Retiens que…', 'Envoyer devis']
        : pageContext?.type === 'standard'
          ? ['Créer projet depuis cette fiche', 'Liste skills']
          : ['Demain finition banc olive, mail The NNS', 'Tâches du jour', 'Tâches demain', 'Liste projets'];

  const contextBadge = (pickedElement || pageContext) ? (
    <span className="text-[10px] px-1.5 py-0.5 border border-neya-border bg-neya-surface text-neya-muted truncate max-w-[200px]">
      {pickedElement ? `◎ ${pickedElement.label}` : pageContext.label}
    </span>
  ) : null;

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const chatPosition = 'fixed left-0 right-0 lg:left-[var(--sidebar-w)] z-[65] bottom-0';

  const chatOpen = expanded || mobileSheetOpen;
  const overlayOpen = chatOpen || textComposerOpen;
  const showAttachPrompt = voiceCard.reply?.includes('📎') || /joindre/i.test(voiceCard.reply || '');
  const showHaloBubble = !voicePhase && voiceCard.visible && (voiceCard.reply || loading || voiceCard.userText) && !overlayOpen && !launcherMenuOpen;

  const chatPanel = (onClose, isMobileSheet = false) => (
    <div
      className={`${chatPosition} ${isMobileSheet ? 'lg:hidden' : 'hidden lg:flex'} flex-col bg-white border-t border-neya-border ${
        isMobileSheet ? 'max-h-[85dvh] rounded-t' : 'max-h-none'
      }`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {isMobileSheet && (
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-neya-border" />
        </div>
      )}

      <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white text-neya-ink shrink-0 border-b border-neya-border">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <h3 className="font-heading text-base leading-tight">Lia</h3>
            <p className="text-[11px] text-neya-muted">Assistant · contexte ERP</p>
          </div>
          {contextBadge}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSkillsOpen(v => !v)}
              className="text-xs px-2.5 py-1 rounded-lg border border-neya-border hover:bg-white text-neya-muted"
              title="Gérer les skills"
            >
              ⚙
            </button>
            <ChatSkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neya-muted hover:text-neya-ink px-3 py-1 text-sm"
          >
            Fermer ▾
          </button>
        </div>
      </div>

      <div className={`overflow-hidden transition-[height] duration-300 ease-in-out shrink-0 h-[min(42dvh,360px)] lg:h-[min(50vh,480px)]`}>
        <div className={`h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-3 bg-neya-surface/40 ${dragOver ? 'ring-1 ring-inset ring-neya-border' : ''}`}>
          {dragOver && (
            <div className="text-center py-6 text-neya-muted text-sm">
              Déposez vos fichiers ici
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`relative max-w-[75%] px-3 py-2.5 rounded text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-neya-ink text-white'
                    : 'bg-white border border-neya-border text-neya-ink'
                }`}
              >
                {m.role === 'assistant' && m.content && (
                  <div className="flex justify-end -mt-0.5 -mr-1 mb-1">
                    <CopyTextButton text={m.content} />
                  </div>
                )}
                {m.content}
                <MessageAttachments attachments={m.attachments} />
              </div>
            </div>
          ))}

          {loading && <div className="text-sm text-neya-muted animate-pulse px-2">Réflexion…</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 sm:px-6 py-2 flex flex-wrap gap-2 bg-white border-t border-neya-border/50 shrink-0">
        {suggestions.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setInput(s)}
            className="text-xs bg-white border border-neya-border hover:bg-neya-surface px-2.5 py-1.5 text-neya-muted transition-colors min-h-[32px] sm:min-h-0"
          >
            {s}
          </button>
        ))}
      </div>

      {files.length > 0 && (
        <div className="px-6 py-2 flex flex-wrap gap-2 bg-white border-t border-neya-border/50 shrink-0">
          {files.map((f, i) => (
            <AttachmentPreview key={`${f.name}-${i}`} file={f} onRemove={() => removeFile(i)} />
          ))}
        </div>
      )}

      <div className="px-4 py-3 flex gap-2 items-end bg-white border-t border-neya-border shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={e => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded border border-neya-border hover:bg-neya-surface text-sm transition-colors"
          title="Joindre un fichier"
        >
          📎
        </button>

        <button
          type="button"
          onClick={handleSelectVoice}
          className={`shrink-0 w-10 h-10 flex items-center justify-center rounded border transition-colors ${
            speech.listening ? 'bg-neya-ink text-white border-neya-ink' : 'border-neya-border hover:bg-neya-surface'
          }`}
          title="Dictée vocale"
        >
          🎤
        </button>

        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Écrivez à l'assistant…"
          rows={2}
          className="input flex-1 resize-none text-base sm:text-sm py-3 sm:py-2.5 min-h-[48px] max-h-32"
        />

        <button
          type="button"
          onClick={send}
          disabled={loading || (!input.trim() && files.length === 0)}
          className="btn-primary shrink-0 h-11 px-5 disabled:opacity-40"
        >
          Envoyer
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Orbe vocal (mobile + PC) + carte réponse type Siri ── */}
      <VoiceOrb
        state={handleOrbState()}
        menuOpen={launcherMenuOpen}
        onOrbClick={handleOrbClick}
        onSelectVoice={handleSelectVoice}
        onSelectText={handleSelectText}
        onSelectAttach={handleSelectAttach}
        onSelectPickElement={handleSelectPickElement}
        onCloseMenu={() => setLauncherMenuOpen(false)}
        disabled={false}
      />

      <ElementPicker
        active={pickMode}
        onPick={handleElementPicked}
        onCancel={() => setPickMode(false)}
      />

      {pickedElement && !pickMode && (
        <div
          data-neya-picker-ignore
          className="fixed z-[61] left-3 right-3 bottom-[calc(var(--dock-clearance)+4.5rem)] lg:left-auto lg:right-28 lg:bottom-28 lg:w-[min(360px,calc(100vw-12rem))] pointer-events-auto"
        >
          <div className="flex items-start gap-2 px-3 py-2 bg-white border border-neya-border shadow-sm text-xs">
            <span className="shrink-0 text-neya-muted font-medium pt-0.5">Cible</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-neya-ink truncate">{pickedElement.label}</span>
              <span className="block text-neya-muted font-mono truncate">{pickedElement.selector}</span>
            </span>
            <button
              type="button"
              onClick={clearPickedElement}
              className="shrink-0 text-neya-muted hover:text-neya-ink px-1"
              aria-label="Retirer la cible"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {textComposerOpen && !chatOpen && (
        <>
          <button
            type="button"
            aria-label="Fermer la saisie"
            className="fixed inset-0 z-[57] bg-black/20 backdrop-blur-[1px] lg:bg-black/10"
            onClick={() => setTextComposerOpen(false)}
          />
          <TextComposer
            value={composerText}
            onChange={setComposerText}
            onSend={sendComposerText}
            onClose={() => setTextComposerOpen(false)}
            loading={loading}
            suggestions={
              pickedElement
                ? [
                    'Modifie cet élément',
                    'Rends-le plus visible',
                    'Explique ce que c’est',
                    ...suggestions.slice(0, 2),
                  ]
                : suggestions
            }
            contextLabel={contextLabel}
            files={files}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            fileInputRef={fileInputRef}
            accept={ACCEPT}
          />
        </>
      )}

      {/* Cartes interactives seulement (record / review / plan) — pas pendant l'attente */}
      {voicePhase && ['recording', 'reviewing', 'plan_ready'].includes(voicePhase) && !overlayOpen && (
        <VoicePlanCard
          phase={voicePhase}
          transcript={voiceTranscript}
          interim={speech.interim}
          plan={voicePlan}
          reply={voiceCard.reply}
          contextLabel={contextLabel}
          onTranscriptChange={setVoiceTranscript}
          onStopRecording={handleStopRecording}
          onCancel={cancelVoiceFlow}
          onBuildPlan={handleBuildPlan}
          onConfirmPlan={handleConfirmPlan}
          onOpenChat={() => {
            cancelVoiceFlow();
            openChatHistory();
          }}
        />
      )}

      {/* Bulle ronde : en cours (si ouverte) ou dernière réponse */}
      {showHaloBubble && (
        <VoiceResponseCard
          userText={voiceCard.userText}
          reply={voiceCard.reply}
          loading={loading && !voiceCard.reply}
          contextLabel={contextLabel}
          onOpenChat={openChatHistory}
          onDismiss={() => setVoiceCard(v => ({ ...v, visible: false }))}
          onAttach={showAttachPrompt && !loading ? handleSelectAttach : null}
        />
      )}

      {speech.error && !voicePhase && !overlayOpen && !launcherMenuOpen && (
        <VoiceResponseCard
          userText=""
          reply={speech.error}
          loading={false}
          contextLabel={null}
          onOpenChat={() => {
            speech.clearError();
            openChatHistory();
          }}
          onDismiss={() => speech.clearError()}
        />
      )}

      {mobileSheetOpen && (
        <>
          <button
            type="button"
            aria-label="Fermer l'assistant"
            className="lg:hidden fixed inset-0 z-[64] bg-black/30 backdrop-blur-[2px]"
            onClick={() => setMobileSheetOpen(false)}
          />
          {chatPanel(() => setMobileSheetOpen(false), true)}
        </>
      )}

      {/* ── PC : panneau chat (historique) — ouvert via carte ou historique ── */}
      {expanded && (
        <>
          <button
            type="button"
            aria-label="Fermer l'assistant"
            className="hidden lg:block fixed inset-0 z-[49] bg-black/20 backdrop-blur-[1px]"
            onClick={() => setExpanded(false)}
          />
          {chatPanel(() => setExpanded(false), false)}
        </>
      )}
    </>
  );
}

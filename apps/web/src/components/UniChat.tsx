'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, History, Mic, MicOff, Plus, Send, Sparkles, X } from 'lucide-react';
import { Badge, Button, Mascot, SlideOver, cn, toast } from '@texafashions/ui';
import type { UniCard, UniEvent, UniTurn } from '@texafashions/types';
import { data } from '@/lib/data';

const STARTERS = [
  'How were sales across all stores this week?',
  'Which items are low on stock at WH-CENTRAL?',
  'Show open purchase orders',
  'What was the cash variance yesterday?',
];

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

type Msg = UniTurn & { streaming?: boolean; tool?: string };
type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };

function useVoice(onText: (t: string) => void) {
  const [listening, setListening] = React.useState(false);
  const rec = React.useRef<SpeechRec | null>(null);
  const supported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const r: SpeechRec = new Ctor(); r.lang = 'en-IN'; r.interimResults = true;
    r.onresult = (e) => onText(Array.from(e.results as ArrayLike<any>).map((x) => x[0].transcript).join(' '));
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  };
  return { supported, listening, toggle };
}

/** `seed` (from a notification's "Ask why") starts a fresh chat with that question; `n` makes repeat asks distinct. */
export function UniChat({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: { n: number; text: string } | null }) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [chatId, setChatId] = React.useState<string | null>(null);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const voice = useVoice(setInput);
  const chats = useQuery({ queryKey: ['ai-chats'], queryFn: () => data().ai.listChats(), enabled: open && showHistory });
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  async function send(text: string) {
    const q = text.trim(); if (!q || busy) return;
    setInput(''); setBusy(true);
    const history = [...msgs.filter((m) => m.text), { role: 'user' as const, text: q }];
    setMsgs([...history, { role: 'assistant', text: '', cards: [], streaming: true }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((s) => s.map((m, i) => (i === s.length - 1 ? fn(m) : m)));
    try {
      await data().ai.chat(history.map(({ role, text: t }) => ({ role, text: t })), chatId, (e: UniEvent) => {
        if (e.type === 'text') patch((m) => ({ ...m, text: m.text + e.delta, tool: undefined }));
        else if (e.type === 'tool') patch((m) => ({ ...m, tool: e.name }));
        else if (e.type === 'card') patch((m) => ({ ...m, cards: [...(m.cards ?? []), e.card], tool: undefined }));
        else if (e.type === 'done') { setChatId(e.chatId); void qc.invalidateQueries({ queryKey: ['ai-chats'] }); }
        else if (e.type === 'error') patch((m) => ({ ...m, text: e.message }));
      });
    } catch (err) { patch((m) => ({ ...m, text: (err as Error).message || 'Uni is unavailable right now.' })); }
    patch((m) => ({ ...m, streaming: false, tool: undefined })); setBusy(false);
  }

  const sentSeed = React.useRef(0);
  React.useEffect(() => {
    if (!open || !seed || sentSeed.current === seed.n || busy) return;
    sentSeed.current = seed.n; setMsgs([]); setChatId(null); setShowHistory(false);
    // `send` reads `msgs`, which is stale until the reset lands — defer one tick.
    setTimeout(() => void send(seed.text), 0);
  }, [open, seed]);

  const newChat = () => { setMsgs([]); setChatId(null); setShowHistory(false); };

  return (
    <SlideOver open={open} onClose={onClose} width={460} title={
      <span className="flex items-center gap-2"><Sparkles className="size-5 text-cherry" /> Uni <Badge tone="lavender">AI teammate</Badge></span>
    }>
      <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
        <div className="flex items-center justify-between border-b border-line/50 px-4 py-2">
          <Button variant="ghost" size="sm" onClick={newChat}><Plus className="size-4" /> New chat</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory}><History className="size-4" /> History</Button>
        </div>

        {showHistory ? (
          <ul className="flex-1 space-y-2 overflow-y-auto p-4">
            {chats.isLoading && <li className="text-sm text-soft">Loading…</li>}
            {chats.data?.length === 0 && <li className="text-sm text-soft">No saved chats yet.</li>}
            {chats.data?.map((c) => (
              <li key={c.id}>
                <button className="w-full rounded-2xl bg-white/60 px-4 py-3 text-left text-sm hover:bg-white" onClick={() => { setMsgs(c.messages); setChatId(c.id); setShowHistory(false); }}>
                  <span className="line-clamp-1 font-medium">{c.title}</span>
                  <span className="text-xs text-soft">{c.messages.length} messages</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {msgs.length === 0 && (
              <div className="flex flex-col items-center gap-3 pt-4 text-center">
                <Mascot kind="bunny" size={96} />
                <p className="font-display text-lg">Hi! I’m Uni ✨</p>
                <p className="max-w-xs text-sm text-soft">Ask about sales, stock, POs, cash or P&amp;L. I can also draft a requisition or vouchers — you confirm before anything happens.</p>
                <div className="mt-2 grid w-full gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => void send(s)} className="rounded-2xl bg-white/70 px-4 py-2.5 text-left text-sm shadow-soft transition hover:bg-white">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => <Bubble key={i} m={m} />)}
            <div ref={endRef} />
          </div>
        )}

        <form className="flex items-center gap-2 border-t border-line/50 p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          {voice.supported && (
            <Button type="button" variant={voice.listening ? 'danger' : 'soft'} size="sm" onClick={voice.toggle} aria-label={voice.listening ? 'Stop listening' : 'Speak your question'}>
              {voice.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </Button>
          )}
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={voice.listening ? 'Listening…' : 'Ask Uni anything…'} aria-label="Message Uni"
            className="h-11 min-w-0 flex-1 rounded-full border border-line bg-white/80 px-4 text-sm outline-none focus:border-cherry" />
          <Button type="submit" size="sm" disabled={busy || !input.trim()} aria-label="Send"><Send className="size-4" /></Button>
        </form>
      </div>
    </SlideOver>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === 'user';
  return (
    <div className={cn('flex flex-col gap-2', mine ? 'items-end' : 'items-start')}>
      {(m.text || m.streaming) && (
        <div className={cn('max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-sm', mine ? 'bg-cherry text-white' : 'bg-white/80 text-ink shadow-soft')}>
          {m.text || (m.tool ? `Checking ${m.tool}…` : 'Thinking…')}
          {m.streaming && m.text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-cherry/60 align-middle" />}
        </div>
      )}
      {m.cards?.map((c, i) => <CardView key={i} card={c} />)}
    </div>
  );
}

function CardView({ card }: { card: UniCard }) {
  if (card.kind === 'note') return <div className="max-w-[88%] rounded-2xl bg-butter/60 px-4 py-2 text-sm">{card.text}</div>;
  if (card.kind === 'confirm') return <ConfirmCard card={card} />;
  return (
    <div className="w-full rounded-2xl bg-white/80 p-4 shadow-soft">
      <p className="mb-2 text-sm font-medium">{card.title}</p>
      {card.kind === 'table' ? <MiniTable card={card} /> : <MiniChart card={card} />}
      <Link href={card.source.href} className="mt-3 inline-flex items-center gap-1 text-xs text-cherry hover:underline">Source: {card.source.label} <ArrowUpRight className="size-3" /></Link>
    </div>
  );
}

function MiniTable({ card }: { card: Extract<UniCard, { kind: 'table' }> }) {
  if (!card.rows.length) return <p className="text-sm text-soft">Nothing to show.</p>;
  return (
    <div className="max-h-56 overflow-auto rounded-xl border border-line/60">
      <table className="w-full text-left text-xs tabular-nums">
        <thead className="sticky top-0 bg-blush/40"><tr>{card.columns.map((c) => <th key={c} className="px-2.5 py-1.5 font-medium">{c}</th>)}</tr></thead>
        <tbody>{card.rows.map((r, i) => <tr key={i} className="border-t border-line/40">{r.map((v, j) => <td key={j} className="px-2.5 py-1.5">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function MiniChart({ card }: { card: Extract<UniCard, { kind: 'chart' }> }) {
  const max = Math.max(1, ...card.points.map((p) => p.value));
  if (!card.points.length) return <p className="text-sm text-soft">No sales in that range.</p>;
  return (
    <div className="flex h-28 items-end gap-1.5" role="img" aria-label={card.title}>
      {card.points.map((p) => (
        <div key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${p.label}: ${card.unit === 'paise' ? inr(p.value) : p.value}`}>
          <div className="w-full rounded-t-lg bg-gradient-to-t from-cherry/70 to-blush" style={{ height: `${Math.max(4, (p.value / max) * 88)}px` }} />
          <span className="text-[10px] text-soft">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function ConfirmCard({ card }: { card: Extract<UniCard, { kind: 'confirm' }> }) {
  const [state, setState] = React.useState<'idle' | 'working' | 'done' | 'cancelled'>('idle');
  const [result, setResult] = React.useState('');
  async function confirm() {
    setState('working');
    try {
      // The real callable re-checks the caller's claims; Uni never writes on its own.
      const r = card.command === 'createPR'
        ? await data().scm.command('createPR', card.input as never)
        : await data().pos.command('issueVouchers', card.input as never);
      setResult(card.command === 'createPR' ? `${String(r.number)} · ${String(r.status).replace(/_/g, ' ')}` : `${String(r.count)} voucher codes issued`);
      setState('done'); toast('Done — created via Uni', 'ok');
    } catch (e) { setState('idle'); toast((e as Error).message, 'err'); }
  }
  return (
    <div className="w-full rounded-2xl border border-cherry/30 bg-blush/30 p-4">
      <p className="text-sm font-medium">{card.title}</p>
      <ul className="my-2 list-disc pl-5 text-sm">{card.summary.map((s) => <li key={s}>{s}</li>)}</ul>
      {state === 'done' ? <p className="flex items-center gap-1 text-sm text-ink"><Check className="size-4 text-cherry" /> {result}</p>
        : state === 'cancelled' ? <p className="text-sm text-soft">Cancelled — nothing was changed.</p>
        : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirm()} loading={state === 'working'}><Check className="size-4" /> Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => setState('cancelled')} disabled={state === 'working'}><X className="size-4" /> Cancel</Button>
          </div>
        )}
    </div>
  );
}

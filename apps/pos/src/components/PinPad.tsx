'use client';
import * as React from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@texafashions/ui';

/** Numeric keypad used for PINs, amounts and quantities. */
export function PinPad({ value, onChange, onSubmit, max = 6, mask = true, disabled }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; max?: number; mask?: boolean; disabled?: boolean }) {
  // keep the latest value in a ref so fast typing (scanner / keyboard) never works from a stale closure
  const cur = React.useRef(value); cur.current = value;
  const press = (k: string) => {
    if (disabled) return;
    const v = cur.current;
    const next = k === '⌫' ? v.slice(0, -1) : v.length < max ? v + k : v;
    cur.current = next; onChange(next);
  };
  // one stable listener (re-registering per render drops keys that arrive between commit and effect flush)
  const latest = React.useRef({ press, onSubmit, disabled }); latest.current = { press, onSubmit, disabled };
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const l = latest.current; if (l.disabled) return;
      if (/^\d$/.test(e.key)) l.press(e.key); else if (e.key === 'Backspace') l.press('⌫'); else if (e.key === 'Enter' && l.onSubmit) l.onSubmit();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="w-full max-w-[300px]">
      <div className="mb-4 flex h-12 items-center justify-center gap-3" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(4, Math.min(max, value.length + 1)) }).map((_, i) => (
          <span key={i} className={cn('grid size-4 place-items-center rounded-full border-2 border-ink/30 text-lg transition-all', i < value.length && 'scale-110 border-cherry bg-cherry')}>
            {!mask && i < value.length ? <span className="text-ink">{value[i]}</span> : null}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === '' ? <span key={i} /> : (
          <button key={i} type="button" onClick={() => press(k)} aria-label={k === '⌫' ? 'Backspace' : k}
            className="grid h-16 place-items-center rounded-2xl bg-card text-2xl font-medium shadow-soft transition active:scale-95 active:bg-blush/60">
            {k === '⌫' ? <Delete className="size-6" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

'use client';
import * as React from 'react';
import { motion, MotionConfig, AnimatePresence, useMotionValue, animate, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';

export const MotionRoot = ({ children }: { children: React.ReactNode }) => <MotionConfig reducedMotion="user">{children}</MotionConfig>;

/* ───────── Button (pill, squish) */
type BtnVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'outline';
export interface ButtonProps extends Omit<React.ComponentProps<typeof motion.button>, 'children'> {
  variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; children?: React.ReactNode; loading?: boolean;
}
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-pill font-medium select-none transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';
const btnVar: Record<BtnVariant, string> = {
  primary: 'bg-cherry text-cherry-ink shadow-pop hover:brightness-105',
  soft: 'bg-blush/60 text-ink hover:bg-blush',
  ghost: 'text-ink hover:bg-card2',
  danger: 'bg-ink text-bg hover:opacity-90',
  outline: 'border border-line bg-card text-ink hover:bg-card2',
};
const btnSize = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-5 text-sm', lg: 'h-12 px-7 text-base' };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', className, loading, children, disabled, ...p }, ref) {
  return (
    <motion.button ref={ref} whileTap={{ scale: 0.95 }} whileHover={{ y: -1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      className={cn(btnBase, btnVar[variant], btnSize[size], className)} disabled={disabled || loading} {...p}>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </motion.button>
  );
});

/* ───────── Card */
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card bg-card p-6 shadow-soft border border-line/60', className)} {...p}>{children}</div>;
}
export function StaggerGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((c, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, type: 'spring', stiffness: 260, damping: 24 }}>{c}</motion.div>
      ))}
    </div>
  );
}

/* ───────── Badge */
const tone = { blush: 'bg-blush/70', butter: 'bg-butter/80', mint: 'bg-mint/80', sky: 'bg-sky/80', lavender: 'bg-lavender/80', ink: 'bg-ink text-bg', cherry: 'bg-cherry text-cherry-ink' } as const;
export function Badge({ tone: t = 'lavender', className, children }: { tone?: keyof typeof tone; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium text-ink', tone[t], className)}>{children}</span>;
}

/* ───────── Form controls */
const field = 'h-10 w-full rounded-2xl border border-line bg-card px-3.5 text-sm text-ink placeholder:text-soft/70 focus:border-cherry focus:outline-none focus:ring-2 focus:ring-cherry/20 disabled:opacity-60';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} className={cn(field, className)} {...p} />; });
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) { return <select ref={ref} className={cn(field, 'pr-8', className)} {...p}>{children}</select>; });
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cn(field, 'h-auto min-h-24 py-2.5 font-mono text-xs', className)} {...p} />; });
export function Field({ label, error, help, required, children, className }: { label: string; error?: string; help?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-soft">{label}{required && <span className="text-cherry"> *</span>}</span>
      {children}
      {error ? <span role="alert" className="text-xs text-cherry">{error}</span> : help ? <span className="text-xs text-soft">{help}</span> : null}
    </label>
  );
}

/* ───────── Skeleton (give it the size of the content it replaces) */
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} aria-hidden />;

/* ───────── KPI count-up */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString('en-IN'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(0);
  const [txt, setTxt] = React.useState(format(0));
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (reduce) { setTxt(format(value)); return; }
    const c = animate(mv, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setTxt(format(v)) });
    return () => c.stop();
  }, [value, reduce]);
  return <span className={cn('tabular-nums', className)}>{txt}</span>;
}
export function Kpi({ label, value, format, hint, tone: t = 'blush' }: { label: string; value: number; format?: (n: number) => string; hint?: string; tone?: keyof typeof tone }) {
  return (
    <Card className="relative overflow-hidden">
      <div className={cn('absolute -right-6 -top-6 size-24 rounded-full opacity-70', tone[t])} />
      <p className="text-xs font-medium text-soft">{label}</p>
      <CountUp value={value} format={format} className="font-display mt-1 block text-3xl" />
      {hint && <p className="mt-1 text-xs text-soft">{hint}</p>}
    </Card>
  );
}

/* ───────── Slide-over / Dialog (glass) */
export function SlideOver({ open, onClose, title, children, width = 480, side = 'right' }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number; side?: 'right' | 'left' }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
            className={cn('glass absolute top-0 flex h-full max-w-full flex-col shadow-soft', side === 'right' ? 'right-0 rounded-l-[24px]' : 'left-0 rounded-r-[24px]')}
            style={{ width }} initial={{ x: side === 'right' ? '100%' : '-100%' }} animate={{ x: 0 }} exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
            <header className="flex items-center justify-between border-b border-line/60 px-6 py-4">
              <h2 className="font-display text-lg">{title}</h2>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
            </header>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const titleId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('glass relative max-h-[90dvh] w-full overflow-y-auto rounded-[24px] p-6 shadow-soft', wide ? 'max-w-4xl' : 'max-w-lg')}
            initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <div className="mb-4 flex items-center justify-between"><h2 id={titleId} className="font-display text-xl">{title}</h2>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="size-4" /></Button></div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ───────── Toasts (wobble) */
type Toast = { id: number; msg: string; kind: 'ok' | 'err' | 'info' };
const listeners = new Set<(t: Toast) => void>();
let tid = 0;
export const toast = (msg: string, kind: Toast['kind'] = 'info') => listeners.forEach((l) => l({ id: ++tid, msg, kind }));
export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    const l = (t: Toast) => { setItems((s) => [...s, t]); setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4500); };
    listeners.add(l); return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 40, rotate: 4 }} animate={{ opacity: 1, x: 0, rotate: [4, -3, 2, 0] }} exit={{ opacity: 0, x: 40 }} transition={{ x: { type: 'spring', stiffness: 400, damping: 22 }, opacity: { duration: 0.2 }, rotate: { duration: 0.5, ease: 'easeOut' } }}
            className={cn('glass pointer-events-auto max-w-sm whitespace-pre-line rounded-2xl px-4 py-3 text-sm shadow-soft', t.kind === 'err' && 'border-cherry/60', t.kind === 'ok' && 'border-mint')}>
            {t.kind === 'ok' ? '✓ ' : t.kind === 'err' ? '⚠ ' : ''}{t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ───────── Tabs */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-pill bg-card2 p-1" role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn('relative rounded-pill px-4 py-1.5 text-sm', value === i.value ? 'text-ink' : 'text-soft')}>
          {value === i.value && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-pill bg-card shadow-soft" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
          <span className="relative">{i.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────── Document-flow stepper with travelling dot */
export function FlowStepper({ steps, current, subs }: { steps: string[]; current: number; subs?: (string | undefined)[] }) {
  return (
    <ol className="flex items-center gap-0 overflow-x-auto py-2" aria-label="Document flow">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <motion.div initial={false} animate={{ scale: i === current ? 1.15 : 1 }}
              className={cn('grid size-8 place-items-center rounded-full text-xs font-semibold', i < current ? 'bg-mint' : i === current ? 'bg-cherry text-cherry-ink pulse-crit' : 'bg-card2 text-soft border border-line')}>
              {i < current ? '✓' : i + 1}
            </motion.div>
            <span className={cn('text-[11px]', i === current ? 'font-semibold' : 'text-soft')}>{s}</span>
            {subs?.[i] && <span className="max-w-[96px] truncate text-[10px] text-soft" title={subs[i]}>{subs[i]}</span>}
          </div>
          {i < steps.length - 1 && (
            <div className="relative mx-1 mb-5 h-0.5 w-10 bg-line sm:w-14">
              <motion.div className="absolute inset-y-0 left-0 bg-mint" initial={false} animate={{ width: i < current ? '100%' : '0%' }} transition={{ duration: 0.5 }} />
              {i === current - 1 && <motion.span className="absolute -top-[3px] size-2 rounded-full bg-cherry" animate={{ left: ['0%', '100%'] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }} />}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

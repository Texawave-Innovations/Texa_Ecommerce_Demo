'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge, Bear, Bunny, Button, Capybara, Card, CountUp, Dialog, EmptyState, Field, FlowStepper, Input, Kpi, MascotLoader, Select, Skeleton, SlideOver, StaggerGrid, Tabs, toast } from '@texafashions/ui';
import { useTheme } from '@/lib/stores';

const PALETTE = [['background', '--bg'], ['blush', '--blush'], ['butter', '--butter'], ['mint', '--mint'], ['sky', '--sky'], ['lavender', '--lavender'], ['ink', '--ink'], ['cherry', '--cherry']] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-4"><h2 className="font-display text-2xl">{title}</h2>{children}</section>;
}

export default function DesignPage() {
  const { theme, toggle } = useTheme();
  const [dlg, setDlg] = React.useState(false);
  const [so, setSo] = React.useState(false);
  const [tab, setTab] = React.useState<'a' | 'b' | 'c'>('a');
  const [step, setStep] = React.useState(2);
  const [n, setN] = React.useState(128_450);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="font-display text-4xl">Texa Soft <span className="text-2xl text-soft">Design</span></h1><p className="text-sm text-soft">Every component &amp; animation used in Texa Fashions OS. Honours prefers-reduced-motion.</p></div>
        <Button variant="outline" onClick={toggle}>{theme === 'dark' ? '☀ Light' : '🌙 Night mode'}</Button>
      </header>

      <Section title="Colour tokens"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{PALETTE.map(([name, v]) => <div key={name} className="overflow-hidden rounded-card border border-line"><div className="h-16" style={{ background: `var(${v})` }} /><p className="p-3 text-sm">{name}<br /><code className="text-xs text-soft">{v}</code></p></div>)}</div></Section>

      <Section title="Typography">
        <Card><p className="font-display text-4xl">Fredoka display — Cute &amp; round</p><p className="mt-2">Inter UI text with tabular numbers: <span className="num inline-block w-28">₹1,23,456.00</span> <span className="num inline-block w-28">₹ 9,99.50</span></p><p className="mt-2 text-xl">Noto Sans — Texa cute lifestyle</p></Card>
      </Section>

      <Section title="Buttons (pill, squish on press)"><div className="flex flex-wrap gap-3"><Button>Primary</Button><Button variant="soft">Soft</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Dark</Button><Button loading>Loading</Button><Button size="sm">Small</Button><Button size="lg">Large</Button></div></Section>

      <Section title="Form controls"><Card className="grid gap-4 sm:grid-cols-3"><Field label="Text" required><Input placeholder="Capybara plush" /></Field><Field label="Select"><Select><option>UPI</option><option>Card</option></Select></Field><Field label="With error" error="This field is required"><Input /></Field></Card></Section>

      <Section title="KPI count-up &amp; staggered cards">
        <StaggerGrid className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Kpi label="Net sales" value={n} format={(v) => '₹' + Math.round(v).toLocaleString('en-IN')} tone="blush" /><Kpi label="Orders" value={342} tone="mint" /><Kpi label="UPT" value={2.4} format={(v) => v.toFixed(1)} tone="sky" /><Kpi label="Conversion" value={31.5} format={(v) => v.toFixed(1) + '%'} tone="butter" /></StaggerGrid>
        <Button variant="soft" className="self-start" onClick={() => setN(Math.round(100_000 + Math.random() * 200_000))}>Update value</Button>
        <p className="text-sm text-soft">Live number: <CountUp value={n} className="font-display text-lg" /></p>
      </Section>

      <Section title="Badges &amp; tabs"><div className="flex flex-wrap items-center gap-2"><Badge tone="blush">Blush</Badge><Badge tone="butter">Butter</Badge><Badge tone="mint">Mint</Badge><Badge tone="sky">Sky</Badge><Badge tone="lavender">Lavender</Badge><Badge tone="cherry">Critical</Badge><Badge tone="ink">Ink</Badge></div>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'a', label: 'Overview' }, { value: 'b', label: 'Details' }, { value: 'c', label: 'History' }]} /></Section>

      <Section title="Document-flow stepper (travelling dot)"><Card><FlowStepper steps={['PR', 'PO', 'ASN', 'GRN', 'QC', 'Invoice', 'Paid']} current={step} /><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button><Button size="sm" onClick={() => setStep((s) => Math.min(7, s + 1))}>Advance</Button></div></Card></Section>

      <Section title="Overlays &amp; toasts"><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setDlg(true)}>Dialog</Button><Button variant="outline" onClick={() => setSo(true)}>Slide-over</Button><Button variant="soft" onClick={() => toast('Saved! (wobble)', 'ok')}>Toast ok</Button><Button variant="soft" onClick={() => toast('Something went wrong', 'err')}>Toast error</Button></div>
        <Dialog open={dlg} onClose={() => setDlg(false)} title="Glass dialog"><p className="text-sm text-soft">Glassmorphism for overlays. Escape or click outside to close.</p></Dialog>
        <SlideOver open={so} onClose={() => setSo(false)} title="Glass slide-over"><p className="text-sm text-soft">Used by forms, history, and the AI panel.</p></SlideOver></Section>

      <Section title="Mascots, loaders &amp; empty states"><div className="grid gap-4 sm:grid-cols-2"><Card className="flex items-end justify-center gap-3"><Bunny /><Bear /><Capybara /></Card><Card><MascotLoader label="Mascot loader" /></Card><Card className="sm:col-span-2"><EmptyState kind="capybara" title="Nothing here yet" hint="Empty states always get a friendly mascot." /></Card></div></Section>

      <Section title="Skeletons &amp; critical pulse"><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><div className="grid h-24 place-items-center rounded-card bg-cherry text-cherry-ink pulse-crit">Critical alert</div></div></Section>

      <Section title="Motion"><motion.div className="grid size-16 place-items-center rounded-2xl bg-lavender" animate={{ rotate: [0, 8, -8, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>🧸</motion.div></Section>
    </main>
  );
}

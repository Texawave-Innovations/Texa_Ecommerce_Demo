import * as React from 'react';
import { motion } from 'framer-motion';

type MascotProps = { size?: number; className?: string };
const ink = '#2B2633';

export const Bear = ({ size = 96, className }: MascotProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Bear mascot">
    <circle cx="26" cy="28" r="13" fill="#F7C6D0" stroke={ink} strokeWidth="3" /><circle cx="74" cy="28" r="13" fill="#F7C6D0" stroke={ink} strokeWidth="3" />
    <circle cx="50" cy="54" r="34" fill="#FCE7A8" stroke={ink} strokeWidth="3" />
    <ellipse cx="50" cy="66" rx="14" ry="10" fill="#FFFBF7" stroke={ink} strokeWidth="3" />
    <circle cx="38" cy="50" r="3.5" fill={ink} /><circle cx="62" cy="50" r="3.5" fill={ink} />
    <ellipse cx="50" cy="62" rx="4.5" ry="3" fill={ink} /><path d="M44 70q6 5 12 0" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" />
    <circle cx="30" cy="62" r="5" fill="#F7C6D0" opacity=".7" /><circle cx="70" cy="62" r="5" fill="#F7C6D0" opacity=".7" />
  </svg>
);
export const Bunny = ({ size = 96, className }: MascotProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Bunny mascot">
    <ellipse cx="36" cy="22" rx="9" ry="22" fill="#D9CCF2" stroke={ink} strokeWidth="3" /><ellipse cx="64" cy="22" rx="9" ry="22" fill="#D9CCF2" stroke={ink} strokeWidth="3" />
    <ellipse cx="36" cy="24" rx="4" ry="14" fill="#F7C6D0" /><ellipse cx="64" cy="24" rx="4" ry="14" fill="#F7C6D0" />
    <circle cx="50" cy="62" r="30" fill="#FFFBF7" stroke={ink} strokeWidth="3" />
    <circle cx="39" cy="58" r="3.5" fill={ink} /><circle cx="61" cy="58" r="3.5" fill={ink} />
    <path d="M46 67l4 3 4-3" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="30" cy="68" r="5" fill="#F7C6D0" opacity=".8" /><circle cx="70" cy="68" r="5" fill="#F7C6D0" opacity=".8" />
  </svg>
);
export const Capybara = ({ size = 96, className }: MascotProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Capybara mascot">
    <ellipse cx="50" cy="60" rx="38" ry="28" fill="#E8C9A0" stroke={ink} strokeWidth="3" />
    <circle cx="24" cy="36" r="7" fill="#E8C9A0" stroke={ink} strokeWidth="3" /><circle cx="76" cy="36" r="7" fill="#E8C9A0" stroke={ink} strokeWidth="3" />
    <ellipse cx="50" cy="68" rx="20" ry="13" fill="#F5E3C8" stroke={ink} strokeWidth="3" />
    <circle cx="34" cy="52" r="3.5" fill={ink} /><circle cx="66" cy="52" r="3.5" fill={ink} />
    <ellipse cx="50" cy="62" rx="6" ry="4" fill={ink} /><path d="M45 72q5 4 10 0" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M44 18q6-8 12 0" stroke="#BFE6D6" strokeWidth="8" fill="none" strokeLinecap="round" />
  </svg>
);

export type MascotKind = 'bear' | 'bunny' | 'capybara';
const M = { bear: Bear, bunny: Bunny, capybara: Capybara };
export function Mascot({ kind = 'bear', size = 96, bob = true, className }: MascotProps & { kind?: MascotKind; bob?: boolean }) {
  const C = M[kind];
  return <motion.div className={className} animate={bob ? { y: [0, -6, 0] } : undefined} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}><C size={size} /></motion.div>;
}
export function EmptyState({ title, hint, kind = 'bear', action }: { title: string; hint?: string; kind?: MascotKind; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Mascot kind={kind} size={96} />
      <h3 className="font-display text-lg">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-soft">{hint}</p>}
      {action}
    </div>
  );
}
export function MascotLoader({ label = 'Loading…' }: { label?: string }) {
  const kinds: MascotKind[] = ['bear', 'bunny', 'capybara'];
  const [i, setI] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % 3), 900); return () => clearInterval(t); }, []);
  return <div className="flex flex-col items-center gap-2 py-10" role="status"><Mascot kind={kinds[i]!} size={72} /><p className="text-sm text-soft">{label}</p></div>;
}

'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Bear, Bunny, Capybara, Card, Mascot, toast } from '@texafashions/ui';
import { DEMO_USERS, ROLE_LABELS, type Role } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { FEATURED_ROLES, ROLE_MASCOT, ROLE_TINT, landingFor } from '@/lib/landing';

export default function LoginPage() {
  const router = useRouter();
  const session = useSession((s) => s.session);
  const [busy, setBusy] = React.useState<Role | null>(null);
  const [more, setMore] = React.useState(false);
  const shown = DEMO_USERS.filter((u) => FEATURED_ROLES.includes(u.role) || more);
  React.useEffect(() => { if (session) router.replace(landingFor(session.claims.role)); }, [session, router]);

  async function go(role: Role) {
    setBusy(role);
    try { await data().auth.demoSignIn(role); }
    catch (e) { toast((e as Error).message + '\n(Check the NEXT_PUBLIC_FIREBASE_* env vars and that functions are deployed)', 'err'); setBusy(null); }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-8 px-4 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-end gap-2"><Bunny size={64} /><Bear size={88} /><Capybara size={64} /></div>
        <h1 className="font-display text-4xl">Texa Fashions <span className="text-cherry">OS</span></h1>
        <p className="max-w-md text-sm text-soft">Demo sign-in — pick a role to explore the app as that person. Switch roles any time from the avatar menu.</p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((u, i) => (
          <motion.button key={u.role} onClick={() => go(u.role)} disabled={busy !== null} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 22 }} whileTap={{ scale: 0.97 }} whileHover={{ y: -3 }} className="text-left">
            <Card className="h-full p-5 transition-shadow hover:shadow-pop">
              <div className="flex items-center gap-3">
                <span className={`grid size-14 shrink-0 place-items-center overflow-hidden rounded-full ${ROLE_TINT[u.role]}`}><Mascot kind={ROLE_MASCOT[u.role]} size={44} bob={false} /></span>
                <div><p className="font-medium">{ROLE_LABELS[u.role]}</p><p className="text-xs text-soft">{u.displayName}</p></div>
              </div>
              <p className="mt-3 text-sm text-soft">{busy === u.role ? 'Signing in…' : u.blurb}</p>
            </Card>
          </motion.button>
        ))}
      </div>
      <button type="button" onClick={() => setMore((v) => !v)} className="self-center rounded-pill border border-line px-5 py-2 text-sm text-soft hover:bg-card2">{more ? 'Show fewer roles' : 'More roles (cashier, sales associate, vendor, auditor)'}</button>
    </main>
  );
}

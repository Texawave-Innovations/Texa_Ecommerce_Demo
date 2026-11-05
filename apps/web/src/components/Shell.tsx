'use client';
import { landingFor } from '@/lib/landing';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, LogOut, Menu, Moon, Search, Sun, Lock } from 'lucide-react';
import { AIOrb, Badge, Button, MascotLoader, SlideOver, cn } from '@texafashions/ui';
import { DEMO_USERS, MASTERS, ROLE_LABELS, STORE_CODES, type Role } from '@texafashions/types';
import { data } from '@/lib/data';
import { UniChat } from './UniChat';
import { BellButton, NotificationCentre, useInbox } from './notifications';
import { NAV, isReady } from '@/lib/nav';
import { useSession, useStoreFilter, useTheme } from '@/lib/stores';

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, ready } = useSession();
  React.useEffect(() => { if (ready && !session) router.replace('/login'); }, [ready, session, router]);
  const [paletteOpen, setPalette] = React.useState(false);
  const [aiOpen, setAi] = React.useState(false);
  const [navOpen, setNav] = React.useState(false);
  const [notifOpen, setNotif] = React.useState(false);
  const [askSeed, setAskSeed] = React.useState<{ n: number; text: string } | null>(null);
  const inbox = useInbox();
  const pathname = usePathname();
  React.useEffect(() => setNav(false), [pathname]);

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((o) => !o); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!ready || !session) return <MascotLoader label="Waking up the bears…" />;
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onPalette={() => setPalette(true)} onMenu={() => setNav(true)} unread={inbox.unread} critical={inbox.criticalUnread} onBell={() => setNotif(true)} />
        <PageTransition>{children}</PageTransition>
      </div>
      <SlideOver open={navOpen} onClose={() => setNav(false)} title="Texa Fashions OS" side="left" width={300}><NavList mobile /></SlideOver>
      <Palette open={paletteOpen} onClose={() => setPalette(false)} />
      <AIOrb onClick={() => setAi(true)} />
      <NotificationCentre open={notifOpen} onClose={() => setNotif(false)} items={inbox.items}
        onAskWhy={(i) => { setAskSeed({ n: Date.now(), text: `Why did this alert fire, and what should I do about it? [${i.severity}] ${i.title} — ${i.detail}${i.storeId ? ` (store ${i.storeId})` : ''} (rule: ${i.ruleId}). Check the underlying data before answering.` }); setAi(true); }} />
      <UniChat open={aiOpen} onClose={() => setAi(false)} seed={askSeed} />
    </div>
  );
}

function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main key={path} id="main" className="flex-1 px-4 py-6 md:px-8" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
        {children}
      </motion.main>
    </AnimatePresence>
  );
}

function NavList({ collapsed = false, mobile = false }: { collapsed?: boolean; mobile?: boolean }) {
  const path = usePathname();
  const role = useSession((s) => s.session!.claims.role);
  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));
  return (
    <ul className={cn('flex flex-1 flex-col gap-1 overflow-y-auto', mobile ? '' : 'px-3')}>
      {items.map((n) => {
        const active = path === n.href || (n.href !== '/dashboard' && path.startsWith(n.href.split('/').slice(0, 2).join('/')));
        const locked = !isReady(n);
        const Icon = n.icon;
        const inner = (
          <span className={cn('flex h-10 items-center gap-3 rounded-2xl px-3 text-sm transition-colors', active ? 'bg-blush/60 font-medium' : 'hover:bg-card2', locked && 'text-soft')}>
            <Icon className="size-5 shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
            {!collapsed && locked && <Badge tone="butter" className="!px-2 text-[10px]"><Lock className="size-2.5" />P{n.phase}</Badge>}
          </span>
        );
        return <li key={n.href} title={collapsed ? n.label : undefined}>{locked ? <div aria-disabled className="cursor-not-allowed opacity-70">{inner}</div> : <Link href={n.href}>{inner}</Link>}</li>;
      })}
    </ul>
  );
}

function Sidebar() {
  const { sidebarCollapsed: collapsed, toggleSidebar } = useStoreFilter();
  return (
    <motion.nav aria-label="Primary" className="sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line/60 bg-card/70 py-4 backdrop-blur md:flex"
      animate={{ width: collapsed ? 76 : 244 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
      <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cherry font-display text-lg text-cherry-ink">U</span>
        {!collapsed && <span className="font-display text-lg leading-tight">Texa Fashions <span className="text-cherry">OS</span></span>}
      </Link>
      <NavList collapsed={collapsed} />
      <button onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="mx-3 mt-2 grid h-9 place-items-center rounded-2xl text-soft hover:bg-card2">
        <ChevronLeft className={cn('size-5 transition-transform', collapsed && 'rotate-180')} />
      </button>
    </motion.nav>
  );
}

function Topbar({ onPalette, onMenu, unread, critical, onBell }: { onPalette: () => void; onMenu: () => void; unread: number; critical: boolean; onBell: () => void }) {
  const { session } = useSession();
  const { theme, toggle } = useTheme();
  const { storeId, setStoreId } = useStoreFilter();
  const router = useRouter();
  const [menu, setMenu] = React.useState(false);
  const stores = useQuery({ queryKey: ['stores-lite'], queryFn: () => data().masters.list('stores') });
  const claims = session!.claims;
  const visible = (stores.data ?? []).filter((s) => !claims.storeIds.length || claims.storeIds.includes(s.id));
  const scoped = !['super_admin', 'cfo', 'buyer', 'auditor', 'hr_manager', 'warehouse_manager'].includes(claims.role);

  async function switchRole(r: Role) { setMenu(false); await data().auth.signOut(); await data().auth.demoSignIn(r); router.replace(landingFor(r)); }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/60 bg-bg/80 px-4 backdrop-blur md:px-8">
      <Button variant="ghost" size="sm" aria-label="Open menu" className="md:hidden" onClick={onMenu}><Menu className="size-5" /></Button>
      <button onClick={onPalette} className="flex h-10 flex-1 items-center gap-2 rounded-pill border border-line bg-card px-4 text-left text-sm text-soft hover:border-cherry/50 md:max-w-md">
        <Search className="size-4" /><span className="flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden rounded-md bg-card2 px-1.5 py-0.5 text-[11px] sm:block">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <label className="sr-only" htmlFor="store">Store</label>
        <select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="hidden h-10 rounded-pill border border-line bg-card px-4 text-sm sm:block">
          {!scoped && <option value="ALL">All stores</option>}
          {(visible.length ? visible : STORE_CODES.map((c) => ({ id: c, name: c }))).map((s) => <option key={s.id} value={s.id}>{String(s.name ?? s.id)}</option>)}
        </select>
        <Button variant="ghost" size="sm" aria-label="Toggle theme" onClick={toggle}>{theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
        <BellButton unread={unread} critical={critical} onClick={onBell} />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-pill border border-line bg-card py-1 pl-1 pr-3" aria-haspopup="menu" aria-expanded={menu}>
            <span className="grid size-8 place-items-center rounded-full bg-lavender font-display">{session!.name[0]}</span>
            <span className="hidden text-left text-xs leading-tight sm:block"><b className="block text-sm font-medium">{session!.name}</b>{ROLE_LABELS[claims.role]}</span>
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} role="menu" className="glass absolute right-0 top-12 z-50 w-64 rounded-2xl p-2 shadow-soft">
                <p className="px-3 py-1.5 text-xs font-medium text-soft">Switch demo role</p>
                {DEMO_USERS.map((u) => (
                  <button key={u.role} role="menuitem" onClick={() => switchRole(u.role)} className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-card2', u.role === claims.role && 'bg-blush/40')}>
                    {ROLE_LABELS[u.role]}{u.role === claims.role && <span>✓</span>}
                  </button>
                ))}
                <button role="menuitem" onClick={async () => { await data().auth.signOut(); router.replace('/login'); }} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-cherry hover:bg-card2"><LogOut className="size-4" />Sign out</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toggle = useTheme((s) => s.toggle);
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-start justify-center p-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} className="glass relative w-full max-w-xl overflow-hidden rounded-[24px] shadow-soft">
            <Command label="Command palette" loop>
              <Command.Input autoFocus placeholder="Type a page, master or action…" className="h-14 w-full border-b border-line/60 bg-transparent px-5 text-base outline-none" />
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="p-6 text-center text-sm text-soft">Nothing found.</Command.Empty>
                <Command.Group heading="Go to" className="text-xs text-soft [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {NAV.filter(isReady).map((n) => <Item key={n.href} onSelect={() => go(n.href)}>{n.label}</Item>)}
                  <Item onSelect={() => go('/master/approvals')}>Approvals queue</Item>
                  <Item onSelect={() => go('/design')}>Design system</Item>
                </Command.Group>
                <Command.Group heading="Master data" className="text-xs text-soft [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {MASTERS.map((m) => <Item key={m.key} value={`master ${m.label} ${m.group}`} onSelect={() => go(`/master/${m.key}`)}>{m.label} <span className="ml-2 text-xs text-soft">{m.group}</span></Item>)}
                </Command.Group>
                <Command.Group heading="Actions" className="text-xs text-soft [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  <Item onSelect={() => { toggle(); onClose(); }}>Toggle light / dark</Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
const Item = ({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value?: string }) => (
  <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center rounded-xl px-3 py-2.5 text-sm text-ink aria-selected:bg-blush/50">{children}</Command.Item>
);

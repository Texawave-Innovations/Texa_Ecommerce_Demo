'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MascotLoader } from '@texafashions/ui';
import { usePos } from '@/lib/store';

export default function Home() {
  const router = useRouter(); const { ready, session, storeId, shiftId } = usePos();
  React.useEffect(() => { if (!ready) return; router.replace(!session || !storeId ? '/login' : shiftId ? '/sell' : '/shift'); }, [ready, session, storeId, shiftId, router]);
  return <div className="grid min-h-dvh place-items-center"><MascotLoader label="Starting Uni POS…" /></div>;
}

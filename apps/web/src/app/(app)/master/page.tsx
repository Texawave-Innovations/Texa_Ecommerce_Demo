'use client';
import Link from 'next/link';
import { Badge, Card, StaggerGrid } from '@texafashions/ui';
import { MASTERS, MASTER_GROUPS, canEditMaster } from '@texafashions/types';
import { useSession } from '@/lib/stores';

export default function MasterIndex() {
  const role = useSession((s) => s.session!.claims.role);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl">Master Data</h1><p className="text-sm text-soft">{MASTERS.length} masters · every change goes through maker-checker approval.</p></div>
        <Link href="/master/approvals" className="rounded-pill bg-blush/60 px-5 py-2 text-sm">Approvals queue →</Link>
      </header>
      {MASTER_GROUPS.map((g) => (
        <section key={g}>
          <h2 className="mb-3 font-display text-lg text-soft">{g}</h2>
          <StaggerGrid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MASTERS.filter((m) => m.group === g).map((m) => (
              <Link key={m.key} href={`/master/${m.key}`}>
                <Card className="p-5 transition-shadow hover:shadow-pop">
                  <div className="flex items-center justify-between"><h3 className="font-medium">{m.label}</h3>{canEditMaster(role, m.key) ? <Badge tone="mint">can edit</Badge> : <Badge tone="butter">view</Badge>}</div>
                  <p className="mt-1 text-xs text-soft">{m.fields.length} fields{m.shopifySync ? ' · Shopify sync' : ''}{m.barcode ? ' · barcodes' : ''}</p>
                </Card>
              </Link>
            ))}
          </StaggerGrid>
        </section>
      ))}
    </div>
  );
}

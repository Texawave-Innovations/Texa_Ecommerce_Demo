'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, SlideOver, Skeleton } from '@texafashions/ui';
import type { MasterDef } from '@texafashions/types';
import { data } from '@/lib/data';
import { displayCell } from '@/lib/masterConvert';

export function HistoryDrawer({ def, id, onClose }: { def: MasterDef; id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['history', def.key, id], queryFn: () => data().masters.history(def.key, id!), enabled: !!id });
  const list = q.data ?? [];
  return (
    <SlideOver open={!!id} onClose={onClose} title={`History · ${id ?? ''}`} width={520}>
      {q.isLoading ? <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : !list.length ? <EmptyState kind="bunny" title="No history yet" hint="Versions appear after the first approved change." />
        : <ol className="flex flex-col gap-4">
          {list.map((v, i) => {
            const prev = list[i + 1]?.data ?? {};
            const changed = def.fields.filter((f) => JSON.stringify(v.data[f.key]) !== JSON.stringify(prev[f.key]));
            return (
              <li key={v.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-center justify-between"><Badge tone="lavender">v{v.version}</Badge><span className="text-xs text-soft">{v.changedAt ? new Date(v.changedAt).toLocaleString('en-IN') : ''} · {v.kind}</span></div>
                <ul className="mt-3 space-y-1 text-sm">
                  {changed.map((f) => (
                    <li key={f.key} className="flex gap-2"><span className="w-32 shrink-0 text-soft">{f.label}</span>
                      {i < list.length - 1 && <span className="text-cherry line-through">{displayCell(f, prev[f.key])}</span>}<span>{displayCell(f, v.data[f.key])}</span></li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-soft">by {v.changedBy}</p>
              </li>
            );
          })}
        </ol>}
    </SlideOver>
  );
}

'use client';
import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { requiredHeadcount, suggestDayRoster, type RosterEmployee, type ShiftDef } from '@texafashions/domain';
import { Badge, Button, Card, EmptyState, Select } from '@texafashions/ui';
import { PageHead, useCommand, useDoc, useMaster, useRows, useScope } from '../scm/kit';
import { HrNav, mondayOf, ymd } from './shared';

type DayPlan = { date: string; shifts: { shiftId: string; employeeIds: string[] }[] };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function RosterView() {
  const scope = useScope();
  const { rows: stores } = useMaster('stores');
  const { rows: shiftMaster } = useMaster('hrShifts');
  const { rows: employeesAll } = useMaster('employees');
  const myStores = scope.all ? stores : stores.filter((s) => scope.storeIds.includes(s.id));
  const [storeId, setStoreId] = React.useState('');
  React.useEffect(() => { if (!storeId && myStores[0]) setStoreId(myStores[0].id); }, [myStores, storeId]);
  const [weekOffset, setWeekOffset] = React.useState(0);
  const weekStart = ymd(new Date(mondayOf(new Date()).getTime() + weekOffset * 7 * 86_400_000));

  const shifts: ShiftDef[] = React.useMemo(() => shiftMaster.filter((s) => s.id !== 'SH-WH').map((s) => ({ id: s.id, startHour: Number(String(s.start).split(':')[0]), endHour: Number(String(s.end).split(':')[0]) })), [shiftMaster]);
  const staff: RosterEmployee[] = React.useMemo(() => employeesAll.filter((e) => e.storeId === storeId).map((e) => ({ id: e.id, name: String(e.name) })), [employeesAll, storeId]);
  const nameOf = (id: string) => staff.find((e) => e.id === id)?.name ?? id;

  const savedId = storeId && weekStart ? `${storeId}_${weekStart}` : null;
  const saved = useDoc('rosters', savedId);
  const footfall = useRows('footfallHourly', { where: storeId ? [['storeId', '==', storeId]] : undefined, limit: 7 }, !!storeId);

  const [plan, setPlan] = React.useState<DayPlan[] | null>(null);
  const emptyWeek = React.useCallback((): DayPlan[] => Array.from({ length: 7 }, (_, i) => ({ date: ymd(new Date(new Date(weekStart).getTime() + i * 86_400_000)), shifts: shifts.map((s) => ({ shiftId: s.id, employeeIds: [] })) })), [weekStart, shifts]);
  React.useEffect(() => { setPlan(saved?.days ? (saved.days as DayPlan[]) : (shifts.length ? emptyWeek() : null)); }, [saved, storeId, weekStart, shifts.length, emptyWeek]);

  const { run, busy } = useCommand();
  const assigned = new Set((plan ?? []).flatMap((d) => d.shifts.flatMap((s) => s.employeeIds)));

  const suggest = () => {
    if (!staff.length || !shifts.length) return;
    const avgFootfall = Array(24).fill(0).map((_, h) => Math.round((footfall ?? []).reduce((a, f) => a + Number((f.hours as number[])?.[h] ?? 0), 0) / Math.max(1, (footfall ?? []).length)));
    const shiftsSoFar: Record<string, number> = {};
    setPlan(Array.from({ length: 7 }, (_, i) => {
      const date = ymd(new Date(new Date(weekStart).getTime() + i * 86_400_000));
      const day = suggestDayRoster(staff, shifts, avgFootfall, shiftsSoFar);
      return { date, shifts: day.map((d) => ({ shiftId: d.shiftId, employeeIds: d.employeeIds })) };
    }));
  };

  const moveEmployee = (empId: string, toDate: string, toShiftId: string) => {
    setPlan((prev) => (prev ?? []).map((d) => ({
      ...d,
      shifts: d.shifts.map((s) => {
        let ids = s.employeeIds.filter((id) => id !== empId);
        if (d.date === toDate && s.shiftId === toShiftId && !ids.includes(empId)) ids = [...ids, empId];
        return { ...s, employeeIds: ids };
      }),
    })));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Roster" sub="Drag a name onto a shift cell to assign it, or let the footfall model fill the week." actions={
        <div className="flex gap-2">
          <Button variant="soft" onClick={suggest}><Sparkles className="size-4" />AI suggest roster</Button>
          <Button loading={busy} disabled={!plan || !storeId} onClick={() => plan && run('saveRoster', { storeId, weekStart, days: plan }, 'Roster saved')}>Save roster</Button>
        </div>
      } />
      <HrNav current="/hr/roster" />
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">{myStores.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}</Select>
        <div className="flex items-center gap-2 text-sm"><Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w - 1)}>←</Button><span>Week of {weekStart}</span><Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w + 1)}>→</Button></div>
      </div>
      {!staff.length ? <EmptyState kind="capybara" title="No staff assigned to this store" /> : !plan ? <EmptyState kind="bear" title="No shifts configured" /> : (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <Card className="h-fit p-3">
            <h4 className="mb-2 text-xs font-medium text-soft">Staff ({staff.length})</h4>
            <ul className="flex flex-col gap-1">
              {staff.map((e) => (
                <li key={e.id} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)}
                  className="cursor-grab rounded-xl bg-card2 px-2 py-1 text-sm active:cursor-grabbing">
                  {e.name}{assigned.has(e.id) && <span className="ml-1 text-xs text-soft">✓</span>}
                </li>
              ))}
            </ul>
          </Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-2 text-sm">
              <thead><tr><th className="w-24 text-left text-xs text-soft">Shift</th>{plan.map((d, i) => <th key={d.date} className="text-left text-xs text-soft">{DOW[i]}<br /><span className="font-normal">{d.date.slice(5)}</span></th>)}</tr></thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id}>
                    <td className="align-top text-xs font-medium">{String(shiftMaster.find((s) => s.id === shift.id)?.name ?? shift.id)}</td>
                    {plan.map((d) => {
                      const cell = d.shifts.find((s) => s.shiftId === shift.id);
                      const req = requiredHeadcount(Array(24).fill(0).map((_, h) => ((footfall ?? []).find((f) => f.date === d.date)?.hours as number[] | undefined)?.[h] ?? 0), shift);
                      const ids = cell?.employeeIds ?? [];
                      return (
                        <td key={d.date} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveEmployee(e.dataTransfer.getData('text/plain'), d.date, shift.id); }}
                          className="min-h-[72px] rounded-2xl border border-dashed border-line/70 bg-card p-2 align-top">
                          <div className="mb-1 flex items-center justify-between"><Badge tone={ids.length >= req ? 'mint' : 'butter'}>{ids.length}/{req}</Badge></div>
                          <div className="flex flex-col gap-1">
                            {ids.map((id) => (
                              <span key={id} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', id)} className="flex items-center justify-between gap-1 rounded-pill bg-blush/50 px-2 py-0.5 text-xs">
                                {nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => moveEmployee(id, '', '')} className="text-soft hover:text-cherry">✕</button>
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

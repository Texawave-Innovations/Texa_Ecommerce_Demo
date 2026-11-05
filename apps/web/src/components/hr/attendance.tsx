'use client';
import * as React from 'react';
import { Badge, Button, Card, EmptyState, Field, Select } from '@texafashions/ui';
import { DataTable, PageHead, useCommand, useMaster, useRows, useScope } from '../scm/kit';
import { HrNav, dt, todayStr } from './shared';

const TONE = { present: 'mint', late: 'butter', absent: 'cherry' } as const;

export function AttendanceView() {
  const scope = useScope();
  const { rows: stores } = useMaster('stores');
  const { rows: employees } = useMaster('employees');
  const myStores = scope.all ? stores : stores.filter((s) => scope.storeIds.includes(s.id));
  const [storeId, setStoreId] = React.useState('');
  React.useEffect(() => { if (!storeId && myStores[0]) setStoreId(myStores[0].id); }, [myStores, storeId]);
  const [employeeId, setEmployeeId] = React.useState('');
  const staff = employees.filter((e) => e.storeId === storeId);
  React.useEffect(() => { if (staff.length && !staff.some((s) => s.id === employeeId)) setEmployeeId(staff[0]!.id); }, [storeId, staff, employeeId]);
  const today = todayStr();
  const rows = useRows('attendance', { where: [['date', '==', today]] }, !!storeId);
  const todaysRows = (rows ?? []).filter((r) => r.storeId === storeId);
  const mine = todaysRows.find((r) => r.employeeId === employeeId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHead title="Attendance" sub="Selfie check-in verifies you're inside the store's geofence before punching in." />
      <HrNav current="/hr/attendance" />
      <Card className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Store"><Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{myStores.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}</Select></Field>
          <Field label="Employee"><Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{staff.map((e) => <option key={e.id} value={e.id}>{String(e.name)}</option>)}</Select></Field>
        </div>
        {employeeId && storeId && <CheckInOut employeeId={employeeId} storeId={storeId} mine={mine} />}
      </Card>
      <div>
        <h3 className="mb-2 font-display text-lg">Today at {String(myStores.find((s) => s.id === storeId)?.name ?? storeId)}</h3>
        <DataTable rows={storeId ? todaysRows : null} empty={<EmptyState kind="bear" title="No one has checked in yet" />} cols={[
          { key: 'emp', header: 'Employee', cell: (r) => String(employees.find((e) => e.id === r.employeeId)?.name ?? r.employeeId) },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'lavender'}>{String(r.status)}</Badge> },
          { key: 'in', header: 'Check-in', cell: (r) => dt(r.checkInAt as string) },
          { key: 'out', header: 'Check-out', cell: (r) => dt(r.checkOutAt as string) },
          { key: 'geo', header: 'Distance', cell: (r) => (r.distanceM != null ? `${r.distanceM}m` : '—') },
        ]} />
      </div>
    </div>
  );
}

function CheckInOut({ employeeId, storeId, mine }: { employeeId: string; storeId: string; mine?: Record<string, any> }) {
  const { run, busy } = useCommand();
  const [geoErr, setGeoErr] = React.useState<string | null>(null);
  const [selfie, setSelfie] = React.useState<string | null>(null);

  const punch = (kind: 'checkIn' | 'checkOut') => {
    setGeoErr(null);
    if (kind === 'checkOut') { run('checkOut', { employeeId }, 'Checked out'); return; }
    if (!navigator.geolocation) { setGeoErr('Geolocation not available in this browser'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { run('checkIn', { employeeId, storeId, lat: pos.coords.latitude, lng: pos.coords.longitude }, (r) => `Checked in — ${r.distanceM}m from store`); },
      (err) => setGeoErr(err.message || 'Could not get your location'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-card2/60 p-5 text-center">
      <div className="grid size-28 place-items-center overflow-hidden rounded-full bg-blush/50 text-4xl">
        {selfie ? <img src={selfie} alt="Selfie preview" className="size-full object-cover" /> : '🙂'}
      </div>
      <label className="text-xs text-soft underline">
        Take selfie (optional, demo only)
        <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setSelfie(String(r.result)); r.readAsDataURL(f);
        }} />
      </label>
      {mine?.checkInAt ? (
        <>
          <p className="text-sm">Checked in {mine.distanceM != null ? `· ${mine.distanceM}m from store` : ''}</p>
          <Button variant="soft" loading={busy} disabled={!!mine.checkOutAt} onClick={() => punch('checkOut')}>{mine.checkOutAt ? 'Checked out' : 'Check out'}</Button>
        </>
      ) : (
        <Button loading={busy} onClick={() => punch('checkIn')}>📍 Check in with location</Button>
      )}
      {geoErr && <p role="alert" className="text-sm text-cherry">{geoErr}</p>}
    </div>
  );
}

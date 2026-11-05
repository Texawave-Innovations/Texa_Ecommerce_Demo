'use client';
import * as React from 'react';
import { RECRUITMENT_STAGES, type RecruitmentStage } from '@texafashions/domain';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input } from '@texafashions/ui';
import { PageHead, useCommand, useLocations, useMaster, useRows } from '../scm/kit';
import { HrNav, type Doc } from './shared';

const STAGE_LABEL: Record<RecruitmentStage, string> = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };
const STAGE_TONE: Record<RecruitmentStage, 'sky' | 'lavender' | 'butter' | 'mint' | 'cherry'> = { applied: 'sky', screening: 'lavender', interview: 'butter', offer: 'mint', hired: 'mint', rejected: 'cherry' };
const BOARD_STAGES = RECRUITMENT_STAGES.filter((s) => s !== 'rejected');

export function RecruitmentBoard() {
  const rows = useRows('candidates', {});
  const { run } = useCommand();
  const [adding, setAdding] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const move = (candidateId: string, stage: RecruitmentStage) => run('moveCandidateStage', { candidateId, stage }, (r) => (r.employeeId ? `Hired → employee ${r.employeeId} created, onboarding checklist started` : `Moved to ${STAGE_LABEL[stage]}`));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Recruitment" sub="Drag a candidate card to move them through the pipeline. Moving to Hired creates the employee record and onboarding checklist." actions={<Button onClick={() => setAdding(true)}>+ Add candidate</Button>} />
      <HrNav current="/hr/recruitment" />
      {rows === null ? <Card className="p-8 text-center text-sm text-soft">Loading…</Card> : (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-6">
          {BOARD_STAGES.map((stage) => {
            const cards = rows.filter((r) => r.stage === stage);
            return (
              <div key={stage} className="flex min-w-[220px] flex-col gap-2 rounded-2xl bg-card2/60 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) move(id, stage); setDragging(null); }}>
                <div className="flex items-center justify-between px-1"><h3 className="text-sm font-medium">{STAGE_LABEL[stage]}</h3><Badge tone={STAGE_TONE[stage]}>{cards.length}</Badge></div>
                {cards.length === 0 && <p className="px-1 text-xs text-soft">Drop here</p>}
                {cards.map((cand) => (
                  <Card key={cand.id} draggable role="listitem" aria-roledescription="Draggable candidate card"
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', cand.id); setDragging(cand.id); }}
                    className="cursor-grab p-3 text-sm active:cursor-grabbing">
                    <p className="font-medium">{String(cand.name)}</p>
                    <p className="text-xs text-soft">{String(cand.mobile)}{cand.storeId ? ` · ${cand.storeId}` : ''}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button size="sm" variant="soft" onClick={() => move(cand.id, 'rejected')}>Reject</Button>
                    </div>
                  </Card>
                ))}
              </div>
            );
          })}
          <div className="flex min-w-[220px] flex-col gap-2 rounded-2xl bg-card2/60 p-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) move(id, 'rejected'); setDragging(null); }}>
            <div className="flex items-center justify-between px-1"><h3 className="text-sm font-medium">{STAGE_LABEL.rejected}</h3><Badge tone={STAGE_TONE.rejected}>{rows.filter((r) => r.stage === 'rejected').length}</Badge></div>
            {rows.filter((r) => r.stage === 'rejected').map((cand) => <Card key={cand.id} className="p-3 text-sm opacity-70"><p className="font-medium">{String(cand.name)}</p><p className="text-xs text-soft">{String(cand.mobile)}</p></Card>)}
          </div>
        </div>
      )}
      {rows?.length === 0 && <EmptyState kind="bunny" title="No candidates yet" />}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add candidate">
        <AddCandidateForm onDone={() => setAdding(false)} />
      </Dialog>
    </div>
  );
}

function AddCandidateForm({ onDone }: { onDone: () => void }) {
  const { run, busy } = useCommand();
  const { rows: desigs } = useMaster('designations');
  const locations = useLocations();
  const [f, setF] = React.useState({ name: '', mobile: '', email: '', designationId: desigs[0]?.id ?? '', storeId: '' });
  React.useEffect(() => { if (!f.designationId && desigs[0]) setF((s) => ({ ...s, designationId: desigs[0]!.id })); }, [desigs, f.designationId]);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run('addCandidate', { name: f.name, mobile: f.mobile, email: f.email || null, designationId: f.designationId, storeId: f.storeId || null }, 'Candidate added');
      if (r) onDone();
    }}>
      <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Mobile" required><Input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} required /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Applying for"><select className="w-full rounded-2xl border border-line bg-card px-4 py-2" value={f.designationId} onChange={(e) => setF({ ...f, designationId: e.target.value })}>{desigs.map((d: Doc) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="Store (optional)"><select className="w-full rounded-2xl border border-line bg-card px-4 py-2" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">— Head office —</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Add candidate</Button></div>
    </form>
  );
}

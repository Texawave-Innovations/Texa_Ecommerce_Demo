'use client';
import * as React from 'react';
import { jsPDF } from 'jspdf';
import { motion } from 'framer-motion';
import { Badge, Button, Card, Dialog, EmptyState, Field, FlowStepper, Input, Kpi } from '@texafashions/ui';
import { DataTable, inr, PageHead, Tabbed, useCommand, useMaster, useRows, useScope } from '../scm/kit';
import { downloadCsv } from '../finance/shared';
import { HrNav, todayStr } from './shared';

type Doc = Record<string, any>;
const PAYROLL_ROLES = ['hr_manager', 'cfo', 'super_admin'];
const WIZARD_STEPS = ['Select month', 'Review', 'Approve', 'Done'];

export function PayrollView() {
  const { claims } = useScope();
  const [tab, setTab] = React.useState<'run' | 'history'>('run');
  const [jumpToMonth, setJumpToMonth] = React.useState<string | null>(null);

  if (!PAYROLL_ROLES.includes(claims.role) && claims.role !== 'auditor') {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <PageHead title="Payroll" sub="PF / ESI / PT / TDS, payslips and the Tally journal." />
        <HrNav current="/hr/payroll" />
        <EmptyState kind="bear" title="Visible to HR & Finance roles" />
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHead title="Payroll" sub="PF / ESI / PT / TDS, payslips and the Tally journal." />
      <HrNav current="/hr/payroll" />
      {claims.role !== 'auditor' && (
        <Tabbed value={tab} onChange={setTab} tabs={[{ value: 'run', label: 'Run payroll' }, { value: 'history', label: 'Past runs' }]} />
      )}
      {tab === 'run' && claims.role !== 'auditor'
        ? <RunWizard onDone={(month) => { setJumpToMonth(month); setTab('history'); }} />
        : <History jumpToMonth={jumpToMonth} />}
    </div>
  );
}

const CONFETTI_COLORS = ['#F7C6D0', '#FCE7A8', '#BFE6D6', '#C7DDF5', '#D9CCF2', '#E5486B'];
function ConfettiBurst() {
  const pieces = React.useMemo(() => Array.from({ length: 28 }, (_, i) => ({ id: i, x: Math.random() * 100, delay: Math.random() * 0.35, rotate: 180 + Math.random() * 360, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden>
      {pieces.map((p) => (
        <motion.span key={p.id} className="absolute top-0 h-2 w-2 rounded-sm" style={{ left: `${p.x}%`, backgroundColor: p.color }}
          initial={{ y: -16, opacity: 1, rotate: 0 }} animate={{ y: 260, opacity: 0, rotate: p.rotate }} transition={{ duration: 1.5, delay: p.delay, ease: 'easeIn' }} />
      ))}
    </div>
  );
}

function RunWizard({ onDone }: { onDone: (month: string) => void }) {
  const { rows: employees } = useMaster('employees');
  const { rows: stores } = useMaster('stores');
  const { run, busy } = useCommand();
  const [step, setStep] = React.useState(0);
  const [month, setMonth] = React.useState(todayStr().slice(0, 7));
  const [result, setResult] = React.useState<Doc | null>(null);
  const active = employees.filter((e) => e.status !== 'inactive');
  const storeCount = new Set(active.map((e) => e.storeId).filter(Boolean)).size;

  return (
    <Card className="relative flex flex-col gap-5 p-5">
      {step === 3 && <ConfettiBurst />}
      <FlowStepper steps={WIZARD_STEPS} current={step} />

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Field label="Payroll month" help="Gross is computed from each employee's salary structure, attendance, overtime and POS sales commission for this month.">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <div className="flex justify-end"><Button onClick={() => setStep(1)} disabled={!month}>Next: Review</Button></div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-soft">Running payroll for <strong>{month}</strong> will compute PF, ESI, PT and a simplified TDS for every active employee, from {stores.length} store(s) and head office / warehouse.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Active employees" value={active.length} tone="sky" />
            <Kpi label="Stores covered" value={storeCount} tone="mint" />
            <Card className="flex flex-col justify-center p-4"><p className="text-xs font-medium text-soft">Month</p><p className="font-display mt-1 text-3xl">{month}</p></Card>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Next: Approve</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-soft">Approving posts one payslip per employee and a single GL journal (Dr salaries & wages / Cr PF, ESI, PT, TDS and net salary payable) — it also queues the Tally sync. This cannot be undone for a month that's already posted.</p>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button loading={busy} onClick={async () => {
              const r = await run('runPayroll', { month }, (x) => `Payroll posted for ${x.employeeCount} employee(s)`);
              if (r) { setResult(r); setStep(3); }
            }}>Approve & run payroll</Button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="flex flex-col gap-4">
          <p className="font-display text-lg">Payroll for {result.month} is posted 🎉</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Employees" value={result.employeeCount} tone="sky" />
            <Kpi label="Gross" value={result.grossPaise} format={inr} tone="butter" />
            <Kpi label="Deductions" value={result.pfEmployeePaise + result.esiEmployeePaise + result.ptPaise + result.tdsPaise} format={inr} tone="blush" />
            <Kpi label="Net payable" value={result.netPaise} format={inr} tone="mint" />
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => { setStep(0); setResult(null); }}>Run another month</Button>
            <Button onClick={() => onDone(result.month)}>View payslips & bank file</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function downloadPayslipPdf(p: Doc) {
  const doc = new jsPDF();
  const line = (label: string, value: string, y: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 14, y); doc.text(value, 196, y, { align: 'right' });
  };
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Texa Fashions — Payslip', 14, 18);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`Month: ${p.month}`, 14, 26); doc.text(`Employee: ${p.employeeName} (${p.employeeId})`, 14, 32); doc.text(`Payable days: ${p.payableDays} / ${p.daysInMonth}`, 14, 38);
  let y = 50;
  doc.setFont('helvetica', 'bold'); doc.text('Earnings', 14, y); doc.text('Deductions', 110, y); doc.setFont('helvetica', 'normal'); y += 8;
  const earnings = [['Basic', p.basicPaise], ['HRA', p.hraPaise], ['Special allowance', p.specialAllowancePaise], ['Overtime', p.overtimePaise], ['Commission', p.commissionPaise]];
  const deductions = [['PF (employee)', p.pfEmployeePaise], ['ESI (employee)', p.esiEmployeePaise], ['Professional tax', p.ptPaise], ['TDS', p.tdsPaise]];
  for (let i = 0; i < Math.max(earnings.length, deductions.length); i++) {
    if (earnings[i]) { doc.text(String(earnings[i]![0]), 14, y); doc.text(inr(Number(earnings[i]![1])), 95, y, { align: 'right' }); }
    if (deductions[i]) { doc.text(String(deductions[i]![0]), 110, y); doc.text(inr(Number(deductions[i]![1])), 196, y, { align: 'right' }); }
    y += 7;
  }
  y += 4; doc.setDrawColor(200); doc.line(14, y, 196, y); y += 8;
  line('Gross pay', inr(p.grossPaise), y, true); y += 8;
  line('Total deductions', inr(p.totalDeductionsPaise), y, true); y += 8;
  line('Net pay', inr(p.netPaise), y, true);
  doc.save(`payslip-${p.month}-${p.employeeId}.pdf`);
}

function History({ jumpToMonth }: { jumpToMonth: string | null }) {
  const runs = useRows('payrollRuns', {});
  const { rows: employees } = useMaster('employees');
  const [selected, setSelected] = React.useState<string | null>(jumpToMonth);
  React.useEffect(() => { if (jumpToMonth) setSelected(jumpToMonth); }, [jumpToMonth]);
  const slips = useRows('payslips', { where: selected ? [['runId', '==', selected]] : undefined }, !!selected);
  const [open, setOpen] = React.useState<Doc | null>(null);
  const sorted = runs ? runs.slice().sort((a, b) => String(b.month).localeCompare(String(a.month))) : null;

  return (
    <div className="flex flex-col gap-5">
      <DataTable rows={sorted} empty={<EmptyState kind="capybara" title="No payroll run yet" />} cols={[
        { key: 'month', header: 'Month', cell: (r) => <button className="font-medium text-cherry hover:underline" onClick={() => setSelected(String(r.month))}>{String(r.month)}</button> },
        { key: 'employeeCount', header: 'Employees', cell: (r) => String(r.employeeCount) },
        { key: 'grossPaise', header: 'Gross', align: 'right', cell: (r) => inr(Number(r.grossPaise)) },
        { key: 'netPaise', header: 'Net payable', align: 'right', cell: (r) => inr(Number(r.netPaise)) },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone="mint">{String(r.status)}</Badge> },
      ]} />
      {selected && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg">Payslips — {selected}</h3>
            <Button variant="soft" size="sm" disabled={!(slips ?? []).length} onClick={() => {
              const rows = (slips ?? []).map((s) => {
                const e = employees.find((x) => x.id === s.employeeId);
                return [String(s.employeeId), String(s.employeeName), String(e?.bankAccount ?? ''), (Number(s.netPaise) / 100).toFixed(2)];
              });
              downloadCsv(`bank-transfer-${selected}.csv`, ['Employee code', 'Employee name', 'Bank account', 'Net pay (INR)'], rows);
            }}>Download bank transfer CSV</Button>
          </div>
          <DataTable rows={slips} empty={<EmptyState kind="bunny" title="No payslips for this month" />} cols={[
            { key: 'employeeName', header: 'Employee', cell: (r) => <button className="text-left font-medium hover:underline" onClick={() => setOpen(r)}>{String(r.employeeName)}</button> },
            { key: 'grossPaise', header: 'Gross', align: 'right', cell: (r) => inr(Number(r.grossPaise)) },
            { key: 'pfEmployeePaise', header: 'PF', align: 'right', cell: (r) => inr(Number(r.pfEmployeePaise)), mobile: 'hide' },
            { key: 'esiEmployeePaise', header: 'ESI', align: 'right', cell: (r) => inr(Number(r.esiEmployeePaise)), mobile: 'hide' },
            { key: 'ptPaise', header: 'PT', align: 'right', cell: (r) => inr(Number(r.ptPaise)), mobile: 'hide' },
            { key: 'tdsPaise', header: 'TDS', align: 'right', cell: (r) => inr(Number(r.tdsPaise)), mobile: 'hide' },
            { key: 'netPaise', header: 'Net pay', align: 'right', cell: (r) => inr(Number(r.netPaise)) },
          ]} />
        </Card>
      )}
      <PayslipDialog payslip={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function PayslipDialog({ payslip, onClose }: { payslip: Doc | null; onClose: () => void }) {
  return (
    <Dialog open={!!payslip} onClose={onClose} title={payslip ? `Payslip — ${payslip.employeeName}` : ''}>
      {payslip && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-soft">{payslip.month} · {payslip.payableDays}/{payslip.daysInMonth} payable days{payslip.overtimeHours ? ` · ${payslip.overtimeHours}h overtime` : ''}</p>
          <dl className="grid grid-cols-2 gap-y-1">
            {[['Basic', payslip.basicPaise], ['HRA', payslip.hraPaise], ['Special allowance', payslip.specialAllowancePaise], ['Overtime', payslip.overtimePaise], ['Commission', payslip.commissionPaise]].map(([l, v]) => (
              <React.Fragment key={String(l)}><dt className="text-soft">{String(l)}</dt><dd className="text-right num">{inr(Number(v))}</dd></React.Fragment>
            ))}
            <dt className="pt-1 font-semibold">Gross</dt><dd className="pt-1 text-right font-semibold num">{inr(payslip.grossPaise)}</dd>
            {[['PF', payslip.pfEmployeePaise], ['ESI', payslip.esiEmployeePaise], ['Professional tax', payslip.ptPaise], ['TDS', payslip.tdsPaise]].map(([l, v]) => (
              <React.Fragment key={String(l)}><dt className="text-soft">{String(l)}</dt><dd className="text-right num">− {inr(Number(v))}</dd></React.Fragment>
            ))}
            <dt className="pt-1 font-semibold">Net pay</dt><dd className="pt-1 text-right font-semibold num text-cherry">{inr(payslip.netPaise)}</dd>
          </dl>
          <div className="flex justify-end"><Button size="sm" onClick={() => downloadPayslipPdf(payslip)}>Download PDF</Button></div>
        </div>
      )}
    </Dialog>
  );
}

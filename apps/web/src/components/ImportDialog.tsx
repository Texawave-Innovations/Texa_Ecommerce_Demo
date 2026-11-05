'use client';
import * as React from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import { Badge, Button, Dialog, toast } from '@texafashions/ui';
import type { MasterDef } from '@texafashions/types';
import { data } from '@/lib/data';
import { mapRow, toCsv, validateForm } from '@/lib/masterConvert';

interface Parsed { row: number; values: Record<string, unknown>; errors: string[] }

export function ImportDialog({ def, open, onClose, onDone }: { def: MasterDef; open: boolean; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = React.useState<Parsed[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  React.useEffect(() => { if (!open) { setRows([]); setFileName(''); } }, [open]);

  async function onFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    let raw: Record<string, unknown>[];
    if (/\.xlsx?$/i.test(file.name)) {
      const sheet = await readSheet(file);
      const [head, ...body] = sheet as unknown[][];
      raw = body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [String(h), r[i]])));
    } else {
      raw = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: true }).data;
    }
    const seen = new Set<string>();
    setRows(raw.map((r, i) => {
      const { values, errors } = validateForm(def, mapRow(def, r));
      const errs = Object.entries(errors).map(([k, m]) => `${k}: ${m}`);
      const code = String(values[def.codeField] ?? '');
      if (code && seen.has(code)) errs.push(`duplicate code ${code} in file`);
      seen.add(code);
      return { row: i + 1, values, errors: errs };
    }));
  }

  const good = rows.filter((r) => !r.errors.length);
  async function submit() {
    setBusy(true);
    try {
      let approvals = 0;
      for (let i = 0; i < good.length; i += 200) {
        await data().masters.importRows({ master: def.key, rows: good.slice(i, i + 200).map((g) => g.values), note: `Import from ${fileName}` });
        approvals++;
      }
      toast(`Submitted ${good.length} rows in ${approvals} approval${approvals > 1 ? 's' : ''}`, 'ok');
      onDone(); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  function template() {
    const blob = new Blob([toCsv(def, [])], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${def.key}-template.csv`; a.click();
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Import ${def.label}`} wide>
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-pill bg-cherry px-5 py-2 text-sm text-cherry-ink shadow-pop">Choose CSV / Excel<input type="file" accept=".csv,.xlsx" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <Button variant="outline" size="sm" onClick={template}>Download template</Button>
        <span className="text-sm text-soft">{fileName}</span>
      </div>
      <p className="mt-2 text-xs text-soft">Headers may be field keys or labels. Money columns are in ₹. Each batch of up to 200 rows becomes one approval for a checker.</p>
      {rows.length > 0 && (
        <>
          <div className="mt-4 flex gap-2"><Badge tone="mint">{good.length} valid</Badge><Badge tone={rows.length - good.length ? 'cherry' : 'lavender'}>{rows.length - good.length} with errors</Badge></div>
          <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card2 text-left text-xs text-soft"><tr><th className="p-2">#</th><th className="p-2">{def.codeField}</th><th className="p-2">{def.nameField}</th><th className="p-2">Result</th></tr></thead>
              <tbody>{rows.slice(0, 300).map((r) => (
                <tr key={r.row} className="border-t border-line/60"><td className="p-2 num">{r.row}</td><td className="p-2">{String(r.values[def.codeField] ?? '')}</td><td className="p-2">{String(r.values[def.nameField] ?? '')}</td>
                  <td className="p-2">{r.errors.length ? <span className="text-cherry">{r.errors.join('; ')}</span> : <span className="text-soft">✓ ok</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!good.length}>Submit {good.length || ''} rows for approval</Button></div>
    </Dialog>
  );
}

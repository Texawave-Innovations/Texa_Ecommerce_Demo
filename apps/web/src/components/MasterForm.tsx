'use client';
import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Input, Select, Textarea, toast } from '@texafashions/ui';
import type { FieldDef, MasterDef, MasterDoc } from '@texafashions/types';
import { data } from '@/lib/data';
import { toDisplay, validateForm } from '@/lib/masterConvert';

type Values = Record<string, unknown>;

export function MasterForm({ def, doc, onSubmit, onCancel, submitting }: {
  def: MasterDef; doc: MasterDoc | null; onSubmit: (values: Record<string, unknown>) => void; onCancel: () => void; submitting?: boolean;
}) {
  const resolver: Resolver<Values> = React.useCallback(async (form) => {
    const { values, errors } = validateForm(def, form);
    const keys = Object.keys(errors);
    if (!keys.length) return { values: values as Values, errors: {} };
    return { values: {}, errors: Object.fromEntries(keys.map((k) => [k, { type: 'validation', message: errors[k] }])) };
  }, [def]);
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Values>({ resolver, defaultValues: toDisplay(def, doc) });
  const editing = !!doc;

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v))} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {def.fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]?.message as string | undefined} help={f.help}
            className={f.type === 'json' || f.type === 'textarea' || f.type === 'image' ? 'sm:col-span-2' : undefined}>
            <Control f={f} def={def} register={register} setValue={setValue} watch={watch} disabled={editing && f.key === def.codeField} />
          </Field>
        ))}
      </div>
      <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-line/60 bg-card/80 px-6 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={submitting}>{editing ? 'Submit change for approval' : 'Submit for approval'}</Button>
      </div>
    </form>
  );
}

function Control({ f, def, register, setValue, watch, disabled }: {
  f: FieldDef; def: MasterDef; register: ReturnType<typeof useForm<Values>>['register']; setValue: ReturnType<typeof useForm<Values>>['setValue']; watch: ReturnType<typeof useForm<Values>>['watch']; disabled?: boolean;
}) {
  const r = register(f.key);
  switch (f.type) {
    case 'number': case 'percent': return <Input type="number" step="any" {...r} className="num" />;
    case 'money': return <div className="relative"><span className="pointer-events-none absolute left-3.5 top-2.5 text-sm text-soft">₹</span><Input type="number" step="0.01" min="0" {...r} className="num pl-7" /></div>;
    case 'bool': return <input type="checkbox" {...r} className="size-5 accent-[var(--cherry)]" />;
    case 'select': return <Select {...r}><option value="">—</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
    case 'textarea': return <Textarea {...r} rows={3} />;
    case 'json': return <Textarea {...r} rows={5} spellCheck={false} />;
    case 'tags': return <Input {...r} placeholder="comma, separated" />;
    case 'date': return <Input type="date" {...r} />;
    case 'ref': return <RefSelect f={f} reg={r} />;
    case 'image': return <ImageField def={def} watch={watch} setValue={setValue} name={f.key} />;
    default: return <Input {...r} disabled={disabled} />;
  }
}

function RefSelect({ f, reg }: { f: FieldDef; reg: ReturnType<ReturnType<typeof useForm<Values>>['register']> }) {
  const q = useQuery({ queryKey: ['ref', f.ref], queryFn: () => data().masters.list(f.ref!, { limit: 1500 }), staleTime: 60_000 });
  return (
    <Select {...reg}>
      <option value="">{q.isLoading ? 'Loading…' : '—'}</option>
      {q.data?.map((d) => <option key={d.id} value={d.id}>{d.id} · {String(d.name ?? '')}</option>)}
    </Select>
  );
}

function ImageField({ def, watch, setValue, name }: { def: MasterDef; watch: ReturnType<typeof useForm<Values>>['watch']; setValue: ReturnType<typeof useForm<Values>>['setValue']; name: string }) {
  const url = watch(name) as string | undefined;
  const code = watch(def.codeField) as string | undefined;
  const [busy, setBusy] = React.useState(false);
  async function onFile(file?: File) {
    if (!file) return;
    if (!code) { toast('Enter the code first so the image can be filed under it', 'err'); return; }
    setBusy(true);
    try { setValue(name, await data().masters.uploadImage(def.key, code, file, file.name), { shouldDirty: true }); toast('Image uploaded', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-4">
      {url ? <img src={url} alt="" className="size-20 rounded-2xl border border-line object-cover" /> : <div className="grid size-20 place-items-center rounded-2xl bg-card2 text-xs text-soft">No image</div>}
      <label className="cursor-pointer rounded-pill bg-blush/60 px-4 py-2 text-sm hover:bg-blush">{busy ? 'Uploading…' : 'Upload image'}<input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
      <input type="hidden" {...{ name }} />
    </div>
  );
}

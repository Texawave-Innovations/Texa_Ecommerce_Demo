'use client';
import * as React from 'react';
import { Camera, Image as ImageIcon, ScanBarcode, Sparkles } from 'lucide-react';
import { Button, Dialog, Tabs, toast } from '@texafashions/ui';
import type { PosSku } from '@texafashions/types';
import { data } from '@/lib/data';
import { flyBus } from '@/lib/events';
import { useIsOffline, usePos } from '@/lib/store';
import { inr } from '@/lib/stores';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o?: { formats?: string[] }) => Detector } }

/** Camera barcode scan (BarcodeDetector API) + "snap a product" visual search (Claude vision via Cloud Function, deterministic fallback without a key). */
export function ScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = React.useState<'barcode' | 'visual'>('barcode');
  const skus = usePos((s) => s.skus); const addSku = usePos((s) => s.addSku); const storeId = usePos((s) => s.storeId);
  const offline = useIsOffline();
  const video = React.useRef<HTMLVideoElement>(null);
  const [cam, setCam] = React.useState<'idle' | 'on' | 'unsupported' | 'denied'>('idle');
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<{ sku: PosSku; reason: string }[]>([]);
  const [fallback, setFallback] = React.useState(false);
  const byBarcode = React.useMemo(() => new Map(skus.map((s) => [s.barcode, s])), [skus]);

  React.useEffect(() => {
    if (!open || tab !== 'barcode') return;
    let stream: MediaStream | null = null; let stop = false; let timer: ReturnType<typeof setTimeout>;
    (async () => {
      if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { setCam('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        setCam('on');
        const det = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a'] });
        let last = '';
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await det.detect(video.current);
            const v = codes[0]?.rawValue;
            if (v && v !== last) { last = v; const hit = byBarcode.get(v); if (hit) { addSku(hit, 1); flyBus.emit({ from: video.current.getBoundingClientRect(), image: hit.imageUrl }); toast(`Added ${hit.name}`, 'ok'); } else toast(`Unknown barcode ${v}`, 'err'); setTimeout(() => { last = ''; }, 1500); }
          } catch { /* frame not ready */ }
          timer = setTimeout(loop, 350);
        };
        loop();
      } catch { setCam('denied'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); setCam('idle'); };
  }, [open, tab, byBarcode, addSku]);

  const onFile = async (f: File | undefined) => {
    if (!f || !storeId) return; setBusy(true); setResults([]);
    try {
      const b64 = await downscale(f);
      const r = (await data().pos.command('visualSearch', { imageBase64: b64, mimeType: 'image/jpeg', storeId })) as { matches?: { skuId: string; reason: string }[]; fallback?: boolean; usedClaude?: boolean };
      const map = new Map(skus.map((s) => [s.id, s]));
      setResults((r.matches ?? []).flatMap((m) => { const sku = map.get(m.skuId); return sku ? [{ sku, reason: m.reason }] : []; }));
      setFallback(!!r.fallback || r.usedClaude === false);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Scan or snap" wide>
      <div className="space-y-3">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'barcode', label: <span className="flex items-center gap-1.5"><ScanBarcode className="size-4" />Barcode</span> }, { value: 'visual', label: <span className="flex items-center gap-1.5"><Sparkles className="size-4" />Visual search</span> }]} />
        {tab === 'barcode' ? (
          <div className="space-y-2">
            <div className="relative aspect-video overflow-hidden rounded-3xl bg-ink/90"><video ref={video} muted playsInline className="size-full object-cover" />
              {cam !== 'on' && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/90">{cam === 'unsupported' ? 'Camera barcode scanning isn’t supported in this browser. A USB/Bluetooth scanner types straight into the search box.' : cam === 'denied' ? 'Camera permission was denied.' : 'Starting camera…'}</div>}
              {cam === 'on' && <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-cherry shadow-[0_0_12px_var(--cherry)]" />}
            </div>
            <p className="text-center text-xs text-soft">Hold the barcode inside the frame — items are added automatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-line bg-card2/50 p-8 text-center">
              <Camera className="size-8 text-cherry" /><span className="font-medium">{busy ? 'Looking…' : offline ? 'Visual search needs a connection' : 'Take a photo of the product'}</span>
              <span className="text-xs text-soft">Uni compares it with this store’s catalogue (Claude vision).</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy || offline} onChange={(e) => onFile(e.target.files?.[0])} data-testid="visual-file" />
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-bg"><ImageIcon className="size-4" />Choose photo</span>
            </label>
            {fallback && results.length > 0 && <p className="rounded-2xl bg-butter/60 p-2.5 text-xs">Demo fallback: set ANTHROPIC_API_KEY for real image matching — showing popular items.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {results.map(({ sku, reason }) => (
                <button key={sku.id} onClick={(e) => { addSku(sku, 1); flyBus.emit({ from: e.currentTarget.getBoundingClientRect(), image: sku.imageUrl }); toast(`Added ${sku.name}`, 'ok'); }} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-2 text-left active:scale-[.98]">
                  {sku.imageUrl && <img src={sku.imageUrl} alt="" className="size-14 rounded-xl object-cover" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{sku.name}</span><span className="block truncate text-xs text-soft">{reason}</span><span className="text-sm font-semibold">{inr(sku.pricePaise)}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}

async function downscale(file: File, max = 768): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1]!;
  } finally { URL.revokeObjectURL(url); }
}

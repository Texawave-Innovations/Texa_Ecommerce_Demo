'use client';
import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { confettiBus, flyBus, reducedMotion } from '@/lib/events';

/** Fly-to-cart: a thumbnail leaves the tapped tile and lands on the cart badge. */
export function FlyLayer() {
  const [items, setItems] = React.useState<{ id: number; from: DOMRect; to: DOMRect; image?: string; label?: string }[]>([]);
  React.useEffect(() => flyBus.on((p) => {
    if (reducedMotion()) return;
    const target = document.getElementById('cart-badge'); if (!target) return;
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, from: p.from, to: target.getBoundingClientRect(), image: p.image, label: p.label }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 700);
  }), []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
      <AnimatePresence>
        {items.map((i) => (
          <motion.div key={i.id} className="absolute grid place-items-center overflow-hidden rounded-2xl bg-blush shadow-pop"
            initial={{ left: i.from.left, top: i.from.top, width: i.from.width * 0.7, height: i.from.height * 0.7, opacity: 1 }}
            animate={{ left: i.to.left + i.to.width / 2 - 16, top: i.to.top + i.to.height / 2 - 16, width: 32, height: 32, opacity: 0.2, rotate: 160 }}
            transition={{ duration: 0.6, ease: [0.5, 0, 0.2, 1] }}>
            {i.image ? <img src={i.image} alt="" className="size-full object-cover" /> : <span className="text-xs">{i.label?.slice(0, 2)}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const COLORS = ['#E5486B', '#F7C6D0', '#FCE7A8', '#BFE6D6', '#C7DDF5', '#D9CCF2'];
/** Canvas confetti (no dependency). Fired on a completed sale. */
export function ConfettiLayer() {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => confettiBus.on(({ big }) => {
    if (reducedMotion()) return;
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    const n = big ? 220 : 120;
    const ps = Array.from({ length: n }, () => ({ x: c.width / 2 + (Math.random() - 0.5) * 240, y: c.height * 0.55, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 17 - 6, r: Math.random() * 6 + 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: COLORS[(Math.random() * COLORS.length) | 0]!, life: 1 }));
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = false;
      for (const p of ps) {
        p.vy += 0.38; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr; p.life -= 0.009;
        if (p.life <= 0 || p.y > c.height + 20) continue; alive = true;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
    };
    cancelAnimationFrame(raf); tick();
  }), []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[70]" aria-hidden />;
}

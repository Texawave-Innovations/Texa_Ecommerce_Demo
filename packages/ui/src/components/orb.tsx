'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

/** Floating glass orb — breathes, ripples on hover. Phase 7 wires it to the Uni assistant. */
export function AIOrb({ onClick, label = 'Ask Uni' }: { onClick: () => void; label?: string }) {
  return (
    <motion.button aria-label={label} onClick={onClick} whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.08 }}
      className="glass fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full shadow-pop"
      animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 3.2, ease: 'easeInOut' }}>
      <span className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-blush via-lavender to-sky opacity-80" />
      <motion.span className="absolute inset-0 rounded-full border border-cherry/40" animate={{ scale: [1, 1.6], opacity: [0.6, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeOut' }} />
      <Sparkles className="size-6 text-cherry" />
    </motion.button>
  );
}

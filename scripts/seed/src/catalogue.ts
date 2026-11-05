import { rng } from './rng';

export const DEPARTMENTS = [
  { code: 'KLV', name: 'K-Living', colorHex: '#BFE6D6' }, { code: 'BAG', name: 'Bags', colorHex: '#F7C6D0' },
  { code: 'PLU', name: 'Plushies', colorHex: '#FCE7A8' }, { code: 'LIF', name: 'Lifestyle', colorHex: '#D9CCF2' },
  { code: 'STA', name: 'Stationery', colorHex: '#C7DDF5' }, { code: 'CAR', name: 'Care Essentials', colorHex: '#FFD9C7' },
];
export const CHARACTERS = ['Capybara', 'Bunny', 'Bear', 'Cat', 'Puppy', 'Panda', 'Duck', 'Hamster'];
const MODIFIERS = ['Classic', 'Cloud', 'Berry', 'Sunny', 'Mochi', 'Latte', 'Starry', 'Peach', 'Cosmic', 'Cookie', 'Daisy', 'Honey'];
export const COLOURS = ['Pink', 'Mint', 'Butter', 'Sky', 'Lavender', 'Cream', 'Brown', 'Black'];

interface Sub { code: string; name: string; dept: string; cat: string; hsn: string; gst: string; price: [number, number]; variants: 'colour' | 'character' | 'size' | 'none' }
export const SUBS: Sub[] = [
  { code: 'KL-TBL', name: 'Tableware', dept: 'KLV', cat: 'Kitchen & Dining', hsn: '3924', gst: '12', price: [299, 899], variants: 'colour' },
  { code: 'KL-BTL', name: 'Water bottles', dept: 'KLV', cat: 'Kitchen & Dining', hsn: '9617', gst: '18', price: [499, 1299], variants: 'colour' },
  { code: 'KL-ORG', name: 'Organisers', dept: 'KLV', cat: 'Home', hsn: '3924', gst: '12', price: [249, 799], variants: 'colour' },
  { code: 'KL-LMP', name: 'Mood lamps', dept: 'KLV', cat: 'Home', hsn: '9405', gst: '18', price: [699, 1499], variants: 'colour' },
  { code: 'BG-TOT', name: 'Tote bags', dept: 'BAG', cat: 'Bags', hsn: '4202', gst: '18', price: [399, 999], variants: 'colour' },
  { code: 'BG-SLG', name: 'Sling bags', dept: 'BAG', cat: 'Bags', hsn: '4202', gst: '18', price: [599, 1299], variants: 'colour' },
  { code: 'BG-BKP', name: 'Mini backpacks', dept: 'BAG', cat: 'Bags', hsn: '4202', gst: '18', price: [799, 1499], variants: 'colour' },
  { code: 'BG-PCH', name: 'Pouches', dept: 'BAG', cat: 'Bags', hsn: '4202', gst: '18', price: [199, 499], variants: 'character' },
  { code: 'PL-SML', name: 'Small plush', dept: 'PLU', cat: 'Plush toys', hsn: '9503', gst: '12', price: [299, 699], variants: 'character' },
  { code: 'PL-LRG', name: 'Large plush', dept: 'PLU', cat: 'Plush toys', hsn: '9503', gst: '12', price: [899, 1499], variants: 'character' },
  { code: 'PL-KEY', name: 'Plush keychains', dept: 'PLU', cat: 'Plush toys', hsn: '9503', gst: '12', price: [199, 399], variants: 'character' },
  { code: 'PL-BLD', name: 'Blind boxes', dept: 'PLU', cat: 'Blind boxes', hsn: '9503', gst: '12', price: [399, 699], variants: 'character' },
  { code: 'LF-PHN', name: 'Phone accessories', dept: 'LIF', cat: 'Accessories', hsn: '3926', gst: '18', price: [249, 799], variants: 'colour' },
  { code: 'LF-HAR', name: 'Hair accessories', dept: 'LIF', cat: 'Accessories', hsn: '7117', gst: '12', price: [199, 499], variants: 'colour' },
  { code: 'LF-JWL', name: 'Fashion jewellery', dept: 'LIF', cat: 'Accessories', hsn: '7117', gst: '12', price: [249, 699], variants: 'colour' },
  { code: 'LF-UMB', name: 'Umbrellas', dept: 'LIF', cat: 'Accessories', hsn: '6601', gst: '12', price: [449, 899], variants: 'colour' },
  { code: 'ST-NTB', name: 'Notebooks', dept: 'STA', cat: 'Paper', hsn: '4820', gst: '12', price: [199, 499], variants: 'colour' },
  { code: 'ST-PEN', name: 'Gel pens', dept: 'STA', cat: 'Writing', hsn: '9608', gst: '18', price: [199, 399], variants: 'colour' },
  { code: 'ST-STK', name: 'Sticker sheets', dept: 'STA', cat: 'Paper', hsn: '4911', gst: '12', price: [199, 349], variants: 'character' },
  { code: 'ST-DSK', name: 'Desk organisers', dept: 'STA', cat: 'Desk', hsn: '3926', gst: '18', price: [349, 899], variants: 'colour' },
  { code: 'CR-LIP', name: 'Lip care', dept: 'CAR', cat: 'Skin care', hsn: '3304', gst: '18', price: [199, 449], variants: 'none' },
  { code: 'CR-HND', name: 'Hand creams', dept: 'CAR', cat: 'Skin care', hsn: '3304', gst: '18', price: [249, 599], variants: 'none' },
  { code: 'CR-MSK', name: 'Sheet masks', dept: 'CAR', cat: 'Skin care', hsn: '3304', gst: '18', price: [199, 699], variants: 'none' },
  { code: 'CR-BTH', name: 'Bath & body', dept: 'CAR', cat: 'Body care', hsn: '3307', gst: '18', price: [299, 899], variants: 'none' },
  { code: 'CR-GRM', name: 'Grooming tools', dept: 'CAR', cat: 'Body care', hsn: '9615', gst: '18', price: [199, 599], variants: 'colour' },
];

const NOUNS: Record<string, string[]> = {
  'KL-TBL': ['Bowl set', 'Mug', 'Lunch box', 'Plate'], 'KL-BTL': ['Tumbler', 'Sipper', 'Flask'], 'KL-ORG': ['Storage box', 'Basket', 'Drawer organiser'], 'KL-LMP': ['Cloud lamp', 'Star lamp'],
  'BG-TOT': ['Canvas tote', 'Quilted tote'], 'BG-SLG': ['Puffy sling', 'Mini sling'], 'BG-BKP': ['Mini backpack'], 'BG-PCH': ['Zip pouch', 'Coin pouch'],
  'PL-SML': ['Plush 20cm', 'Sitting plush'], 'PL-LRG': ['Jumbo plush 50cm', 'Hug pillow plush'], 'PL-KEY': ['Plush keychain'], 'PL-BLD': ['Blind box'],
  'LF-PHN': ['Phone case', 'Phone grip', 'Cable protector'], 'LF-HAR': ['Hair clip set', 'Scrunchie', 'Claw clip'], 'LF-JWL': ['Charm necklace', 'Stud earrings'], 'LF-UMB': ['Foldable umbrella'],
  'ST-NTB': ['Ruled notebook', 'Spiral notebook'], 'ST-PEN': ['Gel pen set', 'Highlighter set'], 'ST-STK': ['Sticker sheet', 'Washi tape'], 'ST-DSK': ['Pen stand', 'Desk tray'],
  'CR-LIP': ['Tinted lip balm', 'Lip mask'], 'CR-HND': ['Hand cream'], 'CR-MSK': ['Sheet mask pack'], 'CR-BTH': ['Body lotion', 'Bath bomb'], 'CR-GRM': ['Brush', 'Comb', 'Mirror'],
};

export interface SkuSeed { code: string; name: string; departmentId: string; categoryId: string; subCategoryId: string; brandId: string; styleId?: string; colour?: string; character?: string; barcode: string; hsn: string; gstRate: string; mrpPaise: number; costPaise: number; pricePaise: number; badges: string[]; isBlindBox: boolean; blindboxSeriesId?: string; reorderLevel: number; minMaxByStore: Record<string, { min: number; max: number }>; shopifyProductId?: string; shopifyVariantId?: string; imageUrl: string; status: 'active' }

function ean13(n: number): string {
  const base = `890${String(n).padStart(9, '0')}`;
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}
const placeholder = (label: string, hex: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' rx='28' fill='${hex}'/><text x='50%' y='52%' font-family='sans-serif' font-size='20' text-anchor='middle' fill='#2B2633'>${label.slice(0, 18)}</text></svg>`)}`;
const HEX: Record<string, string> = { Pink: '#F7C6D0', Mint: '#BFE6D6', Butter: '#FCE7A8', Sky: '#C7DDF5', Lavender: '#D9CCF2', Cream: '#FFF3E0', Brown: '#E8C9A0', Black: '#CFCBD6' };

export function generateSkus(storeCodes: string[], target = 300): SkuSeed[] {
  const r = rng(7);
  const out: SkuSeed[] = [];
  let n = 1;
  const badgePool = ['New', 'Bestseller', 'Limited', 'Gift pick'];
  outer: for (let round = 0; ; round++) {
    for (const sub of SUBS) {
      const nouns = NOUNS[sub.code]!;
      const noun = `${round >= nouns.length ? `${MODIFIERS[(round - nouns.length) % MODIFIERS.length]} ` : ''}${nouns[round % nouns.length]!}`;
      const base = r.int(sub.price[0] / 10, sub.price[1] / 10) * 10 - 1;           // ends in 9: ₹x99 / x49 style
      const mrp = Math.min(1499, Math.max(199, base));
      const variantCount = sub.variants === 'none' ? 1 : r.int(2, 3);
      const picks = sub.variants === 'character' ? [...CHARACTERS].sort(() => r.next() - 0.5).slice(0, variantCount) : [...COLOURS].sort(() => r.next() - 0.5).slice(0, variantCount);
      for (const v of picks) {
        if (out.length >= target) break outer;
        const isChar = sub.variants === 'character';
        const colour = sub.variants === 'colour' ? v : undefined;
        const character = isChar ? v : sub.variants === 'colour' ? r.pick(CHARACTERS) : undefined;
        const blind = sub.code === 'PL-BLD';
        const code = `SKU-${sub.code}-${String(n).padStart(4, '0')}`;
        const minMax = Object.fromEntries(storeCodes.map((s) => [s, { min: r.int(3, 6), max: r.int(14, 30) }]));
        out.push({
          code, name: `${character && (isChar || r.chance(0.5)) ? `${character} ` : ''}${noun}${colour ? ` — ${colour}` : ''}`.trim(),
          departmentId: sub.dept, categoryId: `${sub.dept}-${sub.cat.replace(/[^A-Za-z]+/g, '').slice(0, 6).toUpperCase()}`, subCategoryId: sub.code, brandId: r.chance(0.8) ? 'TEXAFASHIONS' : 'SEOULPICK',
          styleId: character ? `STY-${character.toUpperCase()}` : undefined, colour, character, barcode: ean13(n), hsn: sub.hsn, gstRate: sub.gst,
          mrpPaise: mrp * 100, costPaise: Math.round(mrp * 100 * (0.38 + r.next() * 0.12)), pricePaise: mrp * 100,
          badges: r.chance(0.3) ? [r.pick(badgePool)] : [], isBlindBox: blind, blindboxSeriesId: blind ? `BB-${['CITY', 'CAFE', 'GARDEN', 'SPACE'][n % 4]}` : undefined,
          reorderLevel: r.int(5, 15), minMaxByStore: minMax,
          shopifyProductId: r.chance(0.85) ? `gid://shopify/Product/${9000000 + n}` : undefined, shopifyVariantId: undefined,
          imageUrl: placeholder(character ?? noun, colour ? HEX[colour]! : '#FFF3E0'), status: 'active',
        });
        const last = out[out.length - 1]!; if (last.shopifyProductId) last.shopifyVariantId = `gid://shopify/ProductVariant/${19000000 + n}`;
        n++;
      }
    }
  }
  return out;
}
export const CATEGORIES = [...new Map(SUBS.map((s) => [`${s.dept}-${s.cat.replace(/[^A-Za-z]+/g, '').slice(0, 6).toUpperCase()}`, { code: `${s.dept}-${s.cat.replace(/[^A-Za-z]+/g, '').slice(0, 6).toUpperCase()}`, name: s.cat, departmentId: s.dept }])).values()];

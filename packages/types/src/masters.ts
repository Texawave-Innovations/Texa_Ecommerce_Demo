import { z } from 'zod';
import type { Role } from './roles';

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'percent' | 'bool'
  | 'select' | 'date' | 'ref' | 'tags' | 'json' | 'image';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  /** For type 'ref': the master collection referenced. */
  ref?: string;
  /** Show as a column in the list view. */
  list?: boolean;
  help?: string;
}

export type MasterGroup =
  | 'Organisation' | 'Catalogue' | 'Locations' | 'Partners' | 'Finance'
  | 'Promotions' | 'HR' | 'System';

export interface MasterDef {
  key: string;
  label: string;
  singular: string;
  group: MasterGroup;
  /** Field whose value becomes the document id. */
  codeField: string;
  nameField: string;
  fields: FieldDef[];
  barcode?: boolean;
  images?: boolean;
  shopifySync?: boolean;
}

const t = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'text', ...o });
const sel = (key: string, label: string, options: readonly string[], o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'select', options, ...o });
const ref = (key: string, label: string, r: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'ref', ref: r, ...o });
const n = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'number', ...o });
const money = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'money', ...o });
const bool = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'bool', ...o });

const code = t('code', 'Code', { required: true, list: true });
const name = t('name', 'Name', { required: true, list: true });
const simple = (key: string, label: string, singular: string, group: MasterGroup, extra: FieldDef[] = []): MasterDef =>
  ({ key, label, singular, group, codeField: 'code', nameField: 'name', fields: [code, name, ...extra] });

export const GST_RATES = ['0', '5', '12', '18', '28'] as const;
export const CURRENCIES = ['INR', 'KRW', 'CNY', 'USD'] as const;
export const STATES = ['Maharashtra', 'Karnataka', 'Telangana', 'Delhi', 'Tamil Nadu', 'Gujarat'] as const;

export const MASTERS: MasterDef[] = [
  // ───────── Organisation
  simple('companies', 'Companies', 'Company', 'Organisation', [
    t('legalName', 'Legal name', { required: true }), t('pan', 'PAN', { list: true }), t('cin', 'CIN'),
    textarea('address', 'Registered address'),
  ]),
  simple('gstins', 'GSTINs', 'GSTIN', 'Organisation', [
    t('gstin', 'GSTIN', { required: true, list: true, help: '15-character GSTIN' }),
    sel('state', 'State', STATES, { required: true, list: true }), ref('companyId', 'Company', 'companies'),
    bool('isDefault', 'Default for state'),
  ]),
  {
    key: 'stores', label: 'Stores', singular: 'Store', group: 'Locations', codeField: 'code', nameField: 'name',
    fields: [
      code, name, t('city', 'City', { required: true, list: true }), sel('state', 'State', STATES, { required: true }),
      t('mall', 'Mall'), ref('gstinId', 'GSTIN', 'gstins', { required: true }), ref('costCentreId', 'Cost centre', 'costCentres'),
      n('areaSqFt', 'Area (sq ft)', { list: true }), t('openingDate', 'Opening date'), t('lat', 'Latitude'), t('lng', 'Longitude'),
      sel('format', 'Format', ['Mall', 'High street', 'Kiosk']), n('geofenceMeters', 'Geofence (m)'),
      { key: 'floors', label: 'Floors (JSON)', type: 'json', help: '[{"id":"F1","name":"Ground","svg":"..."}]' },
      { key: 'zones', label: 'Zones (JSON)', type: 'json', help: '[{"id":"Z1","floorId":"F1","name":"Plushies","polygon":[{"x":0,"y":0},...]}]' },
    ],
  },
  simple('warehouses', 'Warehouses', 'Warehouse', 'Locations', [
    t('city', 'City', { list: true }), sel('state', 'State', STATES), ref('gstinId', 'GSTIN', 'gstins'), n('areaSqFt', 'Area (sq ft)'),
  ]),
  simple('bins', 'Bins', 'Bin', 'Locations', [
    ref('warehouseId', 'Warehouse', 'warehouses', { required: true, list: true }), t('aisle', 'Aisle'), t('rack', 'Rack'),
    n('capacityUnits', 'Capacity (units)'), ref('departmentId', 'Preferred department', 'departments'),
  ]),
  // ───────── Catalogue
  simple('departments', 'Departments', 'Department', 'Catalogue', [t('colorHex', 'Colour (hex)')]),
  simple('categories', 'Categories', 'Category', 'Catalogue', [ref('departmentId', 'Department', 'departments', { required: true, list: true })]),
  simple('subCategories', 'Sub-categories', 'Sub-category', 'Catalogue', [
    ref('categoryId', 'Category', 'categories', { required: true, list: true }), ref('departmentId', 'Department', 'departments'),
    sel('defaultGstRate', 'Default GST %', GST_RATES), t('defaultHsn', 'Default HSN'),
  ]),
  simple('brands', 'Brands', 'Brand', 'Catalogue', [t('country', 'Country')]),
  simple('collections', 'Collections', 'Collection', 'Catalogue', [t('season', 'Season'), t('launchDate', 'Launch date')]),
  simple('styles', 'Styles / characters', 'Style', 'Catalogue', [t('character', 'Character')]),
  {
    key: 'skus', label: 'SKUs', singular: 'SKU', group: 'Catalogue', codeField: 'code', nameField: 'name',
    barcode: true, images: true, shopifySync: true,
    fields: [
      code, name,
      ref('departmentId', 'Department', 'departments', { required: true, list: true }),
      ref('categoryId', 'Category', 'categories'), ref('subCategoryId', 'Sub-category', 'subCategories'),
      ref('brandId', 'Brand', 'brands'), ref('collectionId', 'Collection', 'collections'), ref('styleId', 'Style', 'styles'),
      t('colour', 'Colour', { list: true }), t('size', 'Size'), t('character', 'Character'),
      t('barcode', 'Barcode (EAN)', { required: true, list: true }), t('hsn', 'HSN', { required: true }),
      sel('gstRate', 'GST %', GST_RATES, { required: true }),
      money('mrpPaise', 'MRP', { required: true, list: true }), money('costPaise', 'Cost'), money('pricePaise', 'Selling price', { required: true, list: true }),
      { key: 'badges', label: 'Badges', type: 'tags' },
      bool('isBlindBox', 'Blind box'), bool('isService', 'Service (no stock)'), ref('blindboxSeriesId', 'Blind-box series', 'blindboxSeries'),
      t('shopifyProductId', 'Shopify product id'), t('shopifyVariantId', 'Shopify variant id'),
      n('reorderLevel', 'Reorder level'),
      { key: 'minMaxByStore', label: 'Min/Max by store (JSON)', type: 'json', help: '{"BLR-FS":{"min":4,"max":20}}' },
      { key: 'imageUrl', label: 'Image', type: 'image' },
    ],
  },
  simple('blindboxSeries', 'Blind-box series', 'Series', 'Catalogue', [
    n('figuresPerSet', 'Figures per set'), t('secretFigure', 'Secret figure'), money('pricePaise', 'Price'),
  ]),
  simple('priceLists', 'Price lists', 'Price list', 'Catalogue', [
    sel('channel', 'Channel', ['All', 'Store', 'Web', 'B2B'], { list: true }), t('validFrom', 'Valid from'), t('validTo', 'Valid to'),
    { key: 'items', label: 'Items (JSON)', type: 'json', help: '{"SKU-CODE": pricePaise}' },
  ]),
  // ───────── Partners
  {
    key: 'vendors', label: 'Vendors', singular: 'Vendor', group: 'Partners', codeField: 'code', nameField: 'name',
    fields: [
      code, name, sel('country', 'Country', ['India', 'South Korea', 'China']), sel('currency', 'Currency', CURRENCIES, { required: true, list: true }),
      t('gstin', 'GSTIN (domestic)'), t('pan', 'PAN'), bool('isMsme', 'MSME registered'), n('paymentTermsDays', 'Payment terms (days)', { list: true }),
      sel('incoterm', 'Default Incoterm', ['EXW', 'FOB', 'CIF', 'DDP', 'FCA']), t('contactName', 'Contact'), t('email', 'Email'), t('phone', 'Phone'),
      n('tdsRatePct', 'TDS %'), n('onTimePct', 'On-time %'), n('fillRatePct', 'Fill rate %'), n('defectPct', 'Defect %'),
    ],
  },
  simple('vendorPriceLists', 'Vendor price lists', 'Vendor price list', 'Partners', [
    ref('vendorId', 'Vendor', 'vendors', { required: true, list: true }), sel('currency', 'Currency', CURRENCIES), t('validFrom', 'Valid from'), t('validTo', 'Valid to'),
    { key: 'items', label: 'Items (JSON)', type: 'json', help: '{"SKU-CODE": unitPriceMinor}' },
  ]),
  {
    key: 'customers', label: 'Customers', singular: 'Customer', group: 'Partners', codeField: 'code', nameField: 'name',
    fields: [
      code, name, t('mobile', 'Mobile', { required: true, list: true }), t('email', 'Email'), t('birthday', 'Birthday'),
      ref('tierId', 'Tier', 'customerTiers', { list: true }), n('pointsBalance', 'Uni Points'), t('favouriteCharacter', 'Favourite character'),
      t('city', 'City'), bool('whatsappOptIn', 'WhatsApp opt-in'),
    ],
  },
  simple('customerTiers', 'Customer tiers', 'Tier', 'Partners', [
    money('minSpendPaise', 'Min annual spend'), n('earnRatePct', 'Earn %'), n('birthdayBonusPoints', 'Birthday bonus'),
  ]),
  simple('transporters', 'Transporters', 'Transporter', 'Partners', [t('gstin', 'GSTIN'), t('contact', 'Contact'), sel('mode', 'Mode', ['Road', 'Air', 'Courier'])]),
  simple('chas', 'Customs house agents', 'CHA', 'Partners', [t('licence', 'CHA licence'), t('port', 'Port'), t('contact', 'Contact')]),
  // ───────── Finance
  simple('ledgers', 'Ledgers (CoA)', 'Ledger', 'Finance', [
    sel('type', 'Type', ['Asset', 'Liability', 'Income', 'Expense', 'Equity'], { required: true, list: true }),
    t('parentGroup', 'Tally group', { list: true }), t('tallyName', 'Tally ledger name', { required: true, help: 'Exact name in TallyPrime' }),
  ]),
  simple('costCentres', 'Cost centres', 'Cost centre', 'Finance', [ref('storeId', 'Store', 'stores')]),
  simple('taxCodes', 'Tax codes', 'Tax code', 'Finance', [
    sel('kind', 'Kind', ['GST', 'TDS', 'Customs', 'Cess']), n('ratePct', 'Rate %', { list: true }), ref('ledgerId', 'Ledger', 'ledgers'),
  ]),
  simple('paymentModes', 'Payment modes', 'Payment mode', 'Finance', [
    sel('kind', 'Kind', ['Cash', 'UPI', 'Card', 'Wallet', 'Gift card', 'Store credit', 'COD', 'Bank']), ref('ledgerId', 'Ledger', 'ledgers'), n('feePct', 'Fee %'),
  ]),
  simple('bankAccounts', 'Bank accounts', 'Bank account', 'Finance', [
    t('bank', 'Bank', { list: true }), t('accountNo', 'Account no.'), t('ifsc', 'IFSC'), ref('ledgerId', 'Ledger', 'ledgers'),
  ]),
  simple('fxRates', 'FX rates', 'FX rate', 'Finance', [
    sel('currency', 'Currency', CURRENCIES, { required: true, list: true }), n('ratePaisePerUnit', 'INR paise per unit', { required: true, list: true }), t('asOf', 'As of'),
  ]),
  // ───────── Promotions
  simple('promotionTypes', 'Promotion types', 'Promotion type', 'Promotions', [
    sel('engineKind', 'Engine kind', ['tender', 'cart_threshold', 'bxgy', 'bundle', 'markdown', 'tiered', 'loyalty_tier', 'happy_hour', 'free_gift']),
    bool('stackable', 'Stackable by default'), n('priority', 'Default priority'),
  ]),
  simple('voucherSeries', 'Voucher series', 'Voucher series', 'Promotions', [
    t('prefix', 'Prefix', { list: true }), money('valuePaise', 'Value'), n('percentOff', 'Percent off'), money('minSpendPaise', 'Min spend'),
    sel('usage', 'Usage', ['single', 'multi']), n('perCustomerLimit', 'Per-customer limit'), t('validFrom', 'Valid from'), t('validTo', 'Valid to'),
    sel('channel', 'Channel', ['All', 'Store', 'Web']),
  ]),
  simple('giftCardSeries', 'Gift card series', 'Gift card series', 'Promotions', [
    sel('kind', 'Kind', ['Physical', 'E-gift']), money('denominationPaise', 'Denomination'), n('validityMonths', 'Validity (months)'),
  ]),
  simple('loyaltyRules', 'Loyalty rules', 'Loyalty rule', 'Promotions', [
    sel('kind', 'Kind', ['earn', 'burn', 'expiry', 'birthday']), n('points', 'Points'), money('perSpendPaise', 'Per spend'), n('expiryMonths', 'Expiry (months)'),
  ]),
  // ───────── HR
  {
    key: 'employees', label: 'Employees', singular: 'Employee', group: 'HR', codeField: 'code', nameField: 'name',
    fields: [
      code, name, ref('storeId', 'Store / location', 'stores', { list: true }), ref('hrDepartmentId', 'Department', 'hrDepartments'), ref('designationId', 'Designation', 'designations', { list: true }),
      ref('shiftId', 'Default shift', 'hrShifts'), ref('salaryStructureId', 'Salary structure', 'salaryStructures'), t('mobile', 'Mobile'), t('email', 'Email'),
      t('doj', 'Date of joining'), sel('state', 'Work state', STATES), t('pan', 'PAN'), t('uan', 'UAN'), t('bankAccount', 'Bank a/c'), t('pin', 'POS PIN (hash set by function)', { help: 'Never stored here in plain text' }),
    ],
  },
  simple('hrDepartments', 'HR departments', 'HR department', 'HR'),
  simple('designations', 'Designations', 'Designation', 'HR', [n('level', 'Level')]),
  simple('hrShifts', 'Shifts', 'Shift', 'HR', [t('start', 'Start (HH:mm)', { required: true, list: true }), t('end', 'End (HH:mm)', { required: true, list: true }), n('breakMinutes', 'Break (min)')]),
  simple('holidays', 'Holidays', 'Holiday', 'HR', [t('date', 'Date', { required: true, list: true }), sel('state', 'State', ['All', ...STATES], { list: true })]),
  simple('leaveTypes', 'Leave types', 'Leave type', 'HR', [n('annualQuota', 'Annual quota', { list: true }), bool('carryForward', 'Carry forward'), bool('paid', 'Paid')]),
  simple('salaryStructures', 'Salary structures', 'Salary structure', 'HR', [
    money('basicPaise', 'Basic', { list: true }), money('hraPaise', 'HRA'), money('specialAllowancePaise', 'Special allowance'), n('commissionPct', 'Commission %'),
    bool('pfApplicable', 'PF'), bool('esiApplicable', 'ESI'),
  ]),
  simple('statutorySettings', 'Statutory settings', 'Statutory setting', 'HR', [
    sel('state', 'State', STATES, { list: true }), n('pfEmployeePct', 'PF employee %'), n('pfEmployerPct', 'PF employer %'), n('esiEmployeePct', 'ESI employee %'), n('esiEmployerPct', 'ESI employer %'),
    { key: 'ptSlabs', label: 'PT slabs (JSON)', type: 'json' }, money('lwfEmployeePaise', 'LWF employee'),
  ]),
  // ───────── System
  simple('reasonCodes', 'Reason codes', 'Reason code', 'System', [
    sel('context', 'Context', ['stock_adjustment', 'pos_return', 'pos_void', 'qc_reject', 'rto', 'discount_override'], { required: true, list: true }), bool('needsApproval', 'Needs manager approval'),
  ]),
  {
    key: 'approvalMatrix', label: 'Approval matrix', singular: 'Approval rule', group: 'System', codeField: 'code', nameField: 'name',
    fields: [
      code, name, sel('docType', 'Document', ['PR', 'PO', 'PAYMENT', 'ADJUSTMENT', 'TRANSFER', 'MASTER', 'EXPENSE'], { required: true, list: true }),
      money('minPaise', 'From amount', { list: true }), money('maxPaise', 'To amount', { list: true }),
      sel('approverRole', 'Approver role', ['store_manager', 'buyer', 'warehouse_manager', 'cfo', 'super_admin'], { required: true, list: true }),
    ],
  },
  simple('numberSeries', 'Number series', 'Number series', 'System', [
    t('docType', 'Doc type', { required: true, list: true }), t('storeCode', 'Store code'), t('format', 'Format', { help: 'e.g. {DOC}/{STORE}/{FY}/{SEQ:5}' }), n('padding', 'Padding'),
  ]),
  simple('roles', 'Roles', 'Role', 'System', [{ key: 'permissions', label: 'Permissions (JSON)', type: 'json' }]),
  simple('notificationTemplates', 'Notification templates', 'Template', 'System', [
    sel('channel', 'Channel', ['in_app', 'whatsapp', 'sms', 'email', 'push'], { list: true }), t('subject', 'Subject'), textarea('body', 'Body'),
  ]),
];

function textarea(key: string, label: string): FieldDef { return { key, label, type: 'textarea' }; }

export const MASTER_KEYS = MASTERS.map((m) => m.key);
export const MASTER_MAP: Record<string, MasterDef> = Object.fromEntries(MASTERS.map((m) => [m.key, m]));
export const MASTER_GROUPS: MasterGroup[] = ['Catalogue', 'Locations', 'Partners', 'Finance', 'Promotions', 'HR', 'Organisation', 'System'];

export function getMaster(key: string): MasterDef {
  const m = MASTER_MAP[key];
  if (!m) throw new Error(`Unknown master: ${key}`);
  return m;
}

/** zod schema generated from a master definition. */
export function buildMasterSchema(def: MasterDef) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'number': case 'percent': s = z.number(); break;
      case 'money': s = z.number().int().nonnegative(); break;
      case 'bool': s = z.boolean(); break;
      case 'tags': s = z.array(z.string()); break;
      case 'json': s = z.any(); break;
      case 'select': s = f.options ? z.enum(f.options as [string, ...string[]]) : z.string(); break;
      default: s = z.string();
    }
    if (f.type === 'text' || f.type === 'ref' || f.type === 'textarea' || f.type === 'date') {
      if (f.required) s = (s as z.ZodString).min(1, `${f.label} is required`);
    }
    shape[f.key] = f.required ? s : s.optional().nullable();
  }
  shape.status = z.enum(['active', 'inactive']).default('active');
  return z.object(shape);
}

export function searchKeywordsFor(def: MasterDef, doc: Record<string, unknown>): string[] {
  const parts = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const s = String(v).toLowerCase().trim();
    if (!s) return;
    parts.add(s);
    s.split(/[\s/_\-.,]+/).filter(Boolean).forEach((w) => {
      parts.add(w);
      for (let i = 2; i <= Math.min(w.length, 12); i++) parts.add(w.slice(0, i)); // prefix tokens for array-contains
    });
  };
  for (const f of def.fields) {
    if (f.list || f.key === def.codeField || f.key === def.nameField || f.key === 'barcode' || f.key === 'mobile') add(doc[f.key]);
  }
  return [...parts].slice(0, 120);
}

// ───────── Permissions
export const MASTER_RIGHTS: Record<MasterGroup, { edit: Role[]; approve: Role[] }> = {
  Organisation: { edit: ['super_admin', 'cfo'], approve: ['super_admin', 'cfo'] },
  Catalogue: { edit: ['super_admin', 'buyer'], approve: ['super_admin', 'cfo', 'buyer'] },
  Locations: { edit: ['super_admin', 'warehouse_manager'], approve: ['super_admin', 'cfo'] },
  Partners: { edit: ['super_admin', 'buyer', 'warehouse_manager', 'store_manager'], approve: ['super_admin', 'cfo', 'buyer'] },
  Finance: { edit: ['super_admin', 'cfo'], approve: ['super_admin', 'cfo'] },
  Promotions: { edit: ['super_admin', 'buyer', 'cfo'], approve: ['super_admin', 'cfo'] },
  HR: { edit: ['super_admin', 'hr_manager'], approve: ['super_admin', 'cfo', 'hr_manager'] },
  System: { edit: ['super_admin'], approve: ['super_admin'] },
};
export const canEditMaster = (role: Role, key: string) => MASTER_RIGHTS[getMaster(key).group].edit.includes(role);
export const canApproveMaster = (role: Role, key: string) => MASTER_RIGHTS[getMaster(key).group].approve.includes(role);
export const canReadMasters = (role: Role) => role !== 'vendor';

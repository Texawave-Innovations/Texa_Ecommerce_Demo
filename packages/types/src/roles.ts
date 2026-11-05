import { z } from 'zod';

export const ROLES = [
  'super_admin', 'cfo', 'buyer', 'warehouse_manager', 'store_manager',
  'cashier', 'sales_associate', 'hr_manager', 'vendor', 'auditor',
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  cfo: 'CFO / Accountant',
  buyer: 'Merchandiser / Buyer',
  warehouse_manager: 'Warehouse Manager',
  store_manager: 'Store Manager',
  cashier: 'Cashier',
  sales_associate: 'Sales Associate',
  hr_manager: 'HR Manager',
  vendor: 'Vendor (portal)',
  auditor: 'Auditor (read-only)',
};

export const ClaimsSchema = z.object({
  role: Role,
  /** Empty array + role in ALL_STORE_ROLES => all stores. */
  storeIds: z.array(z.string()),
  approvalLimitPaise: z.number().int().nonnegative(),
  /** Vendor portal users are bound to a vendor id. */
  vendorId: z.string().optional(),
});
export type Claims = z.infer<typeof ClaimsSchema>;

/** Roles that see every store regardless of storeIds. */
export const ALL_STORE_ROLES: Role[] = ['super_admin', 'cfo', 'buyer', 'warehouse_manager', 'hr_manager', 'auditor'];
export const READ_ONLY_ROLES: Role[] = ['auditor'];

export function canSeeStore(c: Claims, storeId: string): boolean {
  return ALL_STORE_ROLES.includes(c.role) || c.storeIds.includes(storeId);
}

export interface DemoUser {
  role: Role;
  uid: string;
  email: string;
  displayName: string;
  storeIds: string[];
  approvalLimitPaise: number;
  vendorId?: string;
  blurb: string;
}

/** Demo users, created by the seed script and by demoSignIn on demand. */
export const DEMO_USERS: DemoUser[] = [
  { role: 'super_admin', uid: 'demo-super-admin', email: 'admin@texafashions.demo', displayName: 'Aarav Mehta', storeIds: [], approvalLimitPaise: 10_000_000_00, blurb: 'Everything, incl. claims & demo controls' },
  { role: 'cfo', uid: 'demo-cfo', email: 'cfo@texafashions.demo', displayName: 'Priya Nair', storeIds: [], approvalLimitPaise: 5_000_000_00, blurb: 'Finance masters, approvals up to ₹50L' },
  { role: 'buyer', uid: 'demo-buyer', email: 'buyer@texafashions.demo', displayName: 'Kavya Reddy', storeIds: [], approvalLimitPaise: 500_000_00, blurb: 'Catalogue, vendors, price lists' },
  { role: 'warehouse_manager', uid: 'demo-wh', email: 'wh@texafashions.demo', displayName: 'Rohan Patil', storeIds: ['WH-CENTRAL'], approvalLimitPaise: 200_000_00, blurb: 'Warehouse, bins, transporters' },
  { role: 'store_manager', uid: 'demo-sm-blr', email: 'sm.blr@texafashions.demo', displayName: 'Sneha Iyer', storeIds: ['BLR-FS', 'BLR-M5', 'BLR-CS'], approvalLimitPaise: 100_000_00, blurb: 'Bengaluru stores' },
  { role: 'cashier', uid: 'demo-cashier', email: 'cashier@texafashions.demo', displayName: 'Imran Shaikh', storeIds: ['PUN-PMC'], approvalLimitPaise: 0, blurb: 'POS at Pune' },
  { role: 'sales_associate', uid: 'demo-sa', email: 'sa@texafashions.demo', displayName: 'Divya Rao', storeIds: ['PUN-PMC'], approvalLimitPaise: 0, blurb: 'Floor sales, Pune' },
  { role: 'hr_manager', uid: 'demo-hr', email: 'hr@texafashions.demo', displayName: 'Meera Kulkarni', storeIds: [], approvalLimitPaise: 0, blurb: 'HR masters, payroll' },
  { role: 'vendor', uid: 'demo-vendor', email: 'vendor@texafashions.demo', displayName: 'Hana Trading Co.', storeIds: [], approvalLimitPaise: 0, vendorId: 'V-KR-001', blurb: 'Vendor portal (own POs only)' },
  { role: 'auditor', uid: 'demo-auditor', email: 'auditor@texafashions.demo', displayName: 'Vikram Shah', storeIds: [], approvalLimitPaise: 0, blurb: 'Read-only everywhere' },
];

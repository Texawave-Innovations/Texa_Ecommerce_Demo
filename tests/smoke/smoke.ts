/** Integration smoke test against a running emulator + seeded data: `pnpm demo` then `pnpm --filter @texafashions/smoke-tests smoke`. */
import { createFirebaseContext } from '@texafashions/data';
import type { Role } from '@texafashions/types';

const ctx = createFirebaseContext({ apiKey: 'demo-key', projectId: 'demo-texafashions', storageBucket: 'demo-texafashions.appspot.com' });
let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (!cond) failed++; };
const as = async (role: Role) => { await ctx.auth.signOut().catch(() => {}); await ctx.auth.demoSignIn(role); await new Promise((r) => setTimeout(r, 300)); };
const rejects = async (p: Promise<unknown>) => p.then(() => false, () => true);

await as('buyer');
const skus = await ctx.masters.list('skus', { limit: 50 });
ok('buyer can read SKUs', skus.length > 0, `(${skus.length})`);
const sku = skus[10]!;
const newPrice = (sku.pricePaise as number) + 1000;
const { approvalId } = await ctx.masters.submitChange({ master: 'skus', kind: 'update', id: sku.id, data: { pricePaise: newPrice } });
ok('buyer submits price change → pending approval', !!approvalId);
ok('SKU unchanged before approval', (await ctx.masters.get('skus', sku.id))?.pricePaise === sku.pricePaise);
ok('maker cannot approve own change', await rejects(ctx.masters.decide(approvalId, true)));
ok('buyer cannot edit finance masters', await rejects(ctx.masters.submitChange({ master: 'ledgers', kind: 'create', id: 'L-X', data: { name: 'x', type: 'Asset', tallyName: 'x' } })));
ok('invalid data rejected (zod)', await rejects(ctx.masters.submitChange({ master: 'skus', kind: 'update', id: sku.id, data: { gstRate: '99' } })));
ok('buyer cannot read audit log', await rejects(ctx.admin.listAuditLogs()));

await as('cfo');
await ctx.masters.decide(approvalId, true, 'ok');
const after = await ctx.masters.get('skus', sku.id);
ok('after approval price updated, version bumped', after?.pricePaise === newPrice && after.version === 2, `v${after?.version}`);
const hist = await ctx.masters.history('skus', sku.id);
ok('history has 2 versions', hist.length === 2);
const audit = await ctx.admin.listAuditLogs({ limit: 20 });
ok('audit log records submit + approve', audit.some((a) => a.action === 'approve_master_change') && audit.some((a) => a.action === 'submit_master_change'));
ok('seeded pending approval visible', (await ctx.masters.listApprovals('pending')).length >= 1);

await as('buyer');
const imp = await ctx.masters.importRows({ master: 'brands', rows: [{ code: 'NEWB', name: 'New Brand', country: 'India' }, { code: 'NEWB2', name: 'New Brand 2' }] });
ok('bulk import creates one approval', imp.rows === 2);
ok('bulk import with bad row rejected', await rejects(ctx.masters.importRows({ master: 'skus', rows: [{ code: 'BAD' }] })));
await as('super_admin');
await ctx.masters.decide(imp.approvalId, true);
ok('bulk import applied after approval', (await ctx.masters.get('brands', 'NEWB'))?.name === 'New Brand');
const dups = await ctx.masters.detectDuplicates('skus');
ok('duplicate detection finds seeded near-duplicate', dups.candidates.some((c) => c.b === 'SKU-PL-SML-DUP1' || c.a === 'SKU-PL-SML-DUP1'), `(${dups.candidates.length} pairs, claude=${dups.usedClaude})`);
const users = await ctx.admin.listUsers();
ok('super admin lists users', users.length >= 10);

await as('vendor');
ok('vendor cannot read masters', await rejects(ctx.masters.list('skus', { limit: 5 })));
await as('cashier');
ok('cashier cannot edit masters', await rejects(ctx.masters.submitChange({ master: 'brands', kind: 'create', id: 'X1', data: { name: 'x' } })));
ok('cashier cannot set claims', await rejects(ctx.admin.setClaims('demo-cashier', { role: 'super_admin', storeIds: [], approvalLimitPaise: 0 })));

console.log(failed ? `\n${failed} FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);

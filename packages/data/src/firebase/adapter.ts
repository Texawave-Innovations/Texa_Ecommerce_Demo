import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut as fbSignOut, type Auth,
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit as qLimit, Timestamp, setDoc, deleteDoc, serverTimestamp, disableNetwork, enableNetwork, type Firestore, type DocumentData, type QueryConstraint,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from 'firebase/functions';
import { getDatabase, connectDatabaseEmulator, ref as rRef, onValue, type Database } from 'firebase/database';
import { getStorage, connectStorageEmulator, ref as sRef, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage';
import { ClaimsSchema, ORG_ID, type InboxItem, type UniChat, type UniEvent, type Approval, type AuditLog, type MasterDoc, type MasterVersion, type PosCustomer, type PosOutboxRow, type PosSku, type ReturnDoc, type SaleDoc, type ShiftDoc, type ZReportDoc } from '@texafashions/types';
import type { AdminRepo, AuthRepo, DataContext, MasterRepo, Session } from '../interfaces';
import type { ScmQuery, ScmRepo, Row } from '../scm';
import type { AiRepo } from '../ai';
import type { TwinRepo } from '../twin';
import type { TwinMeta, TwinPerson } from '@texafashions/domain';
import type { ParkedBill, PosRepo, ReservationRow, StockMap, TillRow } from '../pos';

export interface FirebaseConfig {
  apiKey: string; authDomain?: string; projectId: string; storageBucket?: string; appId?: string;
  /** Local Firebase Emulator Suite (free-plan demo). */
  useEmulators?: boolean;
  region?: string;
  databaseURL?: string;
  /** Enable IndexedDB persistence (POS). */
  offlinePersistence?: boolean;
  firestoreDatabaseId?: string;
}

/** Firestore Timestamp → ISO string, recursively. */
function plain<T = DocumentData>(data: DocumentData): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Timestamp) out[k] = v.toDate().toISOString();
    else if (Array.isArray(v)) out[k] = v.map((x) => (x instanceof Timestamp ? x.toDate().toISOString() : x));
    else if (v && typeof v === 'object' && !(v instanceof Date)) out[k] = plain(v as DocumentData);
    else out[k] = v;
  }
  return out as T;
}

export function createFirebaseContext(cfg: FirebaseConfig): DataContext {
  const host = '127.0.0.1';
  const fresh = getApps().length === 0;
  const app: FirebaseApp = fresh ? initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, storageBucket: cfg.storageBucket, appId: cfg.appId }) : getApps()[0]!;
  const auth: Auth = getAuth(app);
  let db: Firestore;
  if (fresh) {
    db = cfg.offlinePersistence
      ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, cfg.firestoreDatabaseId)
      : cfg.firestoreDatabaseId ? getFirestore(app, cfg.firestoreDatabaseId) : getFirestore(app);
  } else db = getFirestore(app);
  const fns: Functions = getFunctions(app, cfg.region ?? 'asia-south1');
  const storage: FirebaseStorage = getStorage(app);

  if (cfg.useEmulators && fresh) {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectFunctionsEmulator(fns, host, 5001);
    connectStorageEmulator(storage, host, 9199);
  }

  const call = async <I, O>(name: string, data?: I): Promise<O> => {
    try { return (await httpsCallable<I, O>(fns, name)(data)).data; }
    catch (e) {
      const err = e as { message?: string; details?: { errors?: { row: number; message: string }[] } };
      const details = err.details?.errors?.map((x) => `row ${x.row}: ${x.message}`).join('\n');
      throw new Error(details ? `${err.message}\n${details}` : (err.message ?? 'Request failed'), { cause: e });
    }
  };
  const orgCol = (name: string) => collection(db, 'orgs', ORG_ID, name);

  const authRepo: AuthRepo = {
    onSession(cb) {
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return cb(null);
        const tok = await u.getIdTokenResult();
        const parsed = ClaimsSchema.safeParse(tok.claims);
        if (!parsed.success) return cb(null);
        cb({ uid: u.uid, email: u.email ?? '', name: u.displayName ?? u.email ?? u.uid, claims: parsed.data } satisfies Session);
      });
    },
    async demoSignIn(role) {
      const { token } = await call<{ role: string }, { token: string }>('demoSignIn', { role });
      await signInWithCustomToken(auth, token);
      // displayName lives on the user record, claims on the token: force refresh so both are present.
      await auth.currentUser?.getIdToken(true);
    },
    async signInWithPassword(email, password) { await signInWithEmailAndPassword(auth, email, password); },
    async signOut() { await fbSignOut(auth); },
  };

  const toDoc = (id: string, d: DocumentData) => ({ ...plain(d), id }) as MasterDoc;
  const buildQuery = (master: string, o: { keyword?: string; limit?: number } = {}) => {
    const c = orgCol(master);
    const kw = o.keyword?.trim().toLowerCase();
    return kw
      ? query(c, where('searchKeywords', 'array-contains', kw), qLimit(o.limit ?? 500))
      : query(c, orderBy('code'), qLimit(o.limit ?? 1000));
  };

  const masters: MasterRepo = {
    async list(master, opts) {
      const snap = await getDocs(buildQuery(master, opts));
      return snap.docs.map((d) => toDoc(d.id, d.data())).filter((d) => opts?.includeInactive || d.status !== 'inactive');
    },
    subscribe(master, cb, opts) {
      return onSnapshot(buildQuery(master, opts), (snap) => {
        cb(snap.docs.map((d) => toDoc(d.id, d.data())).filter((d) => opts?.includeInactive || d.status !== 'inactive'));
      });
    },
    async get(master, id) {
      const s = await getDoc(doc(orgCol(master), id));
      return s.exists() ? toDoc(s.id, s.data()) : null;
    },
    async history(master, id) {
      const s = await getDocs(query(collection(db, 'orgs', ORG_ID, master, id, 'versions'), orderBy('version', 'desc')));
      return s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as MasterVersion);
    },
    submitChange: (input) => call('submitMasterChange', input),
    importRows: (input) => call('importMasters', input),
    async listApprovals(status) {
      const c = orgCol('approvals');
      const s = await getDocs(status ? query(c, where('status', '==', status), orderBy('requestedAt', 'desc'), qLimit(200)) : query(c, orderBy('requestedAt', 'desc'), qLimit(200)));
      return s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as Approval);
    },
    subscribePendingCount(cb) {
      return onSnapshot(query(orgCol('approvals'), where('status', '==', 'pending')), (s) => cb(s.size), () => cb(0));
    },
    async decide(approvalId, approve, note) { await call('decideApproval', { approvalId, approve, note }); },
    detectDuplicates: (master) => call('detectDuplicates', { master }),
    async uploadImage(master, id, file, fileName) {
      const r = sRef(storage, `orgs/${ORG_ID}/master/${master}/${id}/${Date.now()}-${fileName}`);
      await uploadBytes(r, file, { contentType: file.type || 'image/png' });
      return getDownloadURL(r);
    },
  };

  const admin: AdminRepo = {
    listUsers: () => call('listUsers'),
    async setClaims(uid, claims) { await call('setClaims', { uid, claims }); },
    demoControl: (action) => call('demoControl', { action }),
    async listAuditLogs(opts) {
      const c = orgCol('auditLogs');
      const q = opts?.entity ? query(c, where('entity', '==', opts.entity), orderBy('at', 'desc'), qLimit(opts.limit ?? 100)) : query(c, orderBy('at', 'desc'), qLimit(opts?.limit ?? 100));
      const s = await getDocs(q);
      return s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as AuditLog);
    },
  };

  const constraints = (q: ScmQuery = {}): QueryConstraint[] => [
    ...(q.where ?? []).map(([f, op, v]) => where(f, op === 'in' || op === '==' || op === '!=' || op === 'array-contains' ? op : '==', v)),
    ...(q.orderBy ? [orderBy(q.orderBy[0], q.orderBy[1] ?? 'asc')] : []),
    qLimit(q.limit ?? 300),
  ];
  const rowOf = (id: string, d: DocumentData) => ({ ...plain(d), id }) as Row;
  const scm: ScmRepo = {
    async list(coll, q) { return (await getDocs(query(orgCol(coll), ...constraints(q)))).docs.map((d) => rowOf(d.id, d.data())) as never; },
    async get(coll, id) { const s = await getDoc(doc(orgCol(coll), id)); return s.exists() ? (rowOf(s.id, s.data()) as never) : null; },
    subscribe(coll, q, cb) { return onSnapshot(query(orgCol(coll), ...constraints(q)), (s) => cb(s.docs.map((d) => rowOf(d.id, d.data())) as never), () => cb([])); },
    subscribeDoc(coll, id, cb) { return onSnapshot(doc(orgCol(coll), id), (s) => cb(s.exists() ? (rowOf(s.id, s.data()) as never) : null), () => cb(null)); },
    async listVersions(poId) { return (await getDocs(query(collection(db, 'orgs', ORG_ID, 'purchaseOrders', poId, 'versions'), orderBy('version', 'desc')))).docs.map((d) => rowOf(d.id, d.data())); },
    command: (name, input) => call(name, input),
    async uploadFile(path, file) { const r = sRef(storage, `orgs/${ORG_ID}/${path}`); await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' }); return `orgs/${ORG_ID}/${path}`; },
    async fileUrl(path) { return getDownloadURL(sRef(storage, path)); },
  };


  // ───────── POS (offline-first: every read is a snapshot so the IndexedDB cache keeps serving it without a network)
  const toSku = (id: string, d: DocumentData): PosSku => ({ id, code: d.code ?? id, name: d.name, barcode: d.barcode ?? '', departmentId: d.departmentId, categoryId: d.categoryId, subCategoryId: d.subCategoryId, brandId: d.brandId, character: d.character, colour: d.colour, hsn: d.hsn ?? '', gstRate: Number(d.gstRate ?? 0), mrpPaise: d.mrpPaise ?? d.pricePaise, pricePaise: d.pricePaise, imageUrl: d.imageUrl, badges: d.badges ?? [], isBlindBox: !!d.isBlindBox, isService: !!d.isService });
  const toCustomer = (id: string, d: DocumentData): PosCustomer => ({ id, code: d.code ?? id, name: d.name, mobile: d.mobile ?? '', tierId: d.tierId, pointsBalance: d.pointsBalance ?? 0, birthday: d.birthday, whatsappOptIn: !!d.whatsappOptIn, lifetimeSpendPaise: d.lifetimeSpendPaise ?? 0 });
  const byCreated = <T extends { createdAt?: string }>(a: T, b: T) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  const pos: PosRepo = {
    async staffList(storeId) { return call('posStaffList', { storeId }); },
    async pinLogin(storeId, employeeCode, pin) {
      const { token } = await call<unknown, { token: string }>('posPinLogin', { storeId, employeeCode, pin });
      await signInWithCustomToken(auth, token);
      await auth.currentUser?.getIdToken(true);
    },
    subscribeCatalogue(cb) { return onSnapshot(query(orgCol('skus'), orderBy('code'), qLimit(1500)), (s) => cb(s.docs.filter((d) => d.get('status') !== 'inactive').map((d) => toSku(d.id, d.data()))), () => cb([])); },
    subscribeStock(storeId, cb) {
      return onSnapshot(query(orgCol('stock'), where('locationId', '==', storeId), qLimit(2000)), (s) => {
        const m: StockMap = {}; s.docs.forEach((d) => { m[d.get('skuId')] = { onHand: d.get('onHand') ?? 0, reserved: d.get('reserved') ?? 0 }; }); cb(m);
      }, () => cb({}));
    },
    subscribePromotions(cb) { return onSnapshot(query(orgCol('promotions'), qLimit(200)), (s) => cb(s.docs.map((d) => ({ ...plain<DocumentData>(d.data()), id: d.id }) as never)), () => cb([])); },
    async warmCustomerCache() { const s = await getDocs(query(orgCol('customers'), orderBy('code'), qLimit(2500))); return s.size; },
    async findCustomers(q) {
      const kw = q.trim().toLowerCase(); if (kw.length < 2) return [];
      const s = await getDocs(query(orgCol('customers'), where('searchKeywords', 'array-contains', kw), qLimit(12)));
      return s.docs.map((d) => toCustomer(d.id, d.data()));
    },
    async getCustomer(id) { const s = await getDoc(doc(orgCol('customers'), id)); return s.exists() ? toCustomer(s.id, s.data()) : null; },
    async getVoucher(code) { const s = await getDoc(doc(orgCol('vouchers'), code.trim().toUpperCase())); return s.exists() ? ({ ...plain<DocumentData>(s.data()), id: s.id, code: s.id } as never) : null; },
    async getGiftCard(id) { const s = await getDoc(doc(orgCol('giftCards'), id.trim().toUpperCase())); return s.exists() ? { ...plain(s.data()), id: s.id } : null; },
    async getCreditNote(id) { const s = await getDoc(doc(orgCol('creditNotes'), id.trim())); return s.exists() ? { ...plain(s.data()), id: s.id } : null; },
    subscribeTills(storeId, cb) { return onSnapshot(query(orgCol('tills'), where('storeId', '==', storeId)), (s) => cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as TillRow).sort((a, b) => a.id.localeCompare(b.id))), () => cb([])); },
    subscribeShift(id, cb) { return onSnapshot(doc(orgCol('shifts'), id), (s) => cb(s.exists() ? ({ ...plain(s.data()), id: s.id } as ShiftDoc) : null), () => cb(null)); },
    subscribeSales(storeId, shiftId, cb) { return onSnapshot(query(orgCol('sales'), where('storeId', '==', storeId), where('shiftId', '==', shiftId), qLimit(500)), (s) => cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as SaleDoc).sort(byCreated)), () => cb([])); },
    subscribeReturns(storeId, shiftId, cb) { return onSnapshot(query(orgCol('returns'), where('storeId', '==', storeId), where('shiftId', '==', shiftId), qLimit(300)), (s) => cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as ReturnDoc).sort(byCreated)), () => cb([])); },
    subscribeSale(id, cb) { return onSnapshot(doc(orgCol('sales'), id), (s) => cb(s.exists() ? ({ ...plain(s.data()), id: s.id } as SaleDoc) : null), () => cb(null)); },
    async findSale(ref, storeId) {
      const r = ref.trim().replace(/^INV\|/, '');
      const direct = await getDoc(doc(orgCol('sales'), r));
      if (direct.exists()) { const x = { ...plain(direct.data()), id: direct.id } as SaleDoc; return x.storeId === storeId ? x : null; }
      const s = await getDocs(query(orgCol('sales'), where('storeId', '==', storeId), where('invoiceNo', '==', r), qLimit(1)));
      const d = s.docs[0]; return d ? ({ ...plain(d.data()), id: d.id } as SaleDoc) : null;
    },
    async recentSales(storeId, n = 25) {
      const s = await getDocs(query(orgCol('sales'), where('storeId', '==', storeId), orderBy('createdAt', 'desc'), qLimit(n)));
      return s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as SaleDoc);
    },
    async getZReport(id) { const s = await getDoc(doc(orgCol('zReports'), id)); return s.exists() ? ({ ...plain(s.data()), id: s.id } as ZReportDoc) : null; },
    subscribeOutbox(storeId, tillId, cb) {
      return onSnapshot(query(orgCol('posOutbox'), where('storeId', '==', storeId), where('tillId', '==', tillId), qLimit(200)), { includeMetadataChanges: true }, (s) => {
        cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id, unsynced: d.metadata.hasPendingWrites }) as PosOutboxRow).sort((a, b) => b.createdAtClient.localeCompare(a.createdAtClient)));
      }, () => cb([]));
    },
    enqueueOutbox(d) { setDoc(doc(orgCol('posOutbox'), d.clientSaleId), d).catch((e) => console.warn('outbox write rejected', e)); },
    subscribeParked(storeId, cb) { return onSnapshot(query(orgCol('parkedBills'), where('storeId', '==', storeId), qLimit(100)), (s) => cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as ParkedBill).sort(byCreated)), () => cb([])); },
    async saveParked(b) {
      const { id, ...rest } = b; const ref = doc(orgCol('parkedBills'), id);
      void setDoc(ref, { ...rest, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }).catch(() => undefined);   // never await: settles only on server ack
    },
    async deleteParked(id) { void deleteDoc(doc(orgCol('parkedBills'), id)).catch(() => undefined); },
    subscribeReservations(storeId, cb) { return onSnapshot(query(orgCol('reservations'), where('storeId', '==', storeId), qLimit(100)), (s) => cb(s.docs.map((d) => ({ ...plain(d.data()), id: d.id }) as ReservationRow).sort(byCreated)), () => cb([])); },
    async setNetwork(online) { if (online) await enableNetwork(db); else await disableNetwork(db); },
    command: (name, input) => call(name, input),
  };

  const ai: AiRepo = {
    async chat(history, chatId, onEvent, signal) {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sign in required');
      const base = cfg.useEmulators ? `http://${host}:5001/${cfg.projectId}/${cfg.region ?? 'asia-south1'}` : `https://${cfg.region ?? 'asia-south1'}-${cfg.projectId}.cloudfunctions.net`;
      const res = await fetch(`${base}/aiChat`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chatId, messages: history.map((m) => ({ role: m.role, content: m.text })) }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => 'Uni is unavailable'));
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) onEvent(JSON.parse(l) as UniEvent);
      }
    },
    async listChats() {
      const uid = auth.currentUser?.uid; if (!uid) return [];
      const snap = await getDocs(query(orgCol('aiChats'), where('userId', '==', uid), qLimit(30)));
      return snap.docs.map((d) => ({ ...plain<UniChat>(d.data()), id: d.id })).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    },
    subscribeInbox(cb) {
      const uid = auth.currentUser?.uid; if (!uid) { cb([]); return () => undefined; }
      return onSnapshot(query(orgCol('inbox'), where('userId', '==', uid), qLimit(200)),
        (s) => cb(s.docs.map((d) => ({ ...plain<InboxItem>(d.data()), id: d.id })).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))), () => cb([]));
    },
    async inboxAction(input) { await call('inboxAction', input); },
    runAlertsNow: () => call('runAlertsNow', {}),
    dailyBriefing: () => call('dailyBriefing', {}),
  };

  // RTDB is only needed by the Store Twin, so connect lazily.
  let rdb: Database | null = null;
  const rtdb = () => {
    if (!rdb) {
      rdb = getDatabase(app, cfg.databaseURL ?? `https://${cfg.projectId}-default-rtdb.firebaseio.com`);
      if (cfg.useEmulators) connectDatabaseEmulator(rdb, host, 9001);
    }
    return rdb;
  };
  const twin: TwinRepo = {
    subscribePeople(storeId, floorId, cb) {
      return onValue(rRef(rtdb(), `twin/${storeId}/${floorId}`), (snap) => {
        const v = snap.val() as { at?: number; people?: Record<string, Omit<TwinPerson, 'id'>> } | null;
        cb(Object.entries(v?.people ?? {}).map(([id, p]) => ({ ...p, id })), v?.at ?? 0);
      }, () => cb([], 0));
    },
    subscribeMeta(storeId, cb) {
      return onValue(rRef(rtdb(), `twin/${storeId}/meta`), (snap) => cb((snap.val() as TwinMeta | null) ?? null), () => cb(null));
    },
    subscribeNewSales(storeId, cb) {
      let first = true;
      return onSnapshot(query(orgCol('sales'), where('storeId', '==', storeId), orderBy('createdAt', 'desc'), qLimit(1)), (s) => {
        if (first) { first = false; return; }
        for (const c of s.docChanges()) if (c.type === 'added') cb({ id: c.doc.id, payablePaise: Number(c.doc.data().payablePaise ?? 0) });
      }, () => undefined);
    },
  };

  return { auth: authRepo, masters, admin, scm, pos, ai, twin };
}

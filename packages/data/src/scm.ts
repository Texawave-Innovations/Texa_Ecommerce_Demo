import type { CommandInput, CommandName, ScmCollection } from '@texafashions/types';
import type { Unsubscribe } from './interfaces';

export type Row<T = Record<string, any>> = T & { id: string };
export interface ScmQuery {
  where?: [field: string, op: '==' | '!=' | 'in' | 'array-contains', value: unknown][];
  orderBy?: [field: string, dir?: 'asc' | 'desc'];
  limit?: number;
}

/**
 * Procurement + inventory access. Reads are generic (collection + filters); every state change is a named command
 * that maps 1:1 to a callable function today and to `POST /v1/scm/<command>` on the NestJS API later.
 */
export interface ScmRepo {
  list<T = Record<string, any>>(collection: ScmCollection, q?: ScmQuery): Promise<Row<T>[]>;
  get<T = Record<string, any>>(collection: ScmCollection, id: string): Promise<Row<T> | null>;
  subscribe<T = Record<string, any>>(collection: ScmCollection, q: ScmQuery, cb: (rows: Row<T>[]) => void): Unsubscribe;
  subscribeDoc<T = Record<string, any>>(collection: ScmCollection, id: string, cb: (row: Row<T> | null) => void): Unsubscribe;
  /** Sub-collection of a PO (versions). */
  listVersions(poId: string): Promise<Row[]>;
  command<K extends CommandName>(name: K, input: CommandInput<K>): Promise<Record<string, any>>;
  /** Uploads to Cloud Storage and returns the storage path (store the path, not a URL). */
  uploadFile(path: string, file: Blob): Promise<string>;
  fileUrl(path: string): Promise<string>;
}

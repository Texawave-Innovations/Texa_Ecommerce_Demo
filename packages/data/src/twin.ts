import type { TwinMeta, TwinPerson } from '@texafashions/domain';
import type { Unsubscribe } from './interfaces';

/** Store Twin live feed. Maps to a WebSocket/SSE channel on the NestJS API later. */
export interface TwinRepo {
  /** 1 Hz anonymous positions for one floor (`/twin/{store}/{floor}/people`). */
  subscribePeople(storeId: string, floorId: string, cb: (people: TwinPerson[], at: number) => void): Unsubscribe;
  subscribeMeta(storeId: string, cb: (meta: TwinMeta | null) => void): Unsubscribe;
  /** Fires only for POS sales written after subscribing (drives the till ripple). */
  subscribeNewSales(storeId: string, cb: (sale: { id: string; payablePaise: number }) => void): Unsubscribe;
}

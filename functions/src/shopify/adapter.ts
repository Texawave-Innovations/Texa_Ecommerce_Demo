/** Shopify Admin adapter (rule 10): outbound inventory. Inbound traffic is the real HMAC-verified webhook; this outbound side runs against a mock store. */
export interface InventoryUpdate { skuId: string; variantId: string; quantity: number }
export interface InventoryResult { skuId: string; ok: boolean; error?: string }
export interface ShopifyAdmin {
  readonly name: string;
  setInventory(items: InventoryUpdate[]): Promise<InventoryResult[]>;
}

/** Mock store: accepts any item that carries a Shopify variant id. A real adapter would call Admin GraphQL `inventorySetQuantities` (needs inventory_item_id + location_id mapping). */
export class MockShopifyAdmin implements ShopifyAdmin {
  readonly name = 'Shopify (mock store)';
  async setInventory(items: InventoryUpdate[]): Promise<InventoryResult[]> {
    return items.map((i) => (!i.variantId ? { skuId: i.skuId, ok: false, error: 'No Shopify variant id on the SKU master' } : i.quantity < 0 ? { skuId: i.skuId, ok: false, error: 'Negative quantity refused' } : { skuId: i.skuId, ok: true }));
  }
}
export const shopifyAdmin: ShopifyAdmin = new MockShopifyAdmin();

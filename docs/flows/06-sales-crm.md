# Flow — Sales & CRM

```mermaid
flowchart LR
  SALE[sales + webOrders] --> RD[reports/salesDaily, salesHourly]
  RD --> DASH[Dashboard + target rings]
  SALE --> LOY[loyaltyLedger earn/burn] --> TIER[Tier upgrade Cutie→Bestie→Soulmate]
  SALE --> RFM[RFM + segments] --> CAMP[Campaign mock send] --> ATTR[Attribution]
  B2B[Quotation→SO→Proforma→Advance→Challan→Tax invoice]
  SALE --> COM[Commission feed → HR]
```

_Status: planned. Updated as built._

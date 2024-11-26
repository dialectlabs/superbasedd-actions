import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql, eq } from 'drizzle-orm';
import { DrizzleD1Database } from 'drizzle-orm/d1/driver';

// Define the schema for the `bp_merch_shipments` table
export const bpMerchShipments = sqliteTable('bp_merch_shipments', {
  sessionReference: text('session_reference').notNull().primaryKey(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  address: text('address').notNull(),
  walletAddress: text('wallet_address').notNull(),
  tShirt: text('t_shirt').notNull(),
  tShirtSize: text('t_shirt_size').notNull(),
  contact: text('contact'),
  burnTxSignature: text('burn_tx_signature'),
  burnTxReference: text('burn_tx_reference'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Define the strict TypeScript type for MerchShipment
export interface MerchShipment {
  sessionReference: string;
  name: string;
  country: string;
  address: string;
  walletAddress: string;
  tShirt: string;
  tShirtSize: string;
  contact?: string | null;
  burnTxSignature: string;
  burnTxReference?: string | null;
}

export async function upsertShipment(
  shipment: Omit<MerchShipment, 'burnTxSignature'>,
  db: DrizzleD1Database,
) {
  await db
    .insert(bpMerchShipments)
    .values({
      sessionReference: shipment.sessionReference,
      name: shipment.name,
      country: shipment.country,
      address: shipment.address,
      walletAddress: shipment.walletAddress,
      tShirt: shipment.tShirt,
      tShirtSize: shipment.tShirtSize,
      contact: shipment.contact ?? null,
      burnTxReference: shipment.burnTxReference ?? null,
    })
    .onConflictDoUpdate({
      target: bpMerchShipments.sessionReference,
      set: {
        name: shipment.name,
        country: shipment.country,
        address: shipment.address,
        walletAddress: shipment.walletAddress,
        tShirt: shipment.tShirt,
        tShirtSize: shipment.tShirtSize,
        contact: shipment.contact ?? null,
        burnTxReference: shipment.burnTxReference ?? null,
      },
    });
}

export async function updateBurnTxSignature(
  sessionReference: string,
  burnTxSignature: string,
  db: DrizzleD1Database,
) {
  await db
    .update(bpMerchShipments)
    .set({
      burnTxSignature: burnTxSignature,
    })
    .where(eq(bpMerchShipments.sessionReference, sessionReference));
}

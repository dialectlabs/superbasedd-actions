-- Migration number: 0001 	 2024-07-12T13:04:52.990Z
CREATE TABLE IF NOT EXISTS bp_merch_shipments (
    session_reference TEXT NOT NULL,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    t_shirt TEXT NOT NULL,
    t_shirt_size TEXT NOT NULL,
    contact TEXT,
    burn_tx_signature TEXT,
    burn_tx_reference TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (session_reference)
);

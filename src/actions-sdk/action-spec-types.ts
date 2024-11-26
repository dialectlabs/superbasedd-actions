import type { TransactionResponse } from '@solana/actions-spec';

export const X_ACTION_VERSION_HEADER = 'X-Action-Version';
export const X_BLOCKCHAIN_IDS_HEADER = 'X-Blockchain-Ids';

export const BlockchainIds = {
  SOLANA_MAINNET: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
};

export interface DialectTransactionResponse extends TransactionResponse {
  dialectExperimental?: {
    reference?: string;
  };
}

export interface BlinkMetadata {
  rows: MetadataRow[];
  extendedDescription?: string;
}

export interface MetadataRow {
  key: string;
  title: string;
  value: string;
  icon?: string;
  url?: string;
}

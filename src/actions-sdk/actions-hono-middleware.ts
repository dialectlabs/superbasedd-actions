import { type Env, Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import {
  BlockchainIds,
  X_ACTION_VERSION_HEADER,
  X_BLOCKCHAIN_IDS_HEADER
} from './action-spec-types';

export interface BlinkOptions {
  version?: string;
  blockchainIds?: string[];
}

export function configureHono<E extends Env = any>(
  app: Hono<E>,
  config?: BlinkOptions,
) {
  app.use(actionCors);
  app.use(
    actionSupportability(
      config?.version ?? '2.4.2',
      config?.blockchainIds ?? [BlockchainIds.SOLANA_MAINNET],
    ),
  );
}

export const actionCors = cors({
  origin: '*',
  exposeHeaders: [X_ACTION_VERSION_HEADER, X_BLOCKCHAIN_IDS_HEADER],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Content-Encoding',
    'Authorization',
    'Accept-Encoding',
    'X-Accept-Action-Version',
    'X-Accept-Blockchain-Ids',
  ],
});

export const actionSupportability = (version: string, blockchains: string[]) =>
  createMiddleware(async (c, next) => {
    await next();
    c.res.headers.set(X_ACTION_VERSION_HEADER, version);
    c.res.headers.set(X_BLOCKCHAIN_IDS_HEADER, blockchains.join(','));
  });

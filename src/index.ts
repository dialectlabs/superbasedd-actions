import { Hono } from 'hono';
import { Buffer } from 'node:buffer';

import {
  ActionError,
  ActionGetResponse,
  ActionPostRequest,
  CompletedAction,
  NextActionPostRequest,
} from '@solana/actions-spec';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createSplTokenTransferIx,
  getBalance,
  prepareTransaction,
} from './utils';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  AssetV1,
  burn,
  fetchAssetsByOwner,
  fetchCollection,
  mplCore,
} from '@metaplex-foundation/mpl-core';
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
} from '@metaplex-foundation/umi';

import { drizzle } from 'drizzle-orm/d1';
import { updateBurnTxSignature, upsertShipment } from './db';
import { generateBlinkReferenceIx } from './actions-sdk/reference-instruction-utils';
import { DialectTransactionResponse } from './actions-sdk/action-spec-types';
import { configureHono } from './actions-sdk/actions-hono-middleware';

if (globalThis.Buffer === undefined) {
  globalThis.Buffer = Buffer;
}

type Bindings = { SOLANA_RPC_URL: string; DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

const ACTION_IMAGE =
  'https://ucarecdn.com/6f0bf147-e745-45c8-b181-e8869b7577bc/-/preview/880x880/-/format/auto/-/quality/smart/';

const SB_MERCH_COLLECTION_ADDRESS =
  '96zvmKqKJJ7LBx6PqQhPDTmCXaVnqiqMJSgHwgbtbiyq';

const DELIVERY_FEES_ADDRESS = '9yhrkxMKfvzzaUDYcwxNCwsgVbjyC2u9dYCA3166GsCt';
const DELIVERY_FEE_USDC_AMOUNT = 15;
const USDC_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

const WINNER_NFT_NAMES = [
  'OG SOL BROTHERS TEE',
  'DONALD TRUMP TEE',
  'FTX THE MOVIE',
  'JUNK MAIL TEE',
  'LA BIKER TEE',
];

configureHono(app, {
  version: '2.2',
});

app.get('/bp-merch', async (c) => {
  const sessionReference = Keypair.generate().publicKey.toString();
  return c.json({
    title: 'Redeem your Superbasedd T-Shirt',
    description: `Redeem your Superbasedd T-Shirt via this blink. The shipping fee is ${DELIVERY_FEE_USDC_AMOUNT} USDC, please make sure you have enough funds in your wallet.`,
    label: 'Redeem your Superbasedd T-Shirt',
    icon: ACTION_IMAGE,
    links: {
      actions: [
        {
          type: 'transaction',
          href: `/bp-merch/check-redeem-eligibility?sessionReference=${sessionReference}`,
          label: 'Check eligibility',
        },
      ],
    },
  } satisfies ActionGetResponse);
});

app.post('/bp-merch/check-redeem-eligibility', async (c) => {
  const connection = new Connection(c.env.SOLANA_RPC_URL);
  const sessionReference = c.req.query('sessionReference');

  console.log(`check elig sessionReference: ${sessionReference}`);
  const { account } = await c.req.json<ActionPostRequest>();
  const redeemableNfts = await findRedeemableNfts(account, connection);
  if (redeemableNfts.length === 0) {
    return c.json({ message: 'No T-Shirts to redeem' } satisfies ActionError, {
      status: 422,
    });
  }

  const hasSufficientFundsToPayDeliveryFee = await hasSufficientBalance(
    account,
    connection,
  );
  if (!hasSufficientFundsToPayDeliveryFee) {
    return c.json(
      {
        message: 'Insufficient funds to pay shipping fee',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }

  const { reference, referenceIx } = generateBlinkReferenceIx();
  const transaction = await prepareTransaction(
    [referenceIx],
    new PublicKey(account),
    connection,
  );

  return c.json({
    type: 'transaction',
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    dialectExperimental: {
      reference: reference.toString(),
    },
    links: {
      next: {
        type: 'post',
        href: `/bp-merch/fill-shipment-form?sessionReference=${sessionReference}`,
      },
    },
  } satisfies DialectTransactionResponse);
});

async function hasSufficientBalance(account: string, connection: Connection) {
  const accountBalance =
    Number(
      (await getBalance(
        new PublicKey(account),
        connection,
        new PublicKey(USDC_ADDRESS),
      )) ?? 0,
    ) /
    10 ** USDC_DECIMALS;
  console.log(`Account balance: ${accountBalance}`);

  return accountBalance >= DELIVERY_FEE_USDC_AMOUNT;
}

app.post('/bp-merch/fill-shipment-form', async (c) => {
  const connection = new Connection(c.env.SOLANA_RPC_URL);

  const { account } = await c.req.json<ActionPostRequest>();

  const sessionReference = c.req.query('sessionReference');
  const redeemableNfts = await findRedeemableNfts(account, connection);
  if (redeemableNfts.length === 0) {
    return c.json({
      title: 'Redeem your Superbasedd T-Shirt',
      description: 'No T-Shirts to redeem',
      label: 'Not available',
      disabled: true,
      icon: ACTION_IMAGE,
    } satisfies ActionGetResponse);
  }
  const hasSufficientFundsToPayDeliveryFee = await hasSufficientBalance(
    account,
    connection,
  );

  const uniqueNftNames = Array.from(
    new Set(redeemableNfts.map((it) => it.name)),
  );

  return c.json({
    type: 'action',
    title: 'Redeem your Superbasedd T-Shirt',
    description: `Redeem your Superbasedd T-Shirt via this blink. The shipping fee is ${DELIVERY_FEE_USDC_AMOUNT} USDC, please make sure you have enough funds in your wallet.`,
    label: 'Redeem your Superbasedd T-Shirt',
    icon: ACTION_IMAGE,
    disabled: !hasSufficientFundsToPayDeliveryFee,
    links: {
      actions: [
        {
          type: 'transaction',
          label: !hasSufficientFundsToPayDeliveryFee
            ? 'Insufficient funds'
            : 'Redeem',
          href: `/bp-merch/redeem?sessionReference=${sessionReference}`,
          parameters: [
            {
              label: 'Name',
              name: 'name',
              type: 'text',
              required: true,
            },
            {
              label: 'Country',
              name: 'country',
              type: 'text',
              required: true,
            },
            {
              label: 'Address',
              name: 'address',
              type: 'textarea',
              required: true,
            },
            {
              label: 'Email',
              name: 'email',
              type: 'email',
              required: true,
            },
            {
              label: 'T-Shirt',
              name: 'nftName',
              type: 'select',
              options: [
                ...uniqueNftNames.map((it) => ({
                  label: it,
                  selected: false,
                  value: it,
                })),
              ],
              required: true,
            },
            {
              label: 'Size',
              name: 'size',
              type: 'select',
              options: [
                { label: 'Small', value: 's' },
                { label: 'Medium', value: 'm' },
                { label: 'Large', value: 'l' },
                { label: 'X-Large', value: 'xl' },
              ],
              required: true,
            },
          ],
        },
      ],
    },
  } satisfies ActionGetResponse);
});

interface RedeemFormData {
  name: string;
  address: string;
  country: string;
  nftName: string;
  size: string;
  email: string;
}

app.post('/bp-merch/redeem', async (c) => {
  const connection = new Connection(c.env.SOLANA_RPC_URL);
  const { account, data } = await c.req.json<{
    data: RedeemFormData;
    account: string;
  }>();
  const sessionReference = c.req.query('sessionReference');
  if (!sessionReference) {
    console.error('Missing sessionReference');
    return c.json(
      {
        message: 'Redeem not available',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }
  const hasSufficientFundsToPayDeliveryFee = await hasSufficientBalance(
    account,
    connection,
  );
  if (!hasSufficientFundsToPayDeliveryFee) {
    return c.json(
      {
        message: 'Insufficient funds to pay shipping fee',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }
  console.log('data', data, 'sessionReference', sessionReference);

  const redeemableNfts = await findRedeemableNfts(account, connection);

  if (
    !data?.nftName ||
    !data?.address ||
    !data?.country ||
    !data?.size ||
    !data?.name ||
    !data?.email
  ) {
    console.error(`Invalid data: ${JSON.stringify(data)}`);
    return c.json(
      {
        message: 'Redeem not available',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }

  const nftToRedeem = redeemableNfts.find((it) => it.name === data.nftName);

  if (!nftToRedeem) {
    console.error(
      `Invalid NFT name: ${data.nftName}, available names: ${redeemableNfts.map((it) => it.name).join(', ')}`,
    );
    return c.json(
      {
        message: 'Redeem not available',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }

  try {
    const burnTxReference = sessionReference;
    const transaction = await prepareRedeemTransaction(
      nftToRedeem,
      burnTxReference,
      account,
      connection,
    );
    const db = drizzle(c.env.DB);
    await upsertShipment(
      {
        sessionReference: sessionReference,
        burnTxReference,
        name: data.name,
        address: data.address,
        country: data.country,
        tShirt: data.nftName,
        tShirtSize: data.size,
        contact: data.email,
        walletAddress: account,
      },
      db,
    );
    return c.json({
      type: 'transaction',
      transaction: Buffer.from(transaction.serialize()).toString('base64'),
      dialectExperimental: {
        reference: burnTxReference,
      },
      links: {
        next: {
          href: `/bp-merch/completed?sessionReference=${sessionReference}`,
          type: 'post',
        },
      },
    } satisfies DialectTransactionResponse);
  } catch (e) {
    console.error('Failed to prepare redeem transaction', e);
    return c.json(
      {
        message: 'Redeem not available, please try again later',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }
});

app.post('/bp-merch/completed', async (c) => {
  const sessionReference = c.req.query('sessionReference');

  if (!sessionReference) {
    console.error('Missing sessionReference');
    return c.json(
      {
        message: 'Redeem not available',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }
  const { signature } = await c.req.json<NextActionPostRequest>();

  if (!signature) {
    console.error('Missing signature');
    return c.json(
      {
        message: 'Transaction signature is required',
      } satisfies ActionError,
      {
        status: 422,
      },
    );
  }

  c.executionCtx.waitUntil(
    updateBurnTxSignature(sessionReference, signature, drizzle(c.env.DB)),
  );

  return c.json({
    type: 'completed',
    title: 'Redeem your Superbasedd T-Shirt',
    description: 'Redeem your Superbasedd T-Shirt via this blink',
    label: 'Completed',
    icon: ACTION_IMAGE,
  } satisfies CompletedAction);
});

async function findRedeemableNfts(owner: string, connection: Connection) {
  const umi = createUmi(connection).use(mplCore());
  const assets = await fetchAssetsByOwner(umi, publicKey(owner));
  return assets
    .filter((it) => it.updateAuthority.address === SB_MERCH_COLLECTION_ADDRESS)
    .filter((it) => WINNER_NFT_NAMES.includes(it.name));
}

async function prepareRedeemTransaction(
  asset: AssetV1,
  burnTxReference: string,
  account: string,
  connection: Connection,
) {
  const noopSigner = createNoopSigner(publicKey(account));
  const umi = createUmi(connection).use(mplCore());
  umi.use(signerIdentity(noopSigner, true));

  const collection = await fetchCollection(
    umi,
    publicKey(SB_MERCH_COLLECTION_ADDRESS),
  );

  const burnIxs = burn(umi, {
    asset,
    collection,
  })
    .useV0()
    .getInstructions()
    .map((it) => {
      return new TransactionInstruction({
        data: Buffer.from(it.data),
        keys: it.keys.map((key) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        programId: new PublicKey(it.programId),
      }) satisfies TransactionInstruction;
    });

  const { referenceIx } = generateBlinkReferenceIx(
    new PublicKey(burnTxReference),
  );
  const feesTransferIx = await createSplTokenTransferIx(
    {
      amount: DELIVERY_FEE_USDC_AMOUNT * 10 ** USDC_DECIMALS,
      payerWalletAddress: account,
      payeeWalletAddress: DELIVERY_FEES_ADDRESS,
      tokenMintAddress: USDC_ADDRESS,
    },
    connection,
  );

  return prepareTransaction(
    [...burnIxs, feesTransferIx, referenceIx],
    new PublicKey(account),
    connection,
  );
}

export default app;

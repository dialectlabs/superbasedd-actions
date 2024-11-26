import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';

export async function prepareTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  connection: Connection,
) {
  const blockhash = await connection
    .getLatestBlockhash({ commitment: 'max' })
    .then((res) => res.blockhash);
  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(messageV0);
}

export async function getBalance(
  accountAddress: PublicKey,
  connection: Connection,
  tokenMintAddress?: PublicKey,
): Promise<bigint | null> {
  if (!tokenMintAddress) {
    const balance = await connection.getBalance(accountAddress);
    return BigInt(balance);
  }
  const { account } = await getAssociatedTokenAccount(
    accountAddress,
    tokenMintAddress,
    connection,
  );
  return account?.amount ?? null;
}

async function getAssociatedTokenAccount(
  accountAddress: PublicKey,
  tokenMintAddress: PublicKey,
  connection: Connection,
) {
  const associatedTokenAccountAddress = await getAssociatedTokenAddress(
    tokenMintAddress,
    accountAddress,
  );
  try {
    const account = await getAccount(connection, associatedTokenAccountAddress);
    return {
      associatedTokenAccountAddress,
      account,
    };
  } catch (e) {
    if (
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError
    ) {
      return {
        associatedTokenAccountAddress,
        account: null,
      };
    }
    throw e;
  }
}

export async function createSplTokenTransferIx(
  params: {
    tokenMintAddress: string;
    payerWalletAddress: string;
    payeeWalletAddress: string;
    amount: number;
  },
  connection: Connection,
) {
  const tokenMintAddress = new PublicKey(params.tokenMintAddress);
  const payerWalletAddress = new PublicKey(params.payerWalletAddress);
  const payeeWalletAddress = new PublicKey(params.payeeWalletAddress);
  const [
    { account: payerAssociatedTokenAccount },
    {
      account: payeeAssociatedTokenAccount,
      associatedTokenAccountAddress: payeeAssociatedTokenAccountAddress,
    },
  ] = await Promise.all([
    getAssociatedTokenAccount(payerWalletAddress, tokenMintAddress, connection),
    getAssociatedTokenAccount(payeeWalletAddress, tokenMintAddress, connection),
    connection.getLatestBlockhash(),
  ]);
  if (!payerAssociatedTokenAccount) {
    throw new Error(
      `Payer wallet ${payerWalletAddress.toBase58()} does not have an associated token account for token ${tokenMintAddress.toBase58()}`,
    );
  }
  if (!payeeAssociatedTokenAccount) {
    throw new Error(
      `Payee wallet ${payeeWalletAddress.toBase58()} does not have an associated token account for token ${tokenMintAddress.toBase58()}`,
    );
  }

  return createTransferInstruction(
    payerAssociatedTokenAccount.address,
    payeeAssociatedTokenAccountAddress,
    payerWalletAddress,
    BigInt(params.amount),
  );
}

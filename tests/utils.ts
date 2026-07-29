import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { K_LEND_PROGRAM_ID, K_FARMS_PROGRAM_ID } from "./constants";


async function surfnetRpc(connection: Connection, method: string, params: any[]) {
  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if ((json as any).error)
    throw new Error(`${method} failed: ${JSON.stringify((json as any).error)}`);
  return (json as any).result;
}

/** Set an account's SOL balance (creating it if needed). */
export function surfnetAirdrop(
  connection: Connection,
  address: PublicKey,
  lamports: number
) {
  return surfnetRpc(connection, "surfnet_setAccount", [
    address.toBase58(),
    { lamports },
  ]);
}

/** Mint/set an SPL token balance for `owner` (creates/sets the ATA). */
export function surfnetTokenAirdrop(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  amount: number | bigint
) {
  return surfnetRpc(connection, "surfnet_setTokenAccount", [
    owner.toBase58(),
    mint.toBase58(),
    { amount: Number(amount), state: "initialized" },
  ]);
}

/** Continuously mirror a live mainnet account into the local Surfpool session. */
export function surfnetStreamAccount(connection: Connection, address: PublicKey) {
  return surfnetRpc(connection, "surfnet_streamAccount", [address.toBase58()]);
}


export async function sendV0Tx(opts: {
  connection: Connection;
  payerKeypair: Keypair;
  ixs: TransactionInstruction[];
  lookupTables?: AddressLookupTableAccount[];
  cuLimit?: number;
  cuPrice?: number;
  extraSigners?: Keypair[];
}): Promise<string> {
  const {
    connection,
    payerKeypair,
    ixs,
    lookupTables = [],
    cuLimit = 400_000,
    cuPrice = 1,
    extraSigners = [],
  } = opts;

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
    ...ixs,
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  tx.sign([payerKeypair, ...extraSigners]);

  const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
  try {
    await connection.confirmTransaction(sig, "confirmed");
  } catch (error) {
    // A failed confirmation still refers to an on-chain transaction. Preserve its
    // signature so callers can inspect the logs and link to the local explorer.
    if (error && typeof error === "object") {
      Object.assign(error, { signature: sig });
    }
    throw error;
  }
  return sig;
}


export function obligationAccount(
  owner: PublicKey,
  market: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]), // tag
      Buffer.from([0]), // id
      owner.toBuffer(),
      market.toBuffer(),
      PublicKey.default.toBuffer(),
      PublicKey.default.toBuffer(),
    ],
    K_LEND_PROGRAM_ID
  );
  return pda;
}

export function userMetadataAccount(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_meta"), owner.toBuffer()],
    K_LEND_PROGRAM_ID
  );
  return pda;
}

export function obligationFarmStatePda(
  farm: PublicKey,
  obligation: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), farm.toBuffer(), obligation.toBuffer()],
    K_FARMS_PROGRAM_ID
  );
  return pda;
}

/**
 * Read a Kamino reserve's collateral/debt farm pubkeys straight from account
 * bytes (offsets from klend Reserve layout):
 *   0..8 disc, 8..16 version, 16..32 lastUpdate, 32..64 lendingMarket,
 *   64..96 farmCollateral, 96..128 farmDebt
 */
export async function getReserveFarms(
  connection: Connection,
  reserve: PublicKey
): Promise<{ collateralFarm: PublicKey; debtFarm: PublicKey }> {
  const info = await connection.getAccountInfo(reserve);
  if (!info) throw new Error(`reserve ${reserve.toBase58()} not found`);
  const data = info.data;
  return {
    collateralFarm: new PublicKey(data.subarray(64, 96)),
    debtFarm: new PublicKey(data.subarray(96, 128)),
  };
}

export function getAtaAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true, // allowOwnerOffCurve
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export async function createLookupTable(
  connection: Connection,
  payer: Keypair,
  addresses: PublicKey[]
): Promise<AddressLookupTableAccount> {
  const slot = await connection.getSlot("confirmed");
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  // De-dupe, exclude the payer (it's always in the static keys).
  const unique = [
    ...new Map(
      addresses
        .filter((a) => !a.equals(payer.publicKey))
        .map((a) => [a.toBase58(), a])
    ).values(),
  ];

  await sendV0Tx({ connection, payerKeypair: payer, ixs: [createIx] });

  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lutAddress,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: chunk,
    });
    await sendV0Tx({ connection, payerKeypair: payer, ixs: [extendIx] });
  }

  // Poll until the LUT is retrievable and populated.
  for (let i = 0; i < 15; i++) {
    const res = await connection.getAddressLookupTable(lutAddress);
    if (res.value && res.value.state.addresses.length >= unique.length)
      return res.value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("lookup table did not populate in time");
}

// little-endian byte packers 
export const u8 = (v: number) => Buffer.from([v & 0xff]);
export const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
export const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
export const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
export const meta = (
  pubkey: PublicKey,
  isWritable = false,
  isSigner = false
) => ({ pubkey, isWritable, isSigner });

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

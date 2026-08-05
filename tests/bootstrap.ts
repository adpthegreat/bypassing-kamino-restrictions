import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  FLAG_HAS_COLLATERAL,
  FLAG_HAS_BORROWS,
  JUP_LEND_BORROW_PROGRAM_ID,
} from "./constants";
import { PairContext } from "./market";
import {
  surfnetAirdrop,
  surfnetTokenAirdrop,
  surfnetStreamAccount,
  sendV0Tx,
  obligationAccount,
  userMetadataAccount,
  obligationFarmStatePda,
  getAtaAddress,
} from "./utils";
import {
  initKaminoIx,
  depositKaminoIx,
  borrowKaminoIx,
  initJupiterIx,
} from "./program-instructions";

const { getJupLendBorrow } = require("./jup_lend_loader.js");

export interface Ctx {
  connection: Connection;
  payer: Keypair;
  pair: PairContext;
  obligation: PublicKey;
  userMetadata: PublicKey;
  collateralAta: PublicKey;
  debtAta: PublicKey;
  collateralObligationFarmState: PublicKey;
  debtObligationFarmState: PublicKey;
  // named signatures for every transaction the test sends, in order
  steps: { name: string; signature: string }[];
}

export async function createCtx(
  connection: Connection,
  pair: PairContext
): Promise<Ctx> {
  const payer = Keypair.generate();
  const obligation = obligationAccount(payer.publicKey, pair.market);
  return {
    connection,
    payer,
    pair,
    obligation,
    userMetadata: userMetadataAccount(payer.publicKey),
    collateralAta: getAtaAddress(pair.collateralMint, payer.publicKey),
    debtAta: getAtaAddress(pair.debtMint, payer.publicKey),
    // farm addresses come from the pair; the per-obligation farm-state is a PDA
    collateralObligationFarmState: obligationFarmStatePda(
      pair.collateral.collateralFarm,
      obligation
    ),
    debtObligationFarmState: obligationFarmStatePda(pair.debt.debtFarm, obligation),
    steps: [],
  };
}

// A mainnet-fork's clock and its lazily-cloned accounts can be momentarily out of
// sync — too fresh right after start, or drifted after a long session — which
// overflows the protocols' time-based interest math. The transient case clears as
// slots advance, so retry these specific errors.
function isTimeMathError(e: any): boolean {
  const blob = [
    e?.message,
    (e?.simulation?.logs || []).join("\n"),
    (e?.logs || e?.transactionLogs || []).join("\n"),
  ].join("\n");
  return /No return data found in logs|LibraryMathError|LIBRARY_MATH_ERROR|MathOverflow|Math operation overflow|token_reserve\.rs|last_update\.rs/i.test(
    blob
  );
}

export async function retryTimeMath<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (isTimeMathError(e) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 8000)); // let slots advance
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** Send a transaction and record it as a named step in ctx.steps. */
async function sendStep(
  ctx: Ctx,
  name: string,
  ixs: any[],
  opts: { lookupTables?: any[]; cuLimit?: number } = {}
): Promise<string> {
  const signature = await retryTimeMath(() =>
    sendV0Tx({
      connection: ctx.connection,
      payerKeypair: ctx.payer,
      ixs,
      lookupTables: opts.lookupTables,
      cuLimit: opts.cuLimit,
    })
  );
  ctx.steps.push({ name, signature });
  return signature;
}

/** A local-solscan link that points the real solscan.io UI at the surfnet RPC. */
export function solscanLink(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=custom&customUrl=${ctx_rpc()}/`;
}
function ctx_rpc() {
  return process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
}

/** Print every recorded step with its local-solscan link (call at test end). */
export function printStepLinks(ctx: Ctx, title = "Steps (open each in solscan)") {
  const line = "─".repeat(78);
  console.log(`\n${line}\n  ${title}\n${line}`);
  ctx.steps.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${s.name}`);
    console.log(`      ${solscanLink(s.signature)}`);
  });
  console.log(line);
}

/** Stream the pair's price-sensitive accounts and fund the payer. */
export async function prepare(ctx: Ctx): Promise<void> {
  const { connection, payer } = ctx;
  for (const a of ctx.pair.streamAccounts) await surfnetStreamAccount(connection, a);
  await surfnetAirdrop(connection, payer.publicKey, 1000 * 1e9);
}

export async function tokenAirdrop(ctx: Ctx, mint: PublicKey, amount: bigint) {
  await surfnetTokenAirdrop(ctx.connection, ctx.payer.publicKey, mint, amount);
}

/** init the Kamino obligation + both farm states (no deposit yet). */
export async function initKaminoObligation(ctx: Ctx): Promise<void> {
  const { payer, pair } = ctx;
  const initCollateral = initKaminoIx({
    pair,
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: pair.collateral.reserve,
    obligationFarmState: ctx.collateralObligationFarmState,
    reserveFarmState: pair.collateral.collateralFarm,
    mode: 0,
  });
  await sendStep(ctx, "Init Kamino obligation — collateral farm", [initCollateral]);

  const initDebt = initKaminoIx({
    pair,
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: pair.debt.reserve,
    obligationFarmState: ctx.debtObligationFarmState,
    reserveFarmState: pair.debt.debtFarm,
    mode: 1,
  });
  await sendStep(ctx, "Init Kamino obligation — debt farm", [initDebt]);
}

/** init + deposit collateral + borrow debt on Kamino. */
export async function openKaminoLoan(
  ctx: Ctx,
  depositAmount: bigint,
  borrowAmount: bigint
): Promise<void> {
  const { payer, pair } = ctx;
  await initKaminoObligation(ctx);

  // Fresh obligation holds no reserves yet → refresh-obligation must see 0
  // reserves → flags = 0 on the first deposit.
  await tokenAirdrop(ctx, pair.collateralMint, depositAmount * 2n);
  const deposit = depositKaminoIx({
    pair,
    owner: payer.publicKey,
    obligation: ctx.obligation,
    collateralAta: ctx.collateralAta,
    collateralObligationFarmState: ctx.collateralObligationFarmState,
    amount: depositAmount,
    flags: 0,
  });
  await sendStep(ctx, "Deposit collateral into Kamino", [deposit], { cuLimit: 600_000 });

  // Seed a debt-token balance so the destination ATA exists to receive the borrow.
  await tokenAirdrop(ctx, pair.debtMint, 1_000_000n);
  const borrow = borrowKaminoIx({
    pair,
    owner: payer.publicKey,
    obligation: ctx.obligation,
    debtAta: ctx.debtAta,
    debtObligationFarmState: ctx.debtObligationFarmState,
    amount: borrowAmount,
    flags: FLAG_HAS_COLLATERAL, // has the deposit, no borrow yet
    reserveAccounts: [pair.collateral.reserve],
  });
  await sendStep(ctx, "Borrow debt from Kamino", [borrow], { cuLimit: 600_000 });
}

/** Read the vault's next position id from its state account (u32 LE @ 115). */
export async function nextJupiterPositionId(ctx: Ctx): Promise<number> {
  const borrow = await getJupLendBorrow();
  const initCtx = borrow.getInitPositionContext(
    ctx.pair.jupiterVaultId,
    1,
    ctx.payer.publicKey,
    ctx.pair.jupiterMarket
  );
  const info = await ctx.connection.getAccountInfo(new PublicKey(initCtx.vaultState));
  if (!info) throw new Error("jupiter vault state not found");
  return info.data.readUInt32LE(115);
}

export async function openJupiterPosition(
  ctx: Ctx,
  positionId: number
): Promise<void> {
  const borrow = await getJupLendBorrow();
  const c = borrow.getInitPositionContext(
    ctx.pair.jupiterVaultId,
    positionId,
    ctx.payer.publicKey,
    ctx.pair.jupiterMarket
  );
  const ixn = initJupiterIx({
    owner: ctx.payer.publicKey,
    vaultAdmin: new PublicKey(c.vaultAdmin),
    vaultState: new PublicKey(c.vaultState),
    position: new PublicKey(c.position),
    positionMint: new PublicKey(c.positionMint),
    positionTokenAccount: new PublicKey(c.positionTokenAccount),
    metadataAccount: new PublicKey(c.metadataAccount),
    vaultId: ctx.pair.jupiterVaultId,
    nextPositionId: positionId,
  });
  await sendStep(ctx, "Open Jupiter Lend position", [ixn], { cuLimit: 600_000 });
}

import {
  buildJupiterOperateAccounts,
  buildKaminoBlock,
  buildRefinanceIx,
} from "./refinance-helpers";
import { createLookupTable } from "./utils";
import { U64_MAX, MIN_I128 } from "./constants";
import { depositAndBorrowJuplendIx } from "./program-instructions";

/** Keep only the Jupiter setup ixs whose target account is not yet initialized. */
async function liveSetupIxs(ctx: Ctx, raw: any[]): Promise<any[]> {
  const kept: any[] = [];
  for (const six of raw) {
    const target = six.keys.find((k: any) => k.isWritable && !k.isSigner)?.pubkey;
    const exists = target
      ? (await ctx.connection.getAccountInfo(target)) !== null
      : false;
    if (!exists) kept.push(six);
  }
  return kept;
}

function kaminoBlockFor(ctx: Ctx) {
  return buildKaminoBlock({
    pair: ctx.pair,
    owner: ctx.payer.publicKey,
    obligation: ctx.obligation,
    collateralObligationFarmState: ctx.collateralObligationFarmState,
    debtObligationFarmState: ctx.debtObligationFarmState,
    collateralAta: ctx.collateralAta,
    debtAta: ctx.debtAta,
  });
}

async function jupiterOperate(ctx: Ctx, positionId: number, col: bigint, debt: bigint) {
  const borrow = await getJupLendBorrow();
  // getOperateContext simulates getExchangePrices, which can hit the transient
  // fork time-math error — retry it.
  return retryTimeMath<any>(() =>
    borrow.getOperateContext({
      vaultId: ctx.pair.jupiterVaultId,
      positionId,
      colAmount: new BN(col.toString()),
      debtAmount: new BN(debt.toString()),
      connection: ctx.connection,
      signer: ctx.payer.publicKey,
      market: ctx.pair.jupiterMarket,
    })
  );
}

/**
 * Jupiter Lend flashloan borrow + payback of `amount` of the debt token. The
 * flashloan program is jupg… — NOT the restricted jupr81 — so putting it at the
 * top level does not trip Kamino's scan.
 */
async function flashIxs(ctx: Ctx, amount: bigint) {
  const { getJupLendFlashloan } = require("./jup_lend_loader.js");
  const fl = await getJupLendFlashloan();
  const args = {
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    amount: new BN(amount.toString()),
    asset: ctx.pair.debtMint,
    market: ctx.pair.jupiterMarket,
  };
  return {
    borrowIx: await fl.getFlashBorrowIx(args),
    repayIx: await fl.getFlashPaybackIx(args),
  };
}

/** A bare top-level jupr81 (restricted-program) ix used only by the control demo. */
function bareTopLevelJupr81(ctx: Ctx): TransactionInstruction {
  return new TransactionInstruction({
    programId: JUP_LEND_BORROW_PROGRAM_ID, // jupr81…
    keys: [{ pubkey: ctx.payer.publicKey, isWritable: false, isSigner: true }],
    data: Buffer.from([217, 106, 208, 99, 116, 151, 42, 135]), // operate disc
  });
}


export async function refinanceKaminoToJupiter(
  ctx: Ctx,
  positionId: number,
  depositAmount: bigint,
  borrowAmount: bigint,
  opts: { topLevelJupiter?: boolean } = {}
): Promise<string> {
  const operate = await jupiterOperate(ctx, positionId, depositAmount, borrowAmount);

  const refinanceIx = buildRefinanceIx({
    direction: "kamino-to-jup",
    jupiterAccounts: buildJupiterOperateAccounts(
      operate.accounts,
      operate.remainingAccounts,
      ctx.payer.publicKey
    ),
    kaminoBlock: kaminoBlockFor(ctx),
    amounts: {
      sourceRepay: U64_MAX, // repay ALL Kamino debt
      sourceWithdraw: U64_MAX, // withdraw ALL Kamino collateral
      destDeposit: depositAmount,
      destBorrow: borrowAmount,
      kaminoFlag: FLAG_HAS_COLLATERAL | FLAG_HAS_BORROWS,
      indices: operate.remainingAccountsIndices,
    },
  });

  const { borrowIx: flashBorrow, repayIx: flashRepay } = await flashIxs(ctx, borrowAmount);
  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const post = opts.topLevelJupiter ? [bareTopLevelJupr81(ctx)] : [];

  const ixs = [flashBorrow, ...setupIxs, refinanceIx, flashRepay, ...post];
  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    ixs.flatMap((i) => i.keys.map((k: any) => k.pubkey))
  );
  return sendStep(ctx, "Flashloan refinance: Kamino → Jupiter", ixs, {
    lookupTables: [ourAlt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}


// Jupiter → Kamino (mirror direction)

/** Open a Jupiter Lend loan: init position + deposit collateral + borrow debt (disc 6). */
export async function openJupiterLoan(
  ctx: Ctx,
  positionId: number,
  depositAmount: bigint,
  borrowAmount: bigint
): Promise<void> {
  await openJupiterPosition(ctx, positionId);
  await tokenAirdrop(ctx, ctx.pair.collateralMint, depositAmount * 2n);
  await tokenAirdrop(ctx, ctx.pair.debtMint, 1_000_000n); // create debt ATA

  const operate = await jupiterOperate(ctx, positionId, depositAmount, borrowAmount);
  const keys = buildJupiterOperateAccounts(
    operate.accounts,
    operate.remainingAccounts,
    ctx.payer.publicKey
  );
  const opIx = depositAndBorrowJuplendIx(
    keys,
    depositAmount,
    borrowAmount,
    operate.remainingAccountsIndices
  );
  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const alt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    opIx.keys.map((k) => k.pubkey)
  );
  await sendStep(ctx, "Open Jupiter Lend loan (deposit + borrow)", [...setupIxs, opIx], {
    lookupTables: [alt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

export async function refinanceJupiterToKamino(
  ctx: Ctx,
  positionId: number,
  depositAmount: bigint,
  borrowAmount: bigint
): Promise<string> {
  // source close on Jupiter: repay ALL + withdraw ALL → MIN_I128 amounts.
  const operate = await jupiterOperate(ctx, positionId, MIN_I128, MIN_I128);

  const refinanceIx = buildRefinanceIx({
    direction: "jup-to-kamino",
    jupiterAccounts: buildJupiterOperateAccounts(
      operate.accounts,
      operate.remainingAccounts,
      ctx.payer.publicKey
    ),
    kaminoBlock: kaminoBlockFor(ctx),
    amounts: {
      sourceRepay: U64_MAX, // → i128::MIN: repay all Jupiter debt
      sourceWithdraw: U64_MAX, // → i128::MIN: withdraw all Jupiter collateral
      destDeposit: depositAmount, // deposit into Kamino
      destBorrow: borrowAmount, // borrow from Kamino
      kaminoFlag: 0, // fresh Kamino obligation
      indices: operate.remainingAccountsIndices,
    },
  });

  const { borrowIx: flashBorrow, repayIx: flashRepay } = await flashIxs(ctx, borrowAmount);
  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const ixs = [flashBorrow, ...setupIxs, refinanceIx, flashRepay];
  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    ixs.flatMap((i) => i.keys.map((k: any) => k.pubkey))
  );
  return sendStep(ctx, "Flashloan refinance: Jupiter → Kamino", ixs, {
    lookupTables: [ourAlt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

export { BN };

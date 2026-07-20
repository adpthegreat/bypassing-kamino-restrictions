/**
 * Surfpool test bootstrap: context factory + Kamino/Jupiter position openers.
 * Shared by the refinance surfpool tests. Requires a running Surfpool (mainnet
 * fork + surfnet_* cheatcodes) at ANCHOR_PROVIDER_URL / RPC_URL and the program
 * deployed at $PROGRAM_ID.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  RPC_URL,
  JLP_MINT,
  USDC_MINT,
  JLP_RESERVE,
  USDC_RESERVE,
  SCOPE_ORACLE_ACCOUNT,
  SCOPE_ORACLE_ACCOUNT_2,
  JUPITER_VAULT_ID,
  JUP_LEND_BORROW_PROGRAM_ID,
  FLAG_HAS_COLLATERAL,
  FLAG_HAS_BORROWS,
} from "./constants";
import {
  surfnetAirdrop,
  surfnetTokenAirdrop,
  surfnetStreamAccount,
  sendV0Tx,
  obligationAccount,
  userMetadataAccount,
  obligationFarmStatePda,
  getReserveFarms,
  getAtaAddress,
} from "./utils";
import {
  initKaminoIx,
  depositKaminoIx,
  borrowKaminoIx,
  initJupiterIx,
} from "./program-instructions";

const { getJupLendBorrow } = require("./jup_lend_loader.js");

// Live Jupiter Lend accounts to mirror into the session (JLP/USDC vault, main).
const JUPITER_STREAM_ACCOUNTS = [
  "25UZhqEoQeMA2ovbM1PgwZbU3NGUA8eM2y5g1j58YmFV",
  "2TTGSRSezqFzeLUH8JwRUbtN66XLLaymfYsWRTMjfiMw",
  "Av5dNULWTg38FSnb9iR15ei7yLrNa4CY7S3gxRqPppah",
  "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z",
  "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu",
  "BDpgMQoAWbSFEjHHtF3kbytKQnJHr8FhFhRqc67x8AJE",
  "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688",
  "Hy2FPcKStdmcJPZfc1VR1475ksDBnHQnnQuonX2RvS7t",
];

export interface Ctx {
  connection: Connection;
  payer: Keypair;
  obligation: PublicKey;
  userMetadata: PublicKey;
  jlpAta: PublicKey;
  usdcAta: PublicKey;
  jlpCollateralFarm: PublicKey;
  usdcDebtFarm: PublicKey;
  jlpObligationFarmState: PublicKey;
  usdcObligationFarmState: PublicKey;
}

export async function createCtx(): Promise<Ctx> {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = Keypair.generate();
  const obligation = obligationAccount(payer.publicKey);
  return {
    connection,
    payer,
    obligation,
    userMetadata: userMetadataAccount(payer.publicKey),
    jlpAta: getAtaAddress(JLP_MINT, payer.publicKey),
    usdcAta: getAtaAddress(USDC_MINT, payer.publicKey),
    jlpCollateralFarm: PublicKey.default,
    usdcDebtFarm: PublicKey.default,
    jlpObligationFarmState: PublicKey.default,
    usdcObligationFarmState: PublicKey.default,
  };
}

/** Stream oracles + jupiter accounts, fund payer, resolve farm PDAs. */
export async function prepare(ctx: Ctx): Promise<void> {
  const { connection, payer } = ctx;
  await surfnetStreamAccount(connection, SCOPE_ORACLE_ACCOUNT);
  await surfnetStreamAccount(connection, SCOPE_ORACLE_ACCOUNT_2);
  for (const a of JUPITER_STREAM_ACCOUNTS)
    await surfnetStreamAccount(connection, new PublicKey(a));

  await surfnetAirdrop(connection, payer.publicKey, 1000 * 1e9);

  const jlpFarms = await getReserveFarms(connection, JLP_RESERVE);
  const usdcFarms = await getReserveFarms(connection, USDC_RESERVE);
  ctx.jlpCollateralFarm = jlpFarms.collateralFarm;
  ctx.usdcDebtFarm = usdcFarms.debtFarm;
  ctx.jlpObligationFarmState = obligationFarmStatePda(
    ctx.jlpCollateralFarm,
    ctx.obligation
  );
  ctx.usdcObligationFarmState = obligationFarmStatePda(
    ctx.usdcDebtFarm,
    ctx.obligation
  );
}

export async function tokenAirdrop(ctx: Ctx, mint: PublicKey, amount: bigint) {
  await surfnetTokenAirdrop(ctx.connection, ctx.payer.publicKey, mint, amount);
}

/** init (collateral + debt farms) + deposit JLP + borrow USDC on Kamino. */
export async function openKaminoLoan(
  ctx: Ctx,
  depositJlp: bigint,
  borrowUsdc: bigint
): Promise<void> {
  const { connection, payer } = ctx;

  // farm inits (mode 0 = collateral, mode 1 = debt) — one ix each
  const initCollateral = initKaminoIx({
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: JLP_RESERVE,
    obligationFarmState: ctx.jlpObligationFarmState,
    reserveFarmState: ctx.jlpCollateralFarm,
    mode: 0,
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [initCollateral] });

  const initDebt = initKaminoIx({
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: USDC_RESERVE,
    obligationFarmState: ctx.usdcObligationFarmState,
    reserveFarmState: ctx.usdcDebtFarm,
    mode: 1,
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [initDebt] });

  // deposit JLP collateral. Fresh obligation has no reserves registered yet, so
  // refresh-obligation must see 0 reserves → flags = 0 on the first deposit.
  await tokenAirdrop(ctx, JLP_MINT, depositJlp * 2n);
  const deposit = depositKaminoIx({
    owner: payer.publicKey,
    obligation: ctx.obligation,
    jlpAta: ctx.jlpAta,
    jlpObligationFarmState: ctx.jlpObligationFarmState,
    jlpCollateralFarm: ctx.jlpCollateralFarm,
    amount: depositJlp,
    flags: 0,
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [deposit], cuLimit: 600_000 });

  // borrow USDC debt (obligation now has collateral). Seed a USDC balance first
  // so the destination ATA exists to receive the borrowed liquidity.
  await tokenAirdrop(ctx, USDC_MINT, 1_000_000n);
  const borrow = borrowKaminoIx({
    owner: payer.publicKey,
    obligation: ctx.obligation,
    usdcAta: ctx.usdcAta,
    usdcObligationFarmState: ctx.usdcObligationFarmState,
    usdcDebtFarm: ctx.usdcDebtFarm,
    amount: borrowUsdc,
    // obligation has the JLP deposit but no borrow yet → collateral only.
    flags: FLAG_HAS_COLLATERAL,
    reserveAccounts: [JLP_RESERVE],
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [borrow], cuLimit: 600_000 });
}

/** Read the vault's next position id from its state account (u32 LE @ 115). */
export async function nextJupiterPositionId(ctx: Ctx): Promise<number> {
  const borrow = await getJupLendBorrow();
  const initCtx = borrow.getInitPositionContext(
    JUPITER_VAULT_ID,
    1,
    ctx.payer.publicKey,
    "main"
  );
  const info = await ctx.connection.getAccountInfo(
    new PublicKey(initCtx.vaultState)
  );
  if (!info) throw new Error("jupiter vault state not found");
  return info.data.readUInt32LE(115);
}

/** Open a fresh Jupiter Lend position (destination for kamino→jup). */
export async function openJupiterPosition(
  ctx: Ctx,
  positionId: number
): Promise<void> {
  const borrow = await getJupLendBorrow();
  const c = borrow.getInitPositionContext(
    JUPITER_VAULT_ID,
    positionId,
    ctx.payer.publicKey,
    "main"
  );
  const ixn = initJupiterIx({
    owner: ctx.payer.publicKey,
    vaultAdmin: new PublicKey(c.vaultAdmin),
    vaultState: new PublicKey(c.vaultState),
    position: new PublicKey(c.position),
    positionMint: new PublicKey(c.positionMint),
    positionTokenAccount: new PublicKey(c.positionTokenAccount),
    metadataAccount: new PublicKey(c.metadataAccount),
    vaultId: JUPITER_VAULT_ID,
    nextPositionId: positionId,
  });
  await sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs: [ixn],
    cuLimit: 600_000,
  });
}

// ---------------------------------------------------------------------------
// Refinance: Kamino → Jupiter Lend (repay+withdraw Kamino, deposit+borrow Jup)
// ---------------------------------------------------------------------------
import {
  buildJupiterOperateAccounts,
  buildKaminoBlock,
  buildRefinanceIx,
} from "./refinance-helpers";
import { createLookupTable } from "./utils";
import { U64_MAX } from "./constants";

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
    owner: ctx.payer.publicKey,
    obligation: ctx.obligation,
    jlpObligationFarmState: ctx.jlpObligationFarmState,
    jlpCollateralFarm: ctx.jlpCollateralFarm,
    usdcObligationFarmState: ctx.usdcObligationFarmState,
    usdcDebtFarm: ctx.usdcDebtFarm,
    jlpAta: ctx.jlpAta,
    usdcAta: ctx.usdcAta,
  });
}

export async function refinanceKaminoToJupiter(
  ctx: Ctx,
  positionId: number,
  depositJlp: bigint,
  borrowUsdc: bigint,
  opts: { topLevelJupiter?: boolean } = {}
): Promise<string> {
  const borrow = await getJupLendBorrow();
  const operate = await borrow.getOperateContext({
    vaultId: JUPITER_VAULT_ID,
    positionId,
    colAmount: new BN(depositJlp.toString()), // +deposit JLP into Jupiter
    debtAmount: new BN(borrowUsdc.toString()), // +borrow USDC from Jupiter
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    market: "main",
  });

  const jupiterAccounts = buildJupiterOperateAccounts(
    operate.accounts,
    operate.remainingAccounts,
    ctx.payer.publicKey
  );
  const refinanceIx = buildRefinanceIx({
    direction: "kamino-to-jup",
    jupiterAccounts,
    kaminoBlock: kaminoBlockFor(ctx),
    amounts: {
      sourceRepay: U64_MAX, // repay ALL Kamino USDC debt
      sourceWithdraw: U64_MAX, // withdraw ALL Kamino JLP collateral
      destDeposit: depositJlp,
      destBorrow: borrowUsdc,
      kaminoFlag: FLAG_HAS_COLLATERAL | FLAG_HAS_BORROWS,
      indices: operate.remainingAccountsIndices,
    },
  });

  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);

  // CONTROL: optionally add a bare TOP-LEVEL jupr81 (Jupiter Lend BORROW program,
  // the one in RESTRICTED_PROGRAMS) instruction, so the Kamino repay's
  // no_restricted_programs_within_tx scan sees the restricted program at stack
  // height 1 and rejects with TransactionIncludesRestrictedPrograms.
  //
  // NB: it must be jupr81 *itself* at the top level — the SDK's operate/refinance
  // ix targets jup8… (a router that CPIs jupr81), which stays nested and does NOT
  // trip the guard. The scan only compares program_id, so a bare ix suffices.
  let post: any[] = [];
  if (opts.topLevelJupiter) {
    post = [
      new TransactionInstruction({
        programId: JUP_LEND_BORROW_PROGRAM_ID, // jupr81…
        keys: [{ pubkey: ctx.payer.publicKey, isWritable: false, isSigner: true }],
        data: Buffer.from([217, 106, 208, 99, 116, 151, 42, 135]), // operate disc
      }),
    ];
  }

  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    refinanceIx.keys.map((k) => k.pubkey)
  );
  return sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs: [...setupIxs, refinanceIx, ...post],
    lookupTables: [ourAlt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

/**
 * Capital-free Kamino → Jupiter refinance: a Jupiter Lend flashloan (program
 * jupg…, NOT the restricted jupr81) provides the USDC to repay Kamino, and the
 * USDC borrowed from Jupiter pays the flashloan back — all in one transaction:
 *
 *   [ flash borrow USDC ]  (top-level, jupg…)
 *   [ refinance ]          (our program → CPIs: Kamino repay + withdraw, Jupiter deposit + borrow)
 *   [ flash repay USDC ]   (top-level, jupg…)
 *
 * Returns the signature. A tiny USDC buffer must be pre-funded to cover Kamino
 * interest + any flash fee.
 */
export async function flashloanRefinanceKaminoToJupiter(
  ctx: Ctx,
  positionId: number,
  depositJlp: bigint,
  borrowUsdc: bigint
): Promise<string> {
  const borrow = await getJupLendBorrow();
  const operate = await borrow.getOperateContext({
    vaultId: JUPITER_VAULT_ID,
    positionId,
    colAmount: new BN(depositJlp.toString()),
    debtAmount: new BN(borrowUsdc.toString()),
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    market: "main",
  });

  const refinanceIx = buildRefinanceIx({
    direction: "kamino-to-jup",
    jupiterAccounts: buildJupiterOperateAccounts(
      operate.accounts,
      operate.remainingAccounts,
      ctx.payer.publicKey
    ),
    kaminoBlock: kaminoBlockFor(ctx),
    amounts: {
      sourceRepay: U64_MAX,
      sourceWithdraw: U64_MAX,
      destDeposit: depositJlp,
      destBorrow: borrowUsdc,
      kaminoFlag: FLAG_HAS_COLLATERAL | FLAG_HAS_BORROWS,
      indices: operate.remainingAccountsIndices,
    },
  });

  // Jupiter Lend flashloan borrow + payback (program jupg…, unrestricted).
  const { getJupLendFlashloan } = require("./jup_lend_loader.js");
  const fl = await getJupLendFlashloan();
  const flashArgs = {
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    amount: new BN(borrowUsdc.toString()),
    asset: USDC_MINT,
    market: "main" as const,
  };
  const flashBorrowIx = await fl.getFlashBorrowIx(flashArgs);
  const flashRepayIx = await fl.getFlashPaybackIx(flashArgs);

  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const ixs = [flashBorrowIx, ...setupIxs, refinanceIx, flashRepayIx];
  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    ixs.flatMap((i) => i.keys.map((k: any) => k.pubkey))
  );
  return sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs,
    lookupTables: [ourAlt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

// ---------------------------------------------------------------------------
// Jupiter loan opener + Jupiter → Kamino refinance (mirror direction)
// ---------------------------------------------------------------------------
import { depositAndBorrowJuplendIx } from "./program-instructions";
import { MIN_I128 } from "./constants";

/** init the Kamino obligation/farms only (no deposit yet) — dest for jup→kamino. */
export async function initKaminoObligation(ctx: Ctx): Promise<void> {
  const { connection, payer } = ctx;
  const initCollateral = initKaminoIx({
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: JLP_RESERVE,
    obligationFarmState: ctx.jlpObligationFarmState,
    reserveFarmState: ctx.jlpCollateralFarm,
    mode: 0,
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [initCollateral] });
  const initDebt = initKaminoIx({
    owner: payer.publicKey,
    userMetadata: ctx.userMetadata,
    obligation: ctx.obligation,
    reserve: USDC_RESERVE,
    obligationFarmState: ctx.usdcObligationFarmState,
    reserveFarmState: ctx.usdcDebtFarm,
    mode: 1,
  });
  await sendV0Tx({ connection, payerKeypair: payer, ixs: [initDebt] });
}

/** Open a Jupiter Lend loan: init position + deposit JLP + borrow USDC (via disc 6). */
export async function openJupiterLoan(
  ctx: Ctx,
  positionId: number,
  depositJlp: bigint,
  borrowUsdc: bigint
): Promise<void> {
  await openJupiterPosition(ctx, positionId);
  await tokenAirdrop(ctx, JLP_MINT, depositJlp * 2n);
  await tokenAirdrop(ctx, USDC_MINT, 1_000_000n); // create USDC ATA to receive borrow

  const borrow = await getJupLendBorrow();
  const operate = await borrow.getOperateContext({
    vaultId: JUPITER_VAULT_ID,
    positionId,
    colAmount: new BN(depositJlp.toString()),
    debtAmount: new BN(borrowUsdc.toString()),
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    market: "main",
  });
  const keys = buildJupiterOperateAccounts(
    operate.accounts,
    operate.remainingAccounts,
    ctx.payer.publicKey
  );
  const opIx = depositAndBorrowJuplendIx(
    keys,
    depositJlp,
    borrowUsdc,
    operate.remainingAccountsIndices
  );
  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const alt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    opIx.keys.map((k) => k.pubkey)
  );
  await sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs: [...setupIxs, opIx],
    lookupTables: [alt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

export async function refinanceJupiterToKamino(
  ctx: Ctx,
  positionId: number,
  depositJlp: bigint,
  borrowUsdc: bigint
): Promise<string> {
  const borrow = await getJupLendBorrow();
  // source close: repay ALL + withdraw ALL on Jupiter → MIN_I128 amounts.
  const operate = await borrow.getOperateContext({
    vaultId: JUPITER_VAULT_ID,
    positionId,
    colAmount: new BN(MIN_I128.toString()), // withdraw all collateral
    debtAmount: new BN(MIN_I128.toString()), // repay all debt
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    market: "main",
  });

  const jupiterAccounts = buildJupiterOperateAccounts(
    operate.accounts,
    operate.remainingAccounts,
    ctx.payer.publicKey
  );
  const refinanceIx = buildRefinanceIx({
    direction: "jup-to-kamino",
    jupiterAccounts,
    kaminoBlock: kaminoBlockFor(ctx),
    amounts: {
      sourceRepay: U64_MAX, // → i128::MIN: repay all Jupiter debt
      sourceWithdraw: U64_MAX, // → i128::MIN: withdraw all Jupiter collateral
      destDeposit: depositJlp, // deposit into Kamino
      destBorrow: borrowUsdc, // borrow from Kamino
      kaminoFlag: 0, // fresh Kamino obligation (no reserves yet)
      indices: operate.remainingAccountsIndices,
    },
  });

  const setupIxs = await liveSetupIxs(ctx, operate.otherIxs || []);
  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    refinanceIx.keys.map((k) => k.pubkey)
  );
  return sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs: [...setupIxs, refinanceIx],
    lookupTables: [ourAlt, ...(operate.addressLookupTableAccounts || [])],
    cuLimit: 1_400_000,
  });
}

export { BN };


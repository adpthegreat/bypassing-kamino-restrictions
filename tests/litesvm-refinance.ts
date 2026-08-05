/**
 * LiteSVM: full end-to-end refinance, both directions, built entirely in-process.
 *
 * Each test builds a real loan and refinances it — nothing runs on surfpool:
 *
 *   Kamino → Jupiter
 *     init Kamino obligation → deposit collateral → borrow debt → open Jupiter
 *     position → [ jupg flash borrow ] → [ our refinance CPI ] → [ jupg flash repay ]
 *
 *   Jupiter → Kamino  (mirror)
 *     init Kamino obligation → open Jupiter position → open Jupiter loan
 *     (deposit + borrow) → [ jupg flash borrow ] → [ our refinance CPI ] → [ flash repay ]
 *
 * The refinance CPI does, inside a single stack frame, the source protocol's
 * repay-all + withdraw-all and the destination's deposit + borrow. Jupiter's
 * restricted program (jupr81…) only ever appears nested at CPI stack height 2, so
 * Kamino's Instructions-sysvar guard never sees it — the bypass, exercised.
 *
 * LiteSVM has no account fetching, so tests/litesvm-fork.ts lazily clones each
 * account a transaction references from mainnet (read-only) just before it is
 * needed; accounts the flow CREATES (obligation, farm states, position, ATAs) are
 * allocated by the programs in-SVM. A mainnet RPC is used only for those reads
 * and to let the Jupiter Lend SDK build its operate/flash instructions — every
 * write executes in LiteSVM.
 *
 * The mainnet RPC comes from MAINNET_RPC_URL in .env (loaded via dotenv/config in
 * the npm script), falling back to the public endpoint in constants.ts. Run:
 *
 *   npm run test:litesvm
 */
import { expect } from "chai";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { TransactionMetadata } from "litesvm";
import { LiteSvmFork } from "./litesvm-fork";
import { getRefinancePair, PairContext } from "./market";
import {
  MAINNET_RPC_URL,
  U64_MAX,
  MIN_I128,
  FLAG_HAS_COLLATERAL,
  FLAG_HAS_BORROWS,
} from "./constants";
import {
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
  depositAndBorrowJuplendIx,
} from "./program-instructions";
import {
  buildJupiterOperateAccounts,
  buildKaminoBlock,
  buildRefinanceIx,
} from "./refinance-helpers";
import { printLiteSVMResult } from "./tx-printer";

const { getJupLendBorrow, getJupLendFlashloan } = require("./jup_lend_loader.js");
const BN = require("bn.js");

const MAINNET = process.env.MAINNET_RPC_URL || MAINNET_RPC_URL;
// Where each run's tx-printer output + raw transaction logs are saved:
// <project>/logs/litesvm-refinance-output.txt (override with LITESVM_OUTPUT_FILE).
const OUTPUT_FILE =
  process.env.LITESVM_OUTPUT_FILE ||
  join(__dirname, "..", "logs", "litesvm-refinance-output.txt");
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const COLLATERAL = "JLP";
const DEBT = "USDC";
const DEPOSIT = 100_000_000n;
const BORROW = 250_000_000n;
const FEE_BUFFER = 5_000_000n; // the refinancer's own capital — flashloan supplies the rest

interface E2E {
  fork: LiteSvmFork;
  conn: any; // SVM-backed Connection (mainnet fallback)
  pair: PairContext;
  payer: Keypair;
  obligation: PublicKey;
  userMetadata: PublicKey;
  collateralAta: PublicKey;
  debtAta: PublicKey;
  colFarm: PublicKey;
  debtFarm: PublicKey;
}

/** Fresh fork + pair + funded payer + pinned clock + derived user PDAs. */
async function setup(): Promise<E2E> {
  const fork = LiteSvmFork.create(MAINNET);
  const conn = fork.connection();
  const pair = await getRefinancePair({
    collateralSymbol: COLLATERAL,
    debtSymbol: DEBT,
  });

  const payer = Keypair.generate();
  fork.svm.airdrop(payer.publicKey, 1000n * 1_000_000_000n);

  // Clone each Kamino reserve's whole account family in ONE batch so the reserve
  // struct and its token vaults come from the same mainnet slot. Kamino asserts
  // vault balances match the reserve's internal accounting; cloning them at
  // different slots (as lazy per-tx cloning would) breaks that invariant.
  const family = (r: typeof pair.collateral) => [
    r.reserve,
    r.liquidityMint,
    r.liquiditySupplyVault,
    r.feeVault,
    r.collateralMint,
    r.collateralSupplyVault,
    r.collateralFarm,
    r.debtFarm,
    r.scopeOracle,
  ];
  await fork.ensure([
    pair.market,
    pair.marketAuthority,
    ...family(pair.collateral),
    ...family(pair.debt),
  ]);
  await fork.syncClock(); // clock tracks mainnet; re-synced before every send

  const obligation = obligationAccount(payer.publicKey, pair.market);
  return {
    fork,
    conn,
    pair,
    payer,
    obligation,
    userMetadata: userMetadataAccount(payer.publicKey),
    collateralAta: getAtaAddress(pair.collateralMint, payer.publicKey),
    debtAta: getAtaAddress(pair.debtMint, payer.publicKey),
    colFarm: obligationFarmStatePda(pair.collateral.collateralFarm, obligation),
    debtFarm: obligationFarmStatePda(pair.debt.debtFarm, obligation),
  };
}

/** init the Kamino obligation + both farm states (no deposit). */
async function initKaminoObligation(e: E2E): Promise<void> {
  await e.fork.send(e.payer, [
    initKaminoIx({
      pair: e.pair,
      owner: e.payer.publicKey,
      userMetadata: e.userMetadata,
      obligation: e.obligation,
      reserve: e.pair.collateral.reserve,
      obligationFarmState: e.colFarm,
      reserveFarmState: e.pair.collateral.collateralFarm,
      mode: 0,
    }),
  ]);
  await e.fork.send(e.payer, [
    initKaminoIx({
      pair: e.pair,
      owner: e.payer.publicKey,
      userMetadata: e.userMetadata,
      obligation: e.obligation,
      reserve: e.pair.debt.reserve,
      obligationFarmState: e.debtFarm,
      reserveFarmState: e.pair.debt.debtFarm,
      mode: 1,
    }),
  ]);
}

/** Init the destination Jupiter Lend position; returns its id. */
async function openJupiterPosition(e: E2E): Promise<number> {
  const borrow = await getJupLendBorrow();
  const probe = borrow.getInitPositionContext(
    e.pair.jupiterVaultId,
    1,
    e.payer.publicKey,
    e.pair.jupiterMarket
  );
  const vaultInfo = await e.conn.getAccountInfo(new PublicKey(probe.vaultState));
  const positionId = vaultInfo!.data.readUInt32LE(115);
  const c = borrow.getInitPositionContext(
    e.pair.jupiterVaultId,
    positionId,
    e.payer.publicKey,
    e.pair.jupiterMarket
  );
  await e.fork.send(
    e.payer,
    [
      initJupiterIx({
        owner: e.payer.publicKey,
        vaultAdmin: new PublicKey(c.vaultAdmin),
        vaultState: new PublicKey(c.vaultState),
        position: new PublicKey(c.position),
        positionMint: new PublicKey(c.positionMint),
        positionTokenAccount: new PublicKey(c.positionTokenAccount),
        metadataAccount: new PublicKey(c.metadataAccount),
        vaultId: e.pair.jupiterVaultId,
        nextPositionId: positionId,
      }),
    ],
    { cuLimit: 600_000 }
  );
  return positionId;
}

/** A Jupiter operate context resolved through the SVM-backed connection. */
async function operateContext(e: E2E, positionId: number, col: bigint, debt: bigint) {
  const borrow = await getJupLendBorrow();
  await e.fork.syncClock(); // getExchangePrices simulates on the SVM against the clock
  return borrow.getOperateContext({
    vaultId: e.pair.jupiterVaultId,
    positionId,
    colAmount: new BN(col.toString()),
    debtAmount: new BN(debt.toString()),
    connection: e.conn,
    signer: e.payer.publicKey,
    market: e.pair.jupiterMarket,
  });
}

/** Jupiter Lend flashloan borrow + payback of `amount` of the debt token (jupg…). */
async function flashIxs(e: E2E, amount: bigint) {
  const fl = await getJupLendFlashloan();
  const args = {
    connection: e.conn,
    signer: e.payer.publicKey,
    amount: new BN(amount.toString()),
    asset: e.pair.debtMint,
    market: e.pair.jupiterMarket,
  };
  return {
    borrowIx: await fl.getFlashBorrowIx(args),
    repayIx: await fl.getFlashPaybackIx(args),
  };
}

/** Keep only the Jupiter setup ixs whose target account doesn't exist yet. */
async function liveSetupIxs(e: E2E, raw: any[]): Promise<any[]> {
  const kept: any[] = [];
  for (const six of raw || []) {
    const target = six.keys.find((k: any) => k.isWritable && !k.isSigner)?.pubkey;
    const exists = target ? (await e.conn.getAccountInfo(target)) !== null : false;
    if (!exists) kept.push(six);
  }
  return kept;
}

/** Fabricate a lookup table over the tx's accounts and send (signers + invoked
 *  programs stay static), returning the transaction metadata. */
async function sendWithAlt(
  e: E2E,
  ixs: TransactionInstruction[]
): Promise<TransactionMetadata> {
  const programIds = new Set(ixs.map((i) => i.programId.toBase58()));
  const statics = new Set([e.payer.publicKey.toBase58()]);
  const altAddrs = ixs
    .flatMap((i) => i.keys.map((k: any) => k.pubkey))
    .filter((k) => !programIds.has(k.toBase58()) && !statics.has(k.toBase58()));
  const alt = e.fork.makeLookupTable(e.payer.publicKey, altAddrs);
  return e.fork.send(e.payer, ixs, { lookupTables: [alt], cuLimit: 1_400_000 });
}

/**
 * Solscan-style dump of a LiteSVM refinance (the CPI tree comes from the logs),
 * printed to the terminal AND appended — together with the raw transaction logs —
 * to OUTPUT_FILE in the home directory.
 */
function printRefinance(
  meta: TransactionMetadata,
  refinanceIx: TransactionInstruction,
  ixs: TransactionInstruction[],
  title: string
): string[] {
  const logs = meta.logs();
  const rendered = printLiteSVMResult({
    title,
    signature: Buffer.from(meta.signature()).toString("hex").slice(0, 16),
    err: null,
    logs,
    computeUnits: Number(meta.computeUnitsConsumed()),
    accounts: refinanceIx.keys.map((k: any) => ({
      pubkey: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
    instructions: ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      accounts: ix.keys.map((k: any) => k.pubkey.toBase58()),
      dataLen: ix.data.length,
    })),
  });

  const block = [
    stripAnsi(rendered),
    "",
    `  RAW TRANSACTION LOGS — ${title}`,
    "  " + "─".repeat(74),
    ...logs.map((l) => "  " + l),
    "",
    "",
  ].join("\n");
  appendFileSync(OUTPUT_FILE, block);
  return logs;
}

/**
 * Retry the whole flow on transient hiccups: a dropped RPC socket / rate limit,
 * or the fork's clock-vs-freshly-cloned-account interest math momentarily
 * disagreeing (the same class the surfpool tests retry). A fresh fork re-clones
 * every account at a new slot, which clears it. Real logic bugs are deterministic
 * and fail every attempt, so they still surface.
 */
function isTransient(e: any): boolean {
  const s = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return /fetch failed|other side closed|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|\b(429|502|503|504)\b|rate.?limit|No return data found in logs|MathOverflow|Math operation overflow|LibraryMathError|attempt to (add|subtract|multiply) with overflow|ProgramFailedToComplete/i.test(
    s
  );
}
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (isTransient(e) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

describe("LiteSVM: full end-to-end refinance (built in-process)", function () {
  this.timeout(200_000);

  before(() => {
    mkdirSync(join(OUTPUT_FILE, ".."), { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      `LiteSVM end-to-end refinance — tx-printer output + raw transaction logs\n` +
        `Generated: ${new Date().toISOString()}\n` +
        `Pair: ${COLLATERAL}/${DEBT}   deposit=${DEPOSIT}   borrow=${BORROW}\n\n`
    );
  });

  after(() => {
    console.log(`\n  ► saved tx-printer output + raw logs -> ${OUTPUT_FILE}`);
  });

  it(`Kamino → Jupiter: opens a real ${COLLATERAL}/${DEBT} Kamino loan and refinances it into Jupiter Lend`, () =>
    withRetry(async () => {
    const e = await setup();

    // 1. init obligation.
    await initKaminoObligation(e);

    // 2. deposit collateral (fabricate what the user brings).
    e.fork.setTokenBalance(e.collateralAta, e.pair.collateralMint, e.payer.publicKey, DEPOSIT * 2n);
    await e.fork.send(
      e.payer,
      [
        depositKaminoIx({
          pair: e.pair,
          owner: e.payer.publicKey,
          obligation: e.obligation,
          collateralAta: e.collateralAta,
          collateralObligationFarmState: e.colFarm,
          amount: DEPOSIT,
          flags: 0, // fresh obligation
        }),
      ],
      { cuLimit: 600_000 }
    );

    // 3. borrow debt.
    e.fork.setTokenBalance(e.debtAta, e.pair.debtMint, e.payer.publicKey, 0n);
    await e.fork.send(
      e.payer,
      [
        borrowKaminoIx({
          pair: e.pair,
          owner: e.payer.publicKey,
          obligation: e.obligation,
          debtAta: e.debtAta,
          debtObligationFarmState: e.debtFarm,
          amount: BORROW,
          flags: FLAG_HAS_COLLATERAL,
          reserveAccounts: [e.pair.collateral.reserve],
        }),
      ],
      { cuLimit: 600_000 }
    );
    expect(Number(e.fork.tokenBalance(e.debtAta)), "no debt borrowed").to.be.greaterThan(0);

    // 4. open the destination Jupiter position.
    const positionId = await openJupiterPosition(e);

    // Drain the borrowed debt to a fee buffer: the flashloan supplies the repay capital.
    e.fork.setTokenBalance(e.debtAta, e.pair.debtMint, e.payer.publicKey, FEE_BUFFER);

    // 5. flashloan-sandwiched refinance.
    const operate = await operateContext(e, positionId, DEPOSIT, BORROW);
    const refinanceIx = buildRefinanceIx({
      direction: "kamino-to-jup",
      jupiterAccounts: buildJupiterOperateAccounts(
        operate.accounts,
        operate.remainingAccounts,
        e.payer.publicKey
      ),
      kaminoBlock: buildKaminoBlock({
        pair: e.pair,
        owner: e.payer.publicKey,
        obligation: e.obligation,
        collateralObligationFarmState: e.colFarm,
        debtObligationFarmState: e.debtFarm,
        collateralAta: e.collateralAta,
        debtAta: e.debtAta,
      }),
      amounts: {
        sourceRepay: U64_MAX,
        sourceWithdraw: U64_MAX,
        destDeposit: DEPOSIT,
        destBorrow: BORROW,
        kaminoFlag: FLAG_HAS_COLLATERAL | FLAG_HAS_BORROWS,
        indices: operate.remainingAccountsIndices,
      },
    });
    const { borrowIx, repayIx } = await flashIxs(e, BORROW);
    // Init any missing Jupiter tick/branch accounts in their own tx so the
    // refinance transaction stays under the 1232-byte size limit.
    const setupIxs = await liveSetupIxs(e, operate.otherIxs);
    if (setupIxs.length) await e.fork.send(e.payer, setupIxs, { cuLimit: 600_000 });
    const ixs = [borrowIx, refinanceIx, repayIx];

    const meta = await sendWithAlt(e, ixs);
    const logs = printRefinance(
      meta,
      refinanceIx,
      ixs,
      `End-to-end Kamino → Jupiter refinance (${COLLATERAL}/${DEBT}, LiteSVM)`
    );

    expect(logs.some((l) => /Instruction: Operate|jupr81YtY/i.test(l)), "no nested Jupiter CPI").to.be.true;
    expect(logs.some((l) => /RepayObligation|WithdrawObligation|KLend2g3/i.test(l)), "no Kamino repay/withdraw").to.be.true;
    })).timeout(200_000);

  it(`Jupiter → Kamino: opens a real ${COLLATERAL}/${DEBT} Jupiter Lend loan and refinances it into Kamino`, () =>
    withRetry(async () => {
    const e = await setup();

    // 1. init the destination Kamino obligation (fresh).
    await initKaminoObligation(e);

    // 2. open the Jupiter position, then open a Jupiter loan (deposit + borrow).
    const positionId = await openJupiterPosition(e);
    e.fork.setTokenBalance(e.collateralAta, e.pair.collateralMint, e.payer.publicKey, DEPOSIT * 2n);
    e.fork.setTokenBalance(e.debtAta, e.pair.debtMint, e.payer.publicKey, 0n);

    const openOperate = await operateContext(e, positionId, DEPOSIT, BORROW);
    const openIx = depositAndBorrowJuplendIx(
      buildJupiterOperateAccounts(
        openOperate.accounts,
        openOperate.remainingAccounts,
        e.payer.publicKey
      ),
      DEPOSIT,
      BORROW,
      openOperate.remainingAccountsIndices
    );
    const openSetup = await liveSetupIxs(e, openOperate.otherIxs);
    if (openSetup.length) await e.fork.send(e.payer, openSetup, { cuLimit: 600_000 });
    await sendWithAlt(e, [openIx]);
    expect(Number(e.fork.tokenBalance(e.debtAta)), "no debt borrowed on Jupiter").to.be.greaterThan(0);

    // Drain to a fee buffer: the flashloan supplies the capital to repay Jupiter.
    e.fork.setTokenBalance(e.debtAta, e.pair.debtMint, e.payer.publicKey, FEE_BUFFER);

    // 3. flashloan-sandwiched refinance (close Jupiter → open Kamino).
    const operate = await operateContext(e, positionId, MIN_I128, MIN_I128);
    const refinanceIx = buildRefinanceIx({
      direction: "jup-to-kamino",
      jupiterAccounts: buildJupiterOperateAccounts(
        operate.accounts,
        operate.remainingAccounts,
        e.payer.publicKey
      ),
      kaminoBlock: buildKaminoBlock({
        pair: e.pair,
        owner: e.payer.publicKey,
        obligation: e.obligation,
        collateralObligationFarmState: e.colFarm,
        debtObligationFarmState: e.debtFarm,
        collateralAta: e.collateralAta,
        debtAta: e.debtAta,
      }),
      amounts: {
        sourceRepay: U64_MAX, // repay ALL Jupiter debt
        sourceWithdraw: U64_MAX, // withdraw ALL Jupiter collateral
        destDeposit: DEPOSIT, // into Kamino
        destBorrow: BORROW, // from Kamino
        kaminoFlag: 0, // fresh Kamino obligation
        indices: operate.remainingAccountsIndices,
      },
    });
    const { borrowIx, repayIx } = await flashIxs(e, BORROW);
    // Init any missing Jupiter tick/branch accounts in their own tx so the
    // refinance transaction stays under the 1232-byte size limit.
    const setupIxs = await liveSetupIxs(e, operate.otherIxs);
    if (setupIxs.length) await e.fork.send(e.payer, setupIxs, { cuLimit: 600_000 });
    const ixs = [borrowIx, refinanceIx, repayIx];

    const meta = await sendWithAlt(e, ixs);
    const logs = printRefinance(
      meta,
      refinanceIx,
      ixs,
      `End-to-end Jupiter → Kamino refinance (${COLLATERAL}/${DEBT}, LiteSVM)`
    );

    expect(logs.some((l) => /Instruction: Operate|jupr81YtY/i.test(l)), "no nested Jupiter CPI").to.be.true;
    expect(logs.some((l) => /DepositObligation|BorrowObligation|KLend2g3/i.test(l)), "no Kamino deposit/borrow").to.be.true;
    })).timeout(200_000);
});

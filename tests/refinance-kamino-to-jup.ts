/**
 * Surfpool integration test: Kamino → Jupiter Lend refinance.
 *
 * Opens a real loan on Kamino (mainnet fork), opens a destination Jupiter Lend
 * position, then migrates the whole position in a single call to our program.
 * The migration touches Kamino's restricted RepayObligationLiquidityV2 — but only
 * inside our program's CPI (stack height 2), so Kamino's Instructions-sysvar guard
 * never sees the Jupiter Lend program and the transaction is allowed.
 *
 * The pair is resolved just-in-time from the two symbols below — swap them (and
 * the amounts) to test any collateral/debt pair that exists on both venues.
 *
 * Requires: surfpool (mainnet fork + cheatcodes); it auto-deploys the program.
 */
import { expect } from "chai";
import { Connection } from "@solana/web3.js";
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
  refinanceKaminoToJupiter,
  printStepLinks,
  Ctx,
} from "./bootstrap";
import { getRefinancePair } from "./market";
import { RPC_URL } from "./constants";
import { printFetchedTransaction } from "./tx-printer";

const COLLATERAL = "JLP";
const DEBT = "USDC";
const DEPOSIT = 100_000_000n; // raw collateral amount
const BORROW = 300_000_000n; // raw debt amount

describe(`refinance: Kamino → Jupiter Lend (${COLLATERAL}/${DEBT})`, function () {
  this.timeout(200_000);
  let ctx: Ctx;

  before(async () => {
    const connection = new Connection(RPC_URL, "confirmed");
    const pair = await getRefinancePair({
      collateralSymbol: COLLATERAL,
      debtSymbol: DEBT,
    });
    ctx = await createCtx(connection, pair);
    await prepare(ctx);
  });

  after(() => {
    if (ctx) printStepLinks(ctx, `${COLLATERAL} → ${DEBT} · Kamino → Jupiter refinance — steps`);
  });

  it("opens a Kamino loan", async () => {
    await openKaminoLoan(ctx, DEPOSIT, BORROW);
    const debt = await ctx.connection.getTokenAccountBalance(ctx.debtAta);
    expect(Number(debt.value.amount)).to.be.greaterThan(0);
  });

  it("migrates the position to Jupiter Lend (bypassing the Kamino restriction)", async () => {
    const positionId = await nextJupiterPositionId(ctx);
    await openJupiterPosition(ctx, positionId);

    // Drain the borrowed debt down to a tiny fee buffer: the refinancer does NOT
    // hold the capital to repay Kamino. The flashloan inside refinanceKaminoToJupiter
    // (flash borrow → refinance → flash repay) is what supplies it.
    await tokenAirdrop(ctx, ctx.pair.debtMint, 5_000_000n);

    const sig = await refinanceKaminoToJupiter(ctx, positionId, DEPOSIT, BORROW);
    expect(sig).to.be.a("string");

    await new Promise((r) => setTimeout(r, 1200));
    await printFetchedTransaction(
      ctx.connection,
      sig,
      `Kamino → Jupiter refinance (${COLLATERAL}/${DEBT}, surfpool)`
    );

    const tx = await ctx.connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    expect(tx, "transaction not found").to.not.be.null;
    expect(tx!.meta!.err, "refinance reverted").to.be.null;
  });
});

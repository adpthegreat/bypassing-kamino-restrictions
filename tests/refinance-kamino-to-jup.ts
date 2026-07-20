/**
 * Surfpool integration test: Kamino → Jupiter Lend refinance.
 *
 * Opens a real JLP/USDC loan on Kamino (mainnet fork), opens a destination
 * Jupiter Lend position, then migrates the whole position in a single call to
 * our program. The migration touches Kamino's restricted RepayObligationLiquidityV2
 * — but only inside our program's CPI (stack height 2), so Kamino's Instructions-
 * sysvar guard (which reads only top-level instructions) never sees the Jupiter
 * Lend program and the transaction is allowed. Success == the restriction bypassed.
 *
 * Requires: surfpool (mainnet fork + surfnet cheatcodes) at $ANCHOR_PROVIDER_URL
 * and the program deployed at $PROGRAM_ID. See README1.md / package.json.
 */
import { expect } from "chai";
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
  refinanceKaminoToJupiter,
  Ctx,
} from "./bootstrap";
import { JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT, USDC_MINT } from "./constants";
import { printFetchedTransaction } from "./tx-printer";

describe("refinance: Kamino → Jupiter Lend", function () {
  this.timeout(200_000);
  let ctx: Ctx;

  before(async () => {
    ctx = await createCtx();
    await prepare(ctx);
  });

  it("opens a Kamino JLP/USDC loan", async () => {
    await openKaminoLoan(ctx, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);
    const usdc = await ctx.connection.getTokenAccountBalance(ctx.usdcAta);
    expect(Number(usdc.value.amount)).to.be.greaterThan(0);
  });

  it("migrates the position to Jupiter Lend (bypassing the Kamino restriction)", async () => {
    const positionId = await nextJupiterPositionId(ctx);
    await openJupiterPosition(ctx, positionId);

    // Pre-fund USDC so the CPI can repay all Kamino debt (flashloan-free path;
    // the capital-free flashloan variant is in flashloan-bypass-demo.ts).
    await tokenAirdrop(ctx, USDC_MINT, 10_000_000_000n);

    const sig = await refinanceKaminoToJupiter(
      ctx,
      positionId,
      JLP_DEPOSIT_AMOUNT,
      USDC_BORROW_AMOUNT
    );
    expect(sig).to.be.a("string");

    await new Promise((r) => setTimeout(r, 1200));
    await printFetchedTransaction(
      ctx.connection,
      sig,
      "Kamino → Jupiter refinance (surfpool)"
    );

    // Confirm on-chain success.
    const tx = await ctx.connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    expect(tx, "transaction not found").to.not.be.null;
    expect(tx!.meta!.err, "refinance reverted").to.be.null;
  });
});

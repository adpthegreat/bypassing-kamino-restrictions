/**
 * Surfpool integration test: Jupiter Lend → Kamino refinance (mirror direction).
 *
 * Opens a JLP/USDC loan on Jupiter Lend, then migrates the whole position to
 * Kamino in a single call to our program. The Jupiter repay+withdraw and the
 * Kamino deposit+borrow all execute inside our program's CPI (stack height 2),
 * so no restricted program appears at the top level.
 *
 * Requires surfpool (mainnet fork + cheatcodes) at $ANCHOR_PROVIDER_URL and the
 * program deployed at $PROGRAM_ID.
 */
import { expect } from "chai";
import {
  createCtx,
  prepare,
  initKaminoObligation,
  nextJupiterPositionId,
  openJupiterLoan,
  tokenAirdrop,
  refinanceJupiterToKamino,
  Ctx,
} from "./bootstrap";
import { JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT, USDC_MINT } from "./constants";
import { printFetchedTransaction } from "./tx-printer";

describe("refinance: Jupiter Lend → Kamino", function () {
  this.timeout(200_000);
  let ctx: Ctx;
  let positionId: number;

  before(async () => {
    ctx = await createCtx();
    await prepare(ctx);
    await initKaminoObligation(ctx);
  });

  it("opens a Jupiter Lend JLP/USDC loan", async () => {
    positionId = await nextJupiterPositionId(ctx);
    await openJupiterLoan(ctx, positionId, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);
    expect(positionId).to.be.a("number");
  });

  it("migrates the position to Kamino via our program's CPI", async () => {
    await tokenAirdrop(ctx, USDC_MINT, 10_000_000_000n);
    const sig = await refinanceJupiterToKamino(
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
      "Jupiter → Kamino refinance (surfpool)"
    );

    const tx = await ctx.connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    expect(tx, "transaction not found").to.not.be.null;
    expect(tx!.meta!.err, "refinance reverted").to.be.null;
  });
});

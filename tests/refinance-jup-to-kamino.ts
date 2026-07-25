/**
 * Surfpool integration test: Jupiter Lend → Kamino refinance (mirror direction).
 *
 * Opens a loan on Jupiter Lend, then migrates the whole position to Kamino in a
 * single call to our program. The Jupiter repay+withdraw and the Kamino
 * deposit+borrow all execute inside our program's CPI (stack height 2), so no
 * restricted program appears at the top level.
 *
 * The pair is resolved just-in-time from the two symbols below.
 * Requires surfpool (mainnet fork + cheatcodes); it auto-deploys the program.
 */
import { expect } from "chai";
import { Connection } from "@solana/web3.js";
import {
  createCtx,
  prepare,
  initKaminoObligation,
  nextJupiterPositionId,
  openJupiterLoan,
  tokenAirdrop,
  refinanceJupiterToKamino,
  printStepLinks,
  Ctx,
} from "./bootstrap";
import { getRefinancePair } from "./market";
import { RPC_URL } from "./constants";
import { printFetchedTransaction } from "./tx-printer";

const COLLATERAL = "JLP";
const DEBT = "USDC";
const DEPOSIT = 100_000_000n;
const BORROW = 300_000_000n;

describe(`refinance: Jupiter Lend → Kamino (${COLLATERAL}/${DEBT})`, function () {
  this.timeout(200_000);
  let ctx: Ctx;
  let positionId: number;

  before(async () => {
    const connection = new Connection(RPC_URL, "confirmed");
    const pair = await getRefinancePair({
      collateralSymbol: COLLATERAL,
      debtSymbol: DEBT,
    });
    ctx = await createCtx(connection, pair);
    await prepare(ctx);
    await initKaminoObligation(ctx);
  });

  after(() => {
    if (ctx) printStepLinks(ctx, `${COLLATERAL} → ${DEBT} · Jupiter → Kamino refinance — steps`);
  });

  it("opens a Jupiter Lend loan", async () => {
    positionId = await nextJupiterPositionId(ctx);
    await openJupiterLoan(ctx, positionId, DEPOSIT, BORROW);
    expect(positionId).to.be.a("number");
  });

  it("migrates the position to Kamino via our program's CPI", async () => {
    // Drain the borrowed debt to a tiny fee buffer — the flashloan inside
    // refinanceJupiterToKamino supplies the capital to repay Jupiter.
    await tokenAirdrop(ctx, ctx.pair.debtMint, 5_000_000n);
    const sig = await refinanceJupiterToKamino(ctx, positionId, DEPOSIT, BORROW);
    expect(sig).to.be.a("string");

    await new Promise((r) => setTimeout(r, 1200));
    await printFetchedTransaction(
      ctx.connection,
      sig,
      `Jupiter → Kamino refinance (${COLLATERAL}/${DEBT}, surfpool)`
    );

    const tx = await ctx.connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    expect(tx, "transaction not found").to.not.be.null;
    expect(tx!.meta!.err, "refinance reverted").to.be.null;
  });
});

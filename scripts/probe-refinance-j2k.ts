/** Probe: Jupiter Lend → Kamino refinance through our program on surfpool. */
import {
  createCtx,
  prepare,
  initKaminoObligation,
  nextJupiterPositionId,
  openJupiterLoan,
  tokenAirdrop,
  refinanceJupiterToKamino,
} from "../tests/bootstrap";
import { JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT, USDC_MINT } from "../tests/constants";
import { printFetchedTransaction } from "../tests/tx-printer";

async function main() {
  const ctx = await createCtx();
  console.log("payer:", ctx.payer.publicKey.toBase58());

  console.log("\n[1] prepare + init empty Kamino obligation (destination)…");
  await prepare(ctx);
  await initKaminoObligation(ctx);
  console.log("  ✓ Kamino obligation initialized");

  console.log("\n[2] open Jupiter Lend loan (source)…");
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterLoan(ctx, positionId, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);
  console.log("  ✓ Jupiter loan open, position", positionId);

  console.log("\n[3] refinance Jupiter → Kamino…");
  await tokenAirdrop(ctx, USDC_MINT, 10_000_000_000n); // to repay Jupiter debt
  const sig = await refinanceJupiterToKamino(
    ctx,
    positionId,
    JLP_DEPOSIT_AMOUNT,
    USDC_BORROW_AMOUNT
  );
  console.log("  ✓ refinance sig:", sig);
  await new Promise((r) => setTimeout(r, 1500));
  await printFetchedTransaction(ctx.connection, sig, "Jupiter → Kamino refinance (surfpool)");
}

main().catch((e) => {
  console.error("\n✗ j2k probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.slice(-16).join("\n"));
  process.exit(1);
});

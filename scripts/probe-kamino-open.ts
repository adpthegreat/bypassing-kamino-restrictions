/**
 * Probe: open a Kamino JLP/USDC position on surfpool, step by step, printing the
 * final borrow transaction. Validates the account wiring for INIT/DEPOSIT/BORROW
 * against live mainnet-forked Kamino state.
 */
import { createCtx, prepare, openKaminoLoan } from "../tests/bootstrap";
import { JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT } from "../tests/constants";
import { printFetchedTransaction } from "../tests/tx-printer";

async function main() {
  const ctx = await createCtx();
  console.log("payer:", ctx.payer.publicKey.toBase58());
  console.log("obligation:", ctx.obligation.toBase58());

  console.log("\n[1/2] prepare (stream oracles + jup accounts, fund, resolve farms)…");
  await prepare(ctx);
  console.log("  jlpCollateralFarm:", ctx.jlpCollateralFarm.toBase58());
  console.log("  usdcDebtFarm:", ctx.usdcDebtFarm.toBase58());

  console.log("\n[2/2] openKaminoLoan (init x2 + deposit JLP + borrow USDC)…");
  await openKaminoLoan(ctx, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);
  console.log("  ✓ Kamino position opened");

  const usdcBal = await ctx.connection.getTokenAccountBalance(ctx.usdcAta);
  console.log("  borrowed USDC balance:", usdcBal.value.uiAmountString);
}

main().catch((e) => {
  console.error("\n✗ probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});

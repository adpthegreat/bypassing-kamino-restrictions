/**
 * Probe: open a Kamino position on surfpool, step by step. Validates the account
 * wiring for INIT/DEPOSIT/BORROW against live mainnet-forked Kamino state.
 */
import { Connection } from "@solana/web3.js";
import { createCtx, prepare, openKaminoLoan } from "../tests/bootstrap";
import { getRefinancePair } from "../tests/market";
import { RPC_URL } from "../tests/constants";

const DEPOSIT = 100_000_000n;
const BORROW = 250_000_000n;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const pair = await getRefinancePair({
    collateralSymbol: "JLP",
    debtSymbol: "USDC",
  });
  const ctx = await createCtx(connection, pair);
  console.log("payer:", ctx.payer.publicKey.toBase58());
  console.log("obligation:", ctx.obligation.toBase58());

  console.log("\n[1/2] prepare (stream pair oracles, fund)…");
  await prepare(ctx);
  console.log("  collateral farm:", pair.collateral.collateralFarm.toBase58());
  console.log("  debt farm:", pair.debt.debtFarm.toBase58());

  console.log("\n[2/2] openKaminoLoan (init x2 + deposit + borrow)…");
  await openKaminoLoan(ctx, DEPOSIT, BORROW);
  console.log("  ✓ Kamino position opened");

  const debtBal = await ctx.connection.getTokenAccountBalance(ctx.debtAta);
  console.log("  borrowed debt balance:", debtBal.value.uiAmountString);
}

main().catch((e) => {
  console.error("\n✗ probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});

/** Probe: Kamino → Jupiter refinance through our program on surfpool. */
import { Connection } from "@solana/web3.js";
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
  refinanceKaminoToJupiter,
} from "../tests/bootstrap";
import { getRefinancePair } from "../tests/market";
import { RPC_URL } from "../tests/constants";
import { printFetchedTransaction } from "../tests/tx-printer";

const DEPOSIT = 100_000_000n;
const BORROW = 300_000_000n;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const pair = await getRefinancePair({ collateralSymbol: "JLP", debtSymbol: "USDC" });
  const ctx = await createCtx(connection, pair);
  console.log("payer:", ctx.payer.publicKey.toBase58());

  console.log("\n[1] prepare + open Kamino loan…");
  await prepare(ctx);
  await openKaminoLoan(ctx, DEPOSIT, BORROW);

  console.log("[2] open destination Jupiter Lend position…");
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterPosition(ctx, positionId);

  console.log("[3] flashloan refinance (flash borrow → refinance → flash repay)…");
  await tokenAirdrop(ctx, ctx.pair.debtMint, 5_000_000n); // fee buffer only — flashloan supplies the repay capital
  const sig = await refinanceKaminoToJupiter(ctx, positionId, DEPOSIT, BORROW);
  console.log("  ✓ refinance sig:", sig);

  await new Promise((r) => setTimeout(r, 1500));
  await printFetchedTransaction(ctx.connection, sig, "Kamino → Jupiter refinance (surfpool)");
}

main().catch((e) => {
  console.error("\n✗ refinance probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.slice(-15).join("\n"));
  process.exit(1);
});

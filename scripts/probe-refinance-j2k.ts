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
import { RPC_URL } from "../tests/constants";
import { getRefinancePair } from "../tests/market";
import { Connection } from "@solana/web3.js";
import { printFetchedTransaction } from "../tests/tx-printer";

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

  console.log("\n[1] prepare + init empty Kamino obligation (destination)…");
  await prepare(ctx);
  await initKaminoObligation(ctx);
  console.log("  ✓ Kamino obligation initialized");

  console.log("\n[2] open Jupiter Lend loan (source)…");
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterLoan(ctx, positionId, DEPOSIT, BORROW);
  console.log("  ✓ Jupiter loan open, position", positionId);

  console.log("\n[3] refinance Jupiter → Kamino…");
  await tokenAirdrop(ctx, ctx.pair.debtMint, 5_000_000n); // fee buffer only — flashloan supplies the repay capital // to repay Jupiter debt
  const sig = await refinanceJupiterToKamino(ctx, positionId, DEPOSIT, BORROW);
  console.log("  ✓ refinance sig:", sig);
  await new Promise((r) => setTimeout(r, 1500));
  await printFetchedTransaction(
    ctx.connection,
    sig,
    "Jupiter → Kamino refinance (surfpool)",
  );
}

main().catch((e) => {
  console.error("\n✗ j2k probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.slice(-16).join("\n"));
  process.exit(1);
});

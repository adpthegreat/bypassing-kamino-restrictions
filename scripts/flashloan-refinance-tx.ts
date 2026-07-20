/**
 * Execute a capital-free (flashloan-sandwiched) Kamino → Jupiter refinance on
 * surfpool, dump the confirmed transaction JSON to ./refinance-flow.json, and
 * print the local Solscan (Studio) link to view/screenshot it.
 *
 *   [flash borrow USDC] → [refinance (CPIs Kamino repay/withdraw + Jupiter deposit/borrow)] → [flash repay USDC]
 *
 * Needs a running surfpool (auto-deploys the program). No env vars required.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
  flashloanRefinanceKaminoToJupiter,
} from "../tests/bootstrap";
import {
  JLP_DEPOSIT_AMOUNT,
  USDC_BORROW_AMOUNT,
  USDC_MINT,
  RPC_URL,
} from "../tests/constants";
import { printFetchedTransaction } from "../tests/tx-printer";

// solscan.io can read from a custom RPC — point it at the local surfnet.
const solscanLink = (sig: string) =>
  `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${RPC_URL}/`;

// Time-based interest math (Kamino last_update / Jupiter token_reserve) overflows
// when surfpool's clock and the freshly-forked accounts are momentarily out of
// sync — too fresh (slot behind) right after start, or drifted (clock ahead)
// after a long session. The "too fresh" case clears in a few slots, so retry.
function isTimeMathError(e: any): boolean {
  const blob = [e?.message, (e?.simulation?.logs || []).join("\n"), (e?.logs || []).join("\n")].join("\n");
  return /No return data found in logs|LibraryMathError|LIBRARY_MATH_ERROR|MathOverflow|Math operation overflow|token_reserve\.rs|last_update\.rs/i.test(blob);
}

async function runOnce() {
  const ctx = await createCtx();
  console.log("payer:", ctx.payer.publicKey.toBase58());

  console.log("\n[1] prepare + open a Kamino JLP/USDC loan…");
  await prepare(ctx);
  await openKaminoLoan(ctx, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);

  console.log("[2] open destination Jupiter Lend position…");
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterPosition(ctx, positionId);

  // small USDC buffer to cover Kamino interest + any flash fee
  await tokenAirdrop(ctx, USDC_MINT, 5_000_000n);

  console.log("[3] flashloan-sandwiched refinance (flash borrow → refinance → flash repay)…");
  const sig = await flashloanRefinanceKaminoToJupiter(
    ctx,
    positionId,
    JLP_DEPOSIT_AMOUNT,
    USDC_BORROW_AMOUNT
  );
  console.log("  ✓ signature:", sig);

  await new Promise((r) => setTimeout(r, 1500));

  // pretty print + dump raw JSON
  await printFetchedTransaction(ctx.connection, sig, "Flashloan refinance (Kamino → Jupiter)");
  const tx = await ctx.connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const solscan = solscanLink(sig);
  const outPath = join(__dirname, "..", "refinance-flow.json");
  writeFileSync(
    outPath,
    JSON.stringify({ signature: sig, rpc: RPC_URL, solscan, transaction: tx }, null, 2)
  );
  console.log("\n  JSON dumped -> refinance-flow.json");
  console.log(`\n  ► Solscan (pointed at the local surfnet):\n    ${solscan}`);
}

async function main() {
  const MAX = 4;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      await runOnce();
      return;
    } catch (e: any) {
      if (isTimeMathError(e) && attempt < MAX) {
        console.log(
          `\n  (attempt ${attempt}/${MAX}) surfnet clock/accounts out of sync — waiting for slots to advance, retrying…`
        );
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      throw e;
    }
  }
}

main().catch((e) => {
  console.error("\n✗ failed:", e.message || e);
  if (e.simulation?.err) console.error("  simulation err:", JSON.stringify(e.simulation.err));
  if (isTimeMathError(e)) {
    console.error(
      "\n  Persistent surfpool clock drift (a long-running surfnet's clock runs ahead\n" +
        "  of the forked accounts, overflowing the protocols' time-based interest math).\n" +
        "  Restart surfpool for a fresh clock, then retry:\n" +
        "      pkill -f 'surfpool start'; surfpool start &   # re-deploys automatically\n" +
        "      npm run flow:tx"
    );
  } else if (e.simulation?.logs) {
    console.error("  logs:\n    " + e.simulation.logs.slice(-8).join("\n    "));
  }
  process.exit(1);
});

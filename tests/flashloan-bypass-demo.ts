/**
 * Flashloan / CPI-bypass demonstration.
 *
 * Kamino's RepayObligationLiquidityV2 reads the Instructions sysvar and rejects
 * the transaction if the Jupiter Lend program (jupr81…) appears among the
 * TOP-LEVEL instructions. The sysvar can only iterate top-level (stack height 1)
 * instructions — it cannot see into CPIs.
 *
 * This script runs the same economic operation two ways against surfpool and
 * prints both transactions so the difference is visible:
 *
 *   BYPASS  — the Jupiter interaction happens inside our program's CPI (height 2).
 *             No top-level jupr81 → Kamino's guard sees only our program → allowed.
 *
 *   CONTROL — a top-level Jupiter Lend flashloan (jupr81 at height 1) is added
 *             around the same refinance. Now the guard sees the restricted
 *             program at the top level → the transaction is rejected.
 *
 * Requires surfpool (mainnet fork + cheatcodes) at $ANCHOR_PROVIDER_URL and the
 * program deployed at $PROGRAM_ID.
 */
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
  refinanceKaminoToJupiter,
} from "./bootstrap";
import { Connection } from "@solana/web3.js";
import { getRefinancePair, PairContext } from "./market";
import { RPC_URL } from "./constants";
import { printFetchedTransaction } from "./tx-printer";

const DEPOSIT = 100_000_000n;
const BORROW = 300_000_000n;

async function runCase(pair: PairContext, label: string, topLevelJupiter: boolean) {
  console.log(`\n${"=".repeat(74)}\n${label}\n${"=".repeat(74)}`);
  const connection = new Connection(RPC_URL, "confirmed");
  const ctx = await createCtx(connection, pair);
  await prepare(ctx);
  await openKaminoLoan(ctx, DEPOSIT, BORROW);
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterPosition(ctx, positionId);
  await tokenAirdrop(ctx, ctx.pair.debtMint, 5_000_000n); // fee buffer only — flashloan supplies the repay capital

  try {
    const sig = await refinanceKaminoToJupiter(ctx, positionId, DEPOSIT, BORROW, {
      topLevelJupiter,
    });
    await new Promise((r) => setTimeout(r, 1200));
    await printFetchedTransaction(ctx.connection, sig, label);
    console.log(`RESULT: ✅ transaction CONFIRMED`);
    return { ok: true, blamed: null as string | null };
  } catch (e: any) {
    const logs: string[] = e.logs || e.transactionLogs || [];
    console.log(`RESULT: ❌ transaction REJECTED`);
    console.log("  reason:", e.message?.split("\n")[0] || "(see logs)");

    // Which program actually failed? KLend failing == Kamino's guard fired.
    // jupr81/other failing == the added top-level op reverted for its own reason.
    const failLine = logs.find((l) => /failed: custom program error/i.test(l));
    const blamed = failLine?.match(/Program (\S+) failed/)?.[1] ?? "unknown";
    const klendFailed = logs.some((l) => /KLend\S* failed/i.test(l));
    console.log(
      "  failing program:",
      blamed,
      klendFailed ? "(Kamino guard fired)" : "(NOT the Kamino repay — see note)"
    );
    if (logs.length)
      console.log(
        "  key logs:\n    " +
          logs
            .filter((l) => /restrict|sysvar|AnchorError|Error Message|failed/i.test(l))
            .slice(-4)
            .join("\n    ")
      );
    return { ok: false, blamed };
  }
}

async function main() {
  const pair = await getRefinancePair({ collateralSymbol: "JLP", debtSymbol: "USDC" });
  const bypass = await runCase(
    pair,
    "BYPASS — Jupiter nested in our CPI (height 2)",
    false
  );
  const control = await runCase(
    pair,
    "CONTROL — top-level Jupiter flashloan added (height 1)",
    true
  );

  console.log(`\n${"=".repeat(74)}\nSUMMARY\n${"=".repeat(74)}`);
  console.log(
    `  BYPASS  (Jupiter nested at CPI height 2):  ${bypass.ok ? "ALLOWED ✅" : "blocked"}`
  );
  console.log(
    `  CONTROL (jupr81 added at top-level):       ${control.ok ? "allowed" : "REJECTED ❌ by " + control.blamed}`
  );
  console.log(`
  MECHANISM (from klend source, handler_repay_obligation_liquidity.rs @ c060019):
    RepayObligationLiquidityV2 enforces
        constraint = ix_utils::no_restricted_programs_within_tx(instruction_sysvar)
    which iterates EVERY top-level instruction (IxIterator from index 0, via
    load_instruction_at_checked) and fails with TransactionIncludesRestrictedPrograms
    (error 6134 / 0x17f6) if any program_id is in RESTRICTED_PROGRAMS = [ jupr81YtY… ]
    (Jupiter's BORROW program). The instructions sysvar only holds top-level ixs.

  BYPASS  — our program nests every jupr81 interaction inside its CPI (height 2),
            where the top-level-only sysvar scan cannot see it → refinance allowed.
  CONTROL — a bare jupr81 instruction at the top level → the Kamino repay's scan
            finds it → TransactionIncludesRestrictedPrograms. Reproduced in surfpool.

  IMPORTANT: it must be jupr81 ITSELF at the top level. The Jupiter SDK's operate/
  refinance instruction targets jup8… (a router that CPIs jupr81), so jupr81 stays
  nested there and does NOT trip the guard — an earlier version of this control used
  that ix and wrongly appeared "not blocked". The restriction is hardcoded in the
  klend program (a const), NOT config state, and surfpool/LiteSVM enforces it.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

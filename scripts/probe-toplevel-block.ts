/**
 * Root-cause probe: does a TOP-LEVEL Kamino repay + TOP-LEVEL jupr81 get blocked?
 *
 * Builds the naive one-call refinance shape Kamino is meant to reject: the KLend
 * RepayObligationLiquidityV2 sits at stack height 1 (a direct top-level KLend
 * instruction, NOT wrapped in our program's CPI), alongside a top-level Jupiter
 * Lend (jupr81) operate. If surfpool enforces the restriction, this simulation
 * fails with TransactionIncludesRestrictedPrograms.
 *
 * Contrast: our program's refinance puts the repay inside a CPI (height 2), where
 * the top-level-only instructions-sysvar scan can't see the sibling jupr81.
 */
import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { createCtx, prepare, openKaminoLoan } from "../tests/bootstrap";
import { getRefinancePair, PairContext } from "../tests/market";
import {
  RPC_URL,
  K_LEND_PROGRAM_ID,
  K_FARMS_PROGRAM_ID,
} from "../tests/constants";
import { Connection } from "@solana/web3.js";
import {
  sendV0Tx,
  createLookupTable,
  meta,
  u64,
  TOKEN_PROGRAM_ID,
} from "../tests/utils";

const { getJupLendRefinance } = require("../tests/jup_lend_loader.js");

const DEPOSIT = 100_000_000n;
const BORROW = 250_000_000n;
const DISC_REFRESH_RESERVE = Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]);
const DISC_REFRESH_OBLIGATION = Buffer.from([
  33, 132, 147, 228, 151, 192, 72, 89,
]);
const DISC_REPAY_V2 = Buffer.from([116, 174, 213, 76, 180, 53, 210, 144]);

const klendIx = (keys: any[], data: Buffer) =>
  new TransactionInstruction({ programId: K_LEND_PROGRAM_ID, keys, data });

function refreshReserveIx(
  pair: PairContext,
  reserve: PublicKey,
  scope: PublicKey,
) {
  return klendIx(
    [
      meta(reserve, true),
      meta(pair.market),
      meta(K_LEND_PROGRAM_ID),
      meta(K_LEND_PROGRAM_ID),
      meta(K_LEND_PROGRAM_ID),
      meta(scope),
    ],
    DISC_REFRESH_RESERVE,
  );
}

function refreshObligationIx(pair: PairContext, obligation: PublicKey) {
  return klendIx(
    [
      meta(pair.market),
      meta(obligation, true),
      meta(pair.collateral.reserve, true),
      meta(pair.debt.reserve, true),
    ],
    DISC_REFRESH_OBLIGATION,
  );
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const pair = await getRefinancePair({
    collateralSymbol: "JLP",
    debtSymbol: "USDC",
  });
  const ctx = await createCtx(connection, pair);
  console.log("payer:", ctx.payer.publicKey.toBase58());
  await prepare(ctx);
  await openKaminoLoan(ctx, DEPOSIT, BORROW);
  console.log("✓ Kamino loan open\n");

  // --- top-level KLend repay flow (repay some debt) ---
  const refreshCol = refreshReserveIx(
    pair,
    pair.collateral.reserve,
    pair.collateral.scopeOracle,
  );
  const refreshDebt = refreshReserveIx(
    pair,
    pair.debt.reserve,
    pair.debt.scopeOracle,
  );
  const refreshObl = refreshObligationIx(pair, ctx.obligation);
  const repayIx = klendIx(
    [
      meta(ctx.payer.publicKey, false, true), // owner (signer)
      meta(ctx.obligation, true),
      meta(pair.market),
      meta(pair.debt.reserve, true), // borrow_reserve
      meta(pair.debt.liquidityMint), // output_mint
      meta(pair.debt.liquiditySupplyVault, true),
      meta(ctx.debtAta, true), // user_source_liquidity
      meta(TOKEN_PROGRAM_ID),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY), // <-- the account whose constraint scans the tx
      meta(ctx.debtObligationFarmState, true),
      meta(pair.debt.debtFarm, true),
      meta(pair.marketAuthority),
      meta(K_FARMS_PROGRAM_ID),
      meta(pair.collateral.reserve, true), // reserve_accounts...
      meta(pair.debt.reserve, true),
    ],
    Buffer.concat([DISC_REPAY_V2, u64(1_000_000n)]), // repay 1 unit of debt
  );

  // --- a bare TOP-LEVEL jupr81 (Jupiter Lend borrow program) instruction ---
  // The restriction scan (no_restricted_programs_within_tx) only compares
  // program_id against RESTRICTED_PROGRAMS = [jupr81…], so the instruction need
  // not be valid — its mere presence at the top level is what triggers the guard.
  // (The Jupiter SDK's operate/refinance ix actually targets jup8…, a router that
  //  CPIs jupr81, so jupr81 is nested there — which is exactly why it did NOT trip
  //  the guard before. Here we place jupr81 itself at the top level.)
  const JUPR81 = new PublicKey("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi");
  const jupIx = new TransactionInstruction({
    programId: JUPR81,
    keys: [meta(ctx.payer.publicKey, false, true)],
    data: Buffer.from([217, 106, 208, 99, 116, 151, 42, 135]), // operate discriminator
  });
  console.log(
    "top-level program placed next to repay:",
    jupIx.programId.toBase58(),
  );

  const ixs = [refreshJlp, refreshUsdc, refreshObl, repayIx, jupIx];
  const alt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    ixs.flatMap((i) => i.keys.map((k) => k.pubkey)),
  );

  console.log(
    "\nsimulating: [refreshx2, refreshObligation, REPAY_V2 (top-level), jupr81 operate (top-level)]",
  );
  try {
    const sig = await sendV0Tx({
      connection: ctx.connection,
      payerKeypair: ctx.payer,
      ixs,
      lookupTables: [alt],
      cuLimit: 1_400_000,
    });
    console.log("RESULT: tx CONFIRMED (NOT blocked) sig:", sig);
  } catch (e: any) {
    const logs: string[] = e.logs || e.transactionLogs || [];
    const joined = logs.join("\n") + "\n" + (e.message || "");
    const blocked = /TransactionIncludesRestrictedPrograms|restricted/i.test(
      joined,
    );
    console.log("RESULT: tx REJECTED");
    console.log(
      "  raw message:",
      (e.message || "").split("\n").slice(0, 3).join(" | "),
    );
    console.log("  blocked by Kamino restriction?", blocked ? "YES ✅" : "no");
    console.log(
      "  klend/restriction logs:\n    " +
        logs
          .filter((l) =>
            /KLend|restrict|Restricted|Error Code|Error Number|failed/i.test(l),
          )
          .slice(-8)
          .join("\n    "),
    );
  }
}

main().catch((e) => {
  console.error("probe error:", e.message || e);
  process.exit(1);
});

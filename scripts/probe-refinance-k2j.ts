/**
 * Probe: full Kamino → Jupiter Lend refinance through our program on surfpool.
 *
 * The refinance repays the Kamino USDC debt and withdraws JLP collateral, then
 * deposits JLP + borrows USDC on Jupiter Lend — all inside ONE call to our
 * program. Kamino's RepayObligationLiquidityV2 guard reads the Instructions
 * sysvar, which only sees our program at the top level (Jupiter is nested at CPI
 * depth 2), so the otherwise-restricted refinance is allowed. That success IS
 * the bypass demonstration.
 *
 * USDC to repay Kamino is pre-funded here to isolate the program's CPI wiring;
 * the flashloan variant (capital-free) lives in flashloan-bypass-demo.ts.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  createCtx,
  prepare,
  openKaminoLoan,
  nextJupiterPositionId,
  openJupiterPosition,
  tokenAirdrop,
} from "../tests/bootstrap";
import {
  JLP_DEPOSIT_AMOUNT,
  USDC_BORROW_AMOUNT,
  USDC_MINT,
  U64_MAX,
  JUPITER_VAULT_ID,
  FLAG_HAS_COLLATERAL,
  FLAG_HAS_BORROWS,
} from "../tests/constants";
import {
  buildJupiterOperateAccounts,
  buildKaminoBlock,
  buildRefinanceIx,
} from "../tests/refinance-helpers";
import { sendV0Tx, createLookupTable } from "../tests/utils";
import { printFetchedTransaction } from "../tests/tx-printer";

const { getJupLendBorrow } = require("../tests/jup_lend_loader.js");

async function main() {
  const ctx = await createCtx();
  console.log("payer:", ctx.payer.publicKey.toBase58());

  console.log("\n[1] prepare + open Kamino JLP/USDC loan…");
  await prepare(ctx);
  await openKaminoLoan(ctx, JLP_DEPOSIT_AMOUNT, USDC_BORROW_AMOUNT);
  console.log("  ✓ Kamino loan open");

  console.log("\n[2] open destination Jupiter Lend position…");
  const positionId = await nextJupiterPositionId(ctx);
  await openJupiterPosition(ctx, positionId);
  console.log("  ✓ Jupiter position", positionId, "open");

  console.log("\n[3] build refinance (Kamino repay+withdraw → Jupiter deposit+borrow)…");
  // Pre-fund USDC so the CPI can repay all Kamino debt without a flashloan.
  await tokenAirdrop(ctx, USDC_MINT, 10_000_000_000n);

  const borrow = await getJupLendBorrow();
  const operate = await borrow.getOperateContext({
    vaultId: JUPITER_VAULT_ID,
    positionId,
    colAmount: new BN(JLP_DEPOSIT_AMOUNT.toString()), // +deposit JLP
    debtAmount: new BN(USDC_BORROW_AMOUNT.toString()), // +borrow USDC
    connection: ctx.connection,
    signer: ctx.payer.publicKey,
    market: "main",
  });

  const jupiterAccounts = buildJupiterOperateAccounts(
    operate.accounts,
    operate.remainingAccounts,
    ctx.payer.publicKey
  );
  const kaminoBlock = buildKaminoBlock({
    owner: ctx.payer.publicKey,
    obligation: ctx.obligation,
    jlpObligationFarmState: ctx.jlpObligationFarmState,
    jlpCollateralFarm: ctx.jlpCollateralFarm,
    usdcObligationFarmState: ctx.usdcObligationFarmState,
    usdcDebtFarm: ctx.usdcDebtFarm,
    jlpAta: ctx.jlpAta,
    usdcAta: ctx.usdcAta,
  });

  const refinanceIx = buildRefinanceIx({
    direction: "kamino-to-jup",
    jupiterAccounts,
    kaminoBlock,
    amounts: {
      sourceRepay: U64_MAX, // repay all Kamino USDC
      sourceWithdraw: U64_MAX, // withdraw all Kamino JLP
      destDeposit: JLP_DEPOSIT_AMOUNT,
      destBorrow: USDC_BORROW_AMOUNT,
      kaminoFlag: FLAG_HAS_COLLATERAL | FLAG_HAS_BORROWS,
      indices: operate.remainingAccountsIndices,
    },
  });

  // Jupiter's otherIxs init shared tick accounts. On a mainnet fork many already
  // exist; keep only those whose target account is not yet initialized.
  const rawSetup = operate.otherIxs || [];
  const setupIxs = [] as typeof rawSetup;
  for (const six of rawSetup) {
    const target = six.keys.find((k: any) => k.isWritable && !k.isSigner)?.pubkey;
    const exists = target
      ? (await ctx.connection.getAccountInfo(target)) !== null
      : false;
    if (!exists) setupIxs.push(six);
  }
  console.log(
    `  refinance accounts: ${refinanceIx.keys.length} (jupiter ${jupiterAccounts.length} + kamino ${kaminoBlock.length}); setup ixs kept: ${setupIxs.length}/${rawSetup.length}`
  );

  console.log("\n[4] build lookup table for the refinance accounts…");
  const ourAlt = await createLookupTable(
    ctx.connection,
    ctx.payer,
    refinanceIx.keys.map((k) => k.pubkey)
  );
  const luts = [ourAlt, ...(operate.addressLookupTableAccounts || [])];
  console.log(`  ALT ${ourAlt.key.toBase58()} (${ourAlt.state.addresses.length} addrs)`);

  console.log("\n[5] send refinance…");
  const sig = await sendV0Tx({
    connection: ctx.connection,
    payerKeypair: ctx.payer,
    ixs: [...setupIxs, refinanceIx],
    lookupTables: luts,
    cuLimit: 1_400_000,
  });
  console.log("  ✓ refinance sig:", sig);

  await new Promise((r) => setTimeout(r, 1500));
  await printFetchedTransaction(ctx.connection, sig, "Kamino → Jupiter refinance (surfpool)");
}

main().catch((e) => {
  console.error("\n✗ refinance probe failed:", e.message || e);
  if (e.logs) console.error(e.logs.slice(-15).join("\n"));
  process.exit(1);
});

/**
 * Refinance instruction + account assembly for THIS program (Gr4of…), whose
 * ABI differs from the multi-protocol reference:
 *
 *   discriminant 10 = RefinanceKaminoToJupiter, 11 = RefinanceJupiterToKamino
 *   data  = u8(disc) ++ u64(source_repay) ++ u64(source_withdraw)
 *              ++ u64(dest_deposit) ++ u64(dest_borrow) ++ u8(kamino_flag) ++ [u8;3] indices
 *   accts = [ 36 Jupiter operate fixed ] ++ [ Jupiter remaining ] ++ [ Kamino unified block ]
 *
 * The program locates the Kamino block by scanning, after the 36 fixed Jupiter
 * accounts, for the first account whose key == KLend program id. So the Kamino
 * block MUST start with the KLend program id.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  DISC,
  PROGRAM_ID,
  JUP_LEND_BORROW_PROGRAM_ID,
  K_LEND_PROGRAM_ID,
  K_FARMS_PROGRAM_ID,
} from "./constants";
import { PairContext } from "./market";
import { u8, u64, meta, TOKEN_PROGRAM_ID } from "./utils";

type AccMeta = { pubkey: PublicKey; isWritable: boolean; isSigner: boolean };

// ---------------------------------------------------------------------------
// Jupiter operate account list (36 fixed, program struct order) + remaining
// ---------------------------------------------------------------------------
//
// `accounts` is the object returned by @jup-ag/lend getRefinanceIx/getOperateContext.
// null fields (claim accounts on a non-reward vault) become the vaults program id
// placeholder — a readonly account the program forwards untouched.
//
// Writable/signer flags follow Jupiter's operate instruction requirements.
const W = true;
const R = false;

export function buildJupiterOperateAccounts(
  accounts: Record<string, PublicKey | null>,
  remainingAccounts: AccMeta[],
  signer: PublicKey
): AccMeta[] {
  const P = JUP_LEND_BORROW_PROGRAM_ID; // placeholder for null / program slot
  const a = (k: string, fallback?: PublicKey) =>
    (accounts[k] as PublicKey) ?? fallback ?? P;

  // [struct field, pubkey, writable, signer]
  const fixed: [PublicKey, boolean, boolean][] = [
    [P, R, R], // 0  vaults_program
    [a("signer", signer), W, true], // 1  signer
    [a("signerSupplyTokenAccount"), W, R], // 2
    [a("signerBorrowTokenAccount"), W, R], // 3
    [a("recipient", signer), R, R], // 4  recipient
    [a("recipientBorrowTokenAccount"), W, R], // 5  (borrow BEFORE supply — program order)
    [a("recipientSupplyTokenAccount"), W, R], // 6
    [a("vaultConfig"), W, R], // 7
    [a("vaultState"), W, R], // 8
    [a("supplyToken"), R, R], // 9
    [a("borrowToken"), R, R], // 10
    [a("oracle"), R, R], // 11
    [a("position"), W, R], // 12
    [a("positionTokenAccount"), R, R], // 13
    [a("currentPositionTick"), W, R], // 14
    [a("finalPositionTick"), W, R], // 15
    [a("currentPositionTickId"), W, R], // 16
    [a("finalPositionTickId"), W, R], // 17
    [a("newBranch"), W, R], // 18
    [a("supplyTokenReservesLiquidity"), W, R], // 19
    [a("borrowTokenReservesLiquidity"), W, R], // 20
    [a("vaultSupplyPositionOnLiquidity"), W, R], // 21
    [a("vaultBorrowPositionOnLiquidity"), W, R], // 22
    [a("supplyRateModel"), W, R], // 23
    [a("borrowRateModel"), W, R], // 24
    [a("vaultSupplyTokenAccount"), W, R], // 25
    [a("vaultBorrowTokenAccount"), W, R], // 26
    [a("supplyTokenClaimAccount"), R, R], // 27 (null -> placeholder)
    [a("borrowTokenClaimAccount"), R, R], // 28 (null -> placeholder)
    [a("liquidity"), W, R], // 29
    [a("liquidityProgram"), R, R], // 30
    [a("oracleProgram"), R, R], // 31
    [a("supplyTokenProgram", TOKEN_PROGRAM_ID), R, R], // 32
    [a("borrowTokenProgram", TOKEN_PROGRAM_ID), R, R], // 33
    [a("associatedTokenProgram"), R, R], // 34
    [a("systemProgram"), R, R], // 35
  ];

  const metas: AccMeta[] = fixed.map(([pubkey, isWritable, isSigner]) => ({
    pubkey,
    isWritable,
    isSigner,
  }));
  // Jupiter's variable remaining accounts (tick arrays, branches, …).
  for (const ra of remainingAccounts)
    metas.push({ pubkey: ra.pubkey, isWritable: ra.isWritable, isSigner: false });
  return metas;
}

// ---------------------------------------------------------------------------
// Kamino unified block (order from refinance.rs KaminoAccounts::try_from_slice)
// Starts with KLend program id — the boundary marker the program scans for.
// ---------------------------------------------------------------------------
export interface KaminoBlockParams {
  pair: PairContext;
  owner: PublicKey;
  obligation: PublicKey;
  collateralObligationFarmState: PublicKey;
  debtObligationFarmState: PublicKey;
  collateralAta: PublicKey;
  debtAta: PublicKey;
}

export function buildKaminoBlock(p: KaminoBlockParams): AccMeta[] {
  const c = p.pair.collateral;
  const d = p.pair.debt;
  return [
    meta(K_LEND_PROGRAM_ID, false, false), // boundary marker
    meta(p.owner, false, true), // owner (signer)
    meta(p.obligation, true, false),
    meta(p.pair.market, false, false),
    meta(p.pair.marketAuthority, false, false),
    // collateral leg
    meta(c.reserve, true, false),
    meta(c.liquidityMint, false, false),
    meta(c.liquiditySupplyVault, true, false),
    meta(c.collateralMint, true, false),
    meta(c.collateralSupplyVault, true, false),
    meta(p.collateralAta, true, false),
    meta(TOKEN_PROGRAM_ID, false, false), // collateral_token_program
    meta(TOKEN_PROGRAM_ID, false, false), // liquidity_token_program
    meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false),
    meta(p.collateralObligationFarmState, true, false),
    meta(c.collateralFarm, true, false),
    meta(K_FARMS_PROGRAM_ID, false, false),
    meta(c.scopeOracle, false, false), // collateral scope oracle
    // debt leg
    meta(d.reserve, true, false),
    meta(d.liquidityMint, false, false),
    meta(d.liquiditySupplyVault, true, false),
    meta(d.feeVault, true, false),
    meta(p.debtAta, true, false),
    meta(TOKEN_PROGRAM_ID, false, false), // debt_token_program
    meta(p.debtObligationFarmState, true, false),
    meta(d.debtFarm, true, false),
    meta(d.scopeOracle, false, false), // debt scope oracle
    // reserve_accounts (obligation's reserves for in-CPI refresh)
    meta(c.reserve, true, false),
    meta(d.reserve, true, false),
  ];
}

// ---------------------------------------------------------------------------
// Instruction data
// ---------------------------------------------------------------------------
export interface RefinanceAmounts {
  sourceRepay: bigint;
  sourceWithdraw: bigint;
  destDeposit: bigint;
  destBorrow: bigint;
  kaminoFlag: number;
  indices: number[]; // 3 tick indices from the Jupiter operate context
}

function encodeRefinanceData(disc: number, a: RefinanceAmounts): Buffer {
  const idx = Buffer.from([
    a.indices[0] ?? 0,
    a.indices[1] ?? 0,
    a.indices[2] ?? 0,
  ]);
  return Buffer.concat([
    u8(disc),
    u64(a.sourceRepay),
    u64(a.sourceWithdraw),
    u64(a.destDeposit),
    u64(a.destBorrow),
    u8(a.kaminoFlag),
    idx,
  ]);
}

// ---------------------------------------------------------------------------
// Top-level refinance instruction
// ---------------------------------------------------------------------------
export function buildRefinanceIx(opts: {
  direction: "kamino-to-jup" | "jup-to-kamino";
  jupiterAccounts: AccMeta[]; // from buildJupiterOperateAccounts
  kaminoBlock: AccMeta[]; // from buildKaminoBlock
  amounts: RefinanceAmounts;
}): TransactionInstruction {
  const disc =
    opts.direction === "kamino-to-jup"
      ? DISC.REFINANCE_KAMINO_TO_JUP
      : DISC.REFINANCE_JUP_TO_KAMINO;

  const keys = [...opts.jupiterAccounts, ...opts.kaminoBlock];
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: encodeRefinanceData(disc, opts.amounts),
  });
}

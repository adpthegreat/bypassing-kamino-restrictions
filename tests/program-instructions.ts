/**
 * Thin TransactionInstruction builders for THIS program's non-refinance
 * entrypoints (discriminants 0–7). Account orders mirror the Rust account
 * structs in program/src/protocols/{kamino,juplend}/actions.rs exactly.
 *
 * These are used by the tests to open a Kamino/Jupiter position before running
 * a refinance (same pattern as the reference suite).
 */
import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  DISC,
  PROGRAM_ID,
  K_LEND_PROGRAM_ID,
  K_FARMS_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  JLP_LENDING_MARKET,
  JLP_LENDING_MARKET_AUTH,
  JLP_RESERVE,
  JLP_MINT,
  JLP_SUPPLY_VAULT,
  JLP_COLLATERAL_MINT,
  JLP_COLLATERAL_VAULT,
  USDC_RESERVE,
  USDC_MINT,
  USDC_SUPPLY_VAULT,
  USDC_FEE_VAULT,
  SCOPE_ORACLE_ACCOUNT,
  SCOPE_ORACLE_ACCOUNT_2,
  JUP_LEND_BORROW_PROGRAM_ID,
} from "./constants";
import {
  u8,
  u16,
  u32,
  u64,
  meta,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "./utils";

const ix = (keys: any[], data: Buffer) =>
  new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

// --- INIT_KAMINO: user_metadata + obligation + obligation_farms (one reserve/mode)
export function initKaminoIx(p: {
  owner: PublicKey;
  userMetadata: PublicKey;
  obligation: PublicKey;
  reserve: PublicKey;
  obligationFarmState: PublicKey;
  reserveFarmState: PublicKey;
  mode: number; // 0 = collateral farm, 1 = debt farm
}): TransactionInstruction {
  return ix(
    [
      meta(K_LEND_PROGRAM_ID),
      meta(p.owner, false, true),
      meta(p.userMetadata, true),
      meta(p.obligation, true),
      meta(JLP_LENDING_MARKET),
      meta(JLP_LENDING_MARKET_AUTH),
      meta(p.reserve, true),
      meta(p.obligationFarmState, true),
      meta(p.reserveFarmState, true),
      meta(K_FARMS_PROGRAM_ID),
      meta(SYSVAR_RENT_PUBKEY),
      meta(SystemProgram.programId),
    ],
    Buffer.concat([u8(DISC.INIT_KAMINO), u8(p.mode)])
  );
}

// --- DEPOSIT_KAMINO (JLP collateral)
export function depositKaminoIx(p: {
  owner: PublicKey;
  obligation: PublicKey;
  jlpAta: PublicKey;
  jlpObligationFarmState: PublicKey;
  jlpCollateralFarm: PublicKey;
  amount: bigint;
  flags: number;
  reserveAccounts?: PublicKey[];
}): TransactionInstruction {
  const keys = [
    meta(K_LEND_PROGRAM_ID),
    meta(p.owner, false, true),
    meta(p.obligation, true),
    meta(JLP_LENDING_MARKET),
    meta(JLP_LENDING_MARKET_AUTH),
    meta(JLP_RESERVE, true),
    meta(JLP_MINT),
    meta(JLP_SUPPLY_VAULT, true),
    meta(JLP_COLLATERAL_MINT, true),
    meta(JLP_COLLATERAL_VAULT, true),
    meta(p.jlpAta, true),
    meta(TOKEN_PROGRAM_ID), // collateral_token_program
    meta(TOKEN_PROGRAM_ID), // liquidity_token_program
    meta(SYSVAR_INSTRUCTIONS_PUBKEY),
    meta(p.jlpObligationFarmState, true),
    meta(p.jlpCollateralFarm, true),
    meta(K_FARMS_PROGRAM_ID),
    meta(SCOPE_ORACLE_ACCOUNT), // scope_oracle (collateral)
    meta(USDC_RESERVE, true), // borrow_reserve
    meta(SCOPE_ORACLE_ACCOUNT_2), // scope_oracle_borrow
    ...(p.reserveAccounts ?? []).map((r) => meta(r, true)),
  ];
  return ix(keys, Buffer.concat([u8(DISC.DEPOSIT_KAMINO), u64(p.amount), u8(p.flags)]));
}

// --- BORROW_KAMINO (USDC debt)
export function borrowKaminoIx(p: {
  owner: PublicKey;
  obligation: PublicKey;
  usdcAta: PublicKey;
  usdcObligationFarmState: PublicKey;
  usdcDebtFarm: PublicKey;
  amount: bigint;
  flags: number;
  reserveAccounts?: PublicKey[];
}): TransactionInstruction {
  const keys = [
    meta(K_LEND_PROGRAM_ID),
    meta(p.owner, false, true),
    meta(p.obligation, true),
    meta(JLP_LENDING_MARKET),
    meta(JLP_LENDING_MARKET_AUTH),
    meta(JLP_RESERVE, true), // collateral_reserve
    meta(USDC_RESERVE, true), // borrow_reserve
    meta(USDC_MINT), // output_mint
    meta(USDC_SUPPLY_VAULT, true), // reserve_borrow_supply
    meta(USDC_FEE_VAULT, true), // fee_receiver
    meta(p.usdcAta, true), // user_borrow_destination
    meta(TOKEN_PROGRAM_ID),
    meta(SYSVAR_INSTRUCTIONS_PUBKEY),
    meta(p.usdcObligationFarmState, true),
    meta(p.usdcDebtFarm, true),
    meta(K_FARMS_PROGRAM_ID),
    meta(SCOPE_ORACLE_ACCOUNT), // scope_oracle_collateral
    meta(SCOPE_ORACLE_ACCOUNT_2), // scope_oracle_borrow
    ...(p.reserveAccounts ?? [JLP_RESERVE]).map((r) => meta(r, true)),
  ];
  return ix(keys, Buffer.concat([u8(DISC.BORROW_KAMINO), u64(p.amount), u8(p.flags)]));
}

// --- DEPOSIT_AND_BORROW_JUPLEND (disc 6): open/grow a Jupiter loan via CPI.
// keys = buildJupiterOperateAccounts(...); data = [disc][deposit u64][borrow u64][indices u8;3]
export function depositAndBorrowJuplendIx(
  keys: any[],
  depositAmount: bigint,
  borrowAmount: bigint,
  indices: number[]
): TransactionInstruction {
  const idx = Buffer.from([indices[0] ?? 0, indices[1] ?? 0, indices[2] ?? 0]);
  return ix(
    keys,
    Buffer.concat([
      u8(DISC.DEPOSIT_AND_BORROW_JUPLEND),
      u64(depositAmount),
      u64(borrowAmount),
      idx,
    ])
  );
}

// --- INIT_JUPITER_LEND (open a Jupiter Lend position)
export function initJupiterIx(p: {
  owner: PublicKey;
  vaultAdmin: PublicKey;
  vaultState: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  metadataAccount: PublicKey;
  vaultId: number;
  nextPositionId: number;
}): TransactionInstruction {
  return ix(
    [
      meta(JUP_LEND_BORROW_PROGRAM_ID),
      meta(p.owner, false, true),
      meta(p.vaultAdmin, true),
      meta(p.vaultState, true),
      meta(p.position, true),
      meta(p.positionMint, true),
      meta(p.positionTokenAccount, true),
      meta(p.metadataAccount, true),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY),
      meta(METADATA_PROGRAM_ID),
      meta(SYSVAR_RENT_PUBKEY),
    ],
    Buffer.concat([u8(DISC.INIT_JUPITER_LEND), u16(p.vaultId), u32(p.nextPositionId)])
  );
}

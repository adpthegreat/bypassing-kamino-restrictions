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
  JUP_LEND_BORROW_PROGRAM_ID,
} from "./constants";
import { PairContext } from "./market";
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
  pair: PairContext;
  owner: PublicKey;
  userMetadata: PublicKey;
  obligation: PublicKey;
  reserve: PublicKey; // pair.collateral.reserve or pair.debt.reserve
  obligationFarmState: PublicKey;
  reserveFarmState: PublicKey; // the reserve's farm (collateral or debt)
  mode: number; // 0 = collateral farm, 1 = debt farm
}): TransactionInstruction {
  return ix(
    [
      meta(K_LEND_PROGRAM_ID),
      meta(p.owner, false, true),
      meta(p.userMetadata, true),
      meta(p.obligation, true),
      meta(p.pair.market),
      meta(p.pair.marketAuthority),
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

export function depositKaminoIx(p: {
  pair: PairContext;
  owner: PublicKey;
  obligation: PublicKey;
  collateralAta: PublicKey;
  collateralObligationFarmState: PublicKey;
  amount: bigint;
  flags: number;
  reserveAccounts?: PublicKey[];
}): TransactionInstruction {
  const c = p.pair.collateral;
  const keys = [
    meta(K_LEND_PROGRAM_ID),
    meta(p.owner, false, true),
    meta(p.obligation, true),
    meta(p.pair.market),
    meta(p.pair.marketAuthority),
    meta(c.reserve, true),
    meta(c.liquidityMint),
    meta(c.liquiditySupplyVault, true),
    meta(c.collateralMint, true),
    meta(c.collateralSupplyVault, true),
    meta(p.collateralAta, true),
    meta(TOKEN_PROGRAM_ID), // collateral_token_program
    meta(TOKEN_PROGRAM_ID), // liquidity_token_program
    meta(SYSVAR_INSTRUCTIONS_PUBKEY),
    meta(p.collateralObligationFarmState, true),
    meta(c.collateralFarm, true),
    meta(K_FARMS_PROGRAM_ID),
    meta(c.scopeOracle), // scope_oracle (collateral)
    meta(p.pair.debt.reserve, true), // borrow_reserve
    meta(p.pair.debt.scopeOracle), // scope_oracle_borrow
    ...(p.reserveAccounts ?? []).map((r) => meta(r, true)),
  ];
  return ix(keys, Buffer.concat([u8(DISC.DEPOSIT_KAMINO), u64(p.amount), u8(p.flags)]));
}

export function borrowKaminoIx(p: {
  pair: PairContext;
  owner: PublicKey;
  obligation: PublicKey;
  debtAta: PublicKey;
  debtObligationFarmState: PublicKey;
  amount: bigint;
  flags: number;
  reserveAccounts?: PublicKey[];
}): TransactionInstruction {
  const d = p.pair.debt;
  const keys = [
    meta(K_LEND_PROGRAM_ID),
    meta(p.owner, false, true),
    meta(p.obligation, true),
    meta(p.pair.market),
    meta(p.pair.marketAuthority),
    meta(p.pair.collateral.reserve, true), // collateral_reserve
    meta(d.reserve, true), // borrow_reserve
    meta(d.liquidityMint), // output_mint
    meta(d.liquiditySupplyVault, true), // reserve_borrow_supply
    meta(d.feeVault, true), // fee_receiver
    meta(p.debtAta, true), // user_borrow_destination
    meta(TOKEN_PROGRAM_ID),
    meta(SYSVAR_INSTRUCTIONS_PUBKEY),
    meta(p.debtObligationFarmState, true),
    meta(d.debtFarm, true),
    meta(K_FARMS_PROGRAM_ID),
    meta(p.pair.collateral.scopeOracle), // scope_oracle_collateral
    meta(d.scopeOracle), // scope_oracle_borrow
    ...(p.reserveAccounts ?? [p.pair.collateral.reserve]).map((r) => meta(r, true)),
  ];
  return ix(keys, Buffer.concat([u8(DISC.BORROW_KAMINO), u64(p.amount), u8(p.flags)]));
}

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

import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";


// This program (Kamino <> Jupiter Lend refinance, Pinocchio)

// Nothing asset-specific lives here — reserves, vaults, oracles, mints, and the
// market are all resolved just-in-time per pair in tests/market.ts. This file
// holds only program ids, the instruction ABI, and global sentinels.
//
// Surfpool auto-deploys the program at the cargo-generated keypair; resolve the
// program id from it so tests match the deployment. Precedence:
//   PROGRAM_ID env  >  deployed keypair  >  lib.rs placeholder
function resolveProgramId(): string {
  if (process.env.PROGRAM_ID) return process.env.PROGRAM_ID;
  try {
    const secret = JSON.parse(
      readFileSync(
        join(__dirname, "..", "target", "deploy", "kamino_juplend_refinance-keypair.json"),
        "utf8"
      )
    );
    return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
  } catch {
    return "Gr4ofKMU4AFW9hpR1dYxbVBHjvXDw9d6LYpCscTc3xMD";
  }
}
export const PROGRAM_ID = new PublicKey(resolveProgramId());

// Instruction discriminants (see program/src/entrypoint.rs).
export const DISC = {
  INIT_KAMINO: 0,
  INIT_JUPITER_LEND: 1,
  DEPOSIT_KAMINO: 2,
  BORROW_KAMINO: 3,
  REPAY_KAMINO: 4,
  WITHDRAW_KAMINO: 5,
  DEPOSIT_AND_BORROW_JUPLEND: 6,
  REPAY_AND_WITHDRAW_JUPLEND: 7,
  REFINANCE_KAMINO_TO_JUP: 10,
  REFINANCE_JUP_TO_KAMINO: 11,
} as const;

// Kamino refresh-obligation state flags (program/src/protocols/kamino/actions.rs).
export const FLAG_HAS_COLLATERAL = 1 << 0;
export const FLAG_HAS_BORROWS = 1 << 1;

// ---------------------------------------------------------------------------
// External programs (not asset-specific)
// ---------------------------------------------------------------------------
export const K_LEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const K_FARMS_PROGRAM_ID = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
);
export const JUP_LEND_BORROW_PROGRAM_ID = new PublicKey(
  "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi"
);
export const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export const U64_MAX = 18446744073709551615n;
export const MIN_I128 = BigInt("-170141183460469231731687303715884105728");

export const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
export const MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";

import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// This program (Kamino <> Jupiter Lend refinance, Pinocchio)
// ---------------------------------------------------------------------------
// Surfpool auto-deploys the program (runbooks/deployment) at the address of the
// cargo-generated keypair target/deploy/kamino_juplend_refinance-keypair.json.
// Resolve the program id from that keypair so the tests always match what
// surfpool deployed — no manual deploy, no env wiring. Precedence:
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
// External programs
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

// ---------------------------------------------------------------------------
// JLP/USDC market (the refinance pair used by the tests)
// ---------------------------------------------------------------------------
export const JLP_LENDING_MARKET = new PublicKey(
  "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek"
);
export const [JLP_LENDING_MARKET_AUTH] = PublicKey.findProgramAddressSync(
  [Buffer.from("lma"), JLP_LENDING_MARKET.toBuffer()],
  K_LEND_PROGRAM_ID
);

// Kamino scope price feeds (two feeds cover JLP collateral + USDC debt).
export const SCOPE_ORACLE_ACCOUNT = new PublicKey(
  "3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C"
);
export const SCOPE_ORACLE_ACCOUNT_2 = new PublicKey(
  "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"
);

// Mints
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const JLP_MINT = new PublicKey(
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4"
);

// Kamino JLP reserve (collateral leg)
export const JLP_RESERVE = new PublicKey(
  "DdTmCCjv7zHRD1hJv3E8bpnSEQBzdKkzB1j9ApXX5QoP"
);
export const JLP_SUPPLY_VAULT = new PublicKey(
  "CHcHknV6KujiUVqVsQfJrqUcsifgJmWBzhUWyYibt1ss"
);
export const JLP_COLLATERAL_MINT = new PublicKey(
  "G6LBmbbApvCrTGjMsPsxW43AGmzvcXa7P8x9yvHbek1f"
);
export const JLP_COLLATERAL_VAULT = new PublicKey(
  "7hWy6oHrmnG9Bq15BBC7GMphZSBvENGBLqE6A2DdjXRf"
);

// Kamino USDC reserve (debt leg)
export const USDC_RESERVE = new PublicKey(
  "Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp"
);
export const USDC_SUPPLY_VAULT = new PublicKey(
  "GENey8es3EgGiNTM8H8gzA3vf98haQF8LHiYFyErjgrv"
);
export const USDC_FEE_VAULT = new PublicKey(
  "rywFxeqHfCWL5iGq9cDxutwiiR2TabZgzv8aRM1Lceq"
);

// Jupiter Lend JLP/USDC vault
export const JUPITER_VAULT_ID = 8;

// Amount conventions
export const U64_MAX = 18446744073709551615n;
export const MIN_I128 = BigInt("-170141183460469231731687303715884105728");

// Test sizing
export const JLP_DEPOSIT_AMOUNT = 100_000_000n; // 0.1 JLP (6 decimals? see note)
export const USDC_BORROW_AMOUNT = 300_000_000n; // 300 USDC

export const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
export const MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";

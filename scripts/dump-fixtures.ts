/**
 * Dump mainnet fixtures for the LiteSVM test: a set of accounts (base64) plus
 * the on-chain KLend program binary, and the reference slot/clock. Deterministic
 * inputs → LiteSVM reproduces the same execution every run (unlike a live fork).
 *
 *   yarn dump-fixtures            # dumps from mainnet
 *   RPC=http://127.0.0.1:8899 yarn dump-fixtures   # or from the running surfpool
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { MAINNET_RPC_URL, K_LEND_PROGRAM_ID } from "../tests/constants";
import { getRefinancePair } from "../tests/market";

const RPC = process.env.RPC || MAINNET_RPC_URL;
const OUT = join(__dirname, "..", "tests", "fixtures");
const COLLATERAL = process.env.COLLATERAL || "JLP";
const DEBT = process.env.DEBT || "USDC";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const connection = new Connection(RPC, "confirmed");

  // Resolve the pair JIT so the fixtures aren't hardcoded to one asset.
  const pair = await getRefinancePair({ collateralSymbol: COLLATERAL, debtSymbol: DEBT });
  const ACCOUNTS: Record<string, PublicKey> = {
    collateral_reserve: pair.collateral.reserve,
    lending_market: pair.market,
    scope_oracle: pair.collateral.scopeOracle,
  };

  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot).catch(() => null);
  const manifest: any = { rpc: RPC, slot, blockTime, accounts: {} };

  for (const [name, pk] of Object.entries(ACCOUNTS)) {
    const info = await connection.getAccountInfo(pk, "confirmed");
    if (!info) throw new Error(`account ${name} (${pk.toBase58()}) not found`);
    const rec = {
      pubkey: pk.toBase58(),
      lamports: info.lamports,
      owner: info.owner.toBase58(),
      executable: info.executable,
      data: info.data.toString("base64"),
    };
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(rec, null, 2));
    manifest.accounts[name] = rec.pubkey;
    console.log(`  dumped ${name}: ${pk.toBase58()} (${info.data.length}B)`);
  }

  // Dump the KLend program binary via the solana CLI.
  const klendSo = join(OUT, "klend.so");
  execFileSync(
    "solana",
    ["program", "dump", K_LEND_PROGRAM_ID.toBase58(), klendSo, "--url", RPC],
    { stdio: "inherit" }
  );
  console.log(`  dumped KLend program -> ${klendSo}`);

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ fixtures written to ${OUT} (slot ${slot})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

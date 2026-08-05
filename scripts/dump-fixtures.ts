/**
 * Snapshot the protocol-owned closure for the LiteSVM refinance test.
 *
 * This talks directly to mainnet: no Surfpool account fetching is involved.
 * User-owned state (payer, ATAs, obligation/farm PDAs, Jupiter position) is
 * deliberately omitted because litesvm-refinance.ts creates it locally.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  JUP_LEND_BORROW_PROGRAM_ID,
  K_FARMS_PROGRAM_ID,
  K_LEND_PROGRAM_ID,
  MAINNET_RPC_URL,
  METADATA_PROGRAM_ID,
} from "../tests/constants";

const RPC = process.env.MAINNET_RPC_URL || MAINNET_RPC_URL;
const OUT = join(__dirname, "..", "tests", "fixtures");
const FLOW = join(__dirname, "..", "refinance-flow.json");
const PROGRAMS = [
  K_LEND_PROGRAM_ID,
  K_FARMS_PROGRAM_ID,
  JUP_LEND_BORROW_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  new PublicKey("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"),
  new PublicKey("jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc"),
];
const BUILT_INS = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "Sysvar1nstructions1111111111111111111111111",
  "SysvarRent111111111111111111111111111111111",
]);

function recordedProtocolAccounts(): PublicKey[] {
  const flow = JSON.parse(readFileSync(FLOW, "utf8"));
  const message = flow.transaction.transaction.message;
  const keys = [
    ...(message.staticAccountKeys || []),
    ...(flow.transaction.meta.loadedAddresses?.writable || []),
    ...(flow.transaction.meta.loadedAddresses?.readonly || []),
  ];
  const programs = new Set(PROGRAMS.map((p) => p.toBase58()));
  return [...new Set(keys)]
    .filter((key) => !BUILT_INS.has(key) && !programs.has(key))
    .map((key) => new PublicKey(key));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const connection = new Connection(RPC, "confirmed");
  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  const accounts = recordedProtocolAccounts();
  const infos = await connection.getMultipleAccountsInfo(accounts, "confirmed");
  const dumped: Record<string, string> = {};

  for (let i = 0; i < accounts.length; i++) {
    const info = infos[i];
    if (!info) continue; // recorded payer/position accounts are intentionally local
    const key = accounts[i].toBase58();
    const filename = `account-${key}.json`;
    writeFileSync(join(OUT, filename), JSON.stringify({
      pubkey: key, lamports: info.lamports, owner: info.owner.toBase58(),
      executable: info.executable, data: info.data.toString("base64"),
    }));
    dumped[key] = filename;
  }

  for (const program of PROGRAMS) {
    const filename = `program-${program.toBase58()}.so`;
    execFileSync("solana", ["program", "dump", program.toBase58(), join(OUT, filename), "--url", RPC], { stdio: "inherit" });
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
    rpc: RPC, slot, blockTime, accounts: dumped,
    programs: PROGRAMS.map((program) => program.toBase58()),
    localState: ["payer", "token accounts", "Kamino obligation/farm PDAs", "Jupiter position/mint/metadata"],
  }, null, 2));
  console.log(`\n✓ dumped ${Object.keys(dumped).length} protocol accounts and ${PROGRAMS.length} programs to ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

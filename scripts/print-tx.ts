/**
 * Fetch a transaction by signature from any cluster and pretty-print it in the
 * terminal, Solscan-style (see tests/tx-printer.ts).
 *
 *   yarn print-tx <signature> [rpcUrl]
 *   MAINNET_RPC_URL=... yarn print-tx <signature>
 */
import { Connection } from "@solana/web3.js";
import { printFetchedTransaction } from "../tests/tx-printer";
import { MAINNET_RPC_URL } from "../tests/constants";

async function main() {
  const sig = process.argv[2];
  const rpc = process.argv[3] || MAINNET_RPC_URL;
  if (!sig) {
    console.error("usage: yarn print-tx <signature> [rpcUrl]");
    process.exit(1);
  }
  const connection = new Connection(rpc, "confirmed");
  await printFetchedTransaction(connection, sig, "fetched transaction");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

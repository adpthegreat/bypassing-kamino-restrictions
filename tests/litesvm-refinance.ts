/**
 * LiteSVM determinism harness.
 *
 * Loads dumped mainnet fixtures (Kamino KLend program + JLP reserve + lending
 * market + scope price feed) into an in-process LiteSVM, aligns the clock with
 * the fixture slot so the oracle is fresh, and executes a real Kamino
 * RefreshReserve instruction — then prints it Solscan-style.
 *
 * Unlike the surfpool tests (which lazily fork live mainnet and drift between
 * runs), this is fully deterministic: the same fixtures produce the same result
 * every time. It demonstrates the dump-fixtures → LiteSVM → solscan-printer
 * pipeline against real on-chain Kamino state.
 *
 * Run `yarn dump-fixtures` first to populate tests/fixtures/.
 *
 * NOTE: LiteSVM has no lazy account cloning, so the full cross-protocol refinance
 * (which CPIs into ~6 programs and touches ~60 accounts) is exercised on surfpool
 * instead (tests/refinance-*.ts, both directions passing). This file proves the
 * deterministic-fixtures harness on a self-contained Kamino instruction.
 */
import { expect } from "chai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { LiteSVM, Clock, TransactionMetadata } from "litesvm";
import {
  K_LEND_PROGRAM_ID,
  JLP_RESERVE,
  JLP_LENDING_MARKET,
  SCOPE_ORACLE_ACCOUNT,
} from "./constants";
import { printLiteSVMResult } from "./tx-printer";

const FIX = join(__dirname, "fixtures");
const DISC_REFRESH_RESERVE = Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]);

function loadFixtureAccount(svm: LiteSVM, name: string) {
  const rec = JSON.parse(readFileSync(join(FIX, `${name}.json`), "utf8"));
  svm.setAccount(new PublicKey(rec.pubkey), {
    lamports: rec.lamports,
    data: new Uint8Array(Buffer.from(rec.data, "base64")),
    owner: new PublicKey(rec.owner),
    executable: rec.executable,
    rentEpoch: 0,
  });
  return rec;
}

describe("LiteSVM: deterministic Kamino RefreshReserve from mainnet fixtures", function () {
  this.timeout(60_000);

  before(function () {
    if (!existsSync(join(FIX, "manifest.json"))) {
      console.warn("\n  fixtures missing — run `yarn dump-fixtures` first. Skipping.");
      this.skip();
    }
  });

  it("refreshes the JLP reserve against real scope prices", () => {
    const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8"));
    const svm = new LiteSVM().withSplPrograms().withSysvars();

    // Load the KLend program + the accounts it reads.
    svm.addProgramFromFile(K_LEND_PROGRAM_ID, join(FIX, "klend.so"));
    loadFixtureAccount(svm, "jlp_reserve");
    loadFixtureAccount(svm, "jlp_lending_market");
    loadFixtureAccount(svm, "scope_oracle");

    // Align the clock with the fixture slot/time so scope prices aren't stale.
    const slot = BigInt(manifest.slot);
    const ts = BigInt(manifest.blockTime ?? Math.floor(Date.now() / 1000));
    const epoch = BigInt(Math.floor(manifest.slot / 432000));
    // Clock(slot, epochStartTimestamp, epoch, leaderScheduleEpoch, unixTimestamp)
    svm.setClock(new Clock(slot, ts, epoch, epoch, ts));

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, 10_000_000_000n);

    // Kamino RefreshReserve: reserve(w), lending_market, pyth, switchboard_price,
    // switchboard_twap, scope_prices. JLP uses scope, so pyth/switchboard are the
    // program-id placeholder (same convention as the program's refresh_reserve).
    const ix = new TransactionInstruction({
      programId: K_LEND_PROGRAM_ID,
      keys: [
        { pubkey: JLP_RESERVE, isWritable: true, isSigner: false },
        { pubkey: JLP_LENDING_MARKET, isWritable: false, isSigner: false },
        { pubkey: K_LEND_PROGRAM_ID, isWritable: false, isSigner: false },
        { pubkey: K_LEND_PROGRAM_ID, isWritable: false, isSigner: false },
        { pubkey: K_LEND_PROGRAM_ID, isWritable: false, isSigner: false },
        { pubkey: SCOPE_ORACLE_ACCOUNT, isWritable: false, isSigner: false },
      ],
      data: DISC_REFRESH_RESERVE,
    });

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const res = svm.sendTransaction(tx);
    const ok = res instanceof TransactionMetadata;
    const meta: any = ok ? res : (res as any).meta();

    printLiteSVMResult({
      title: "Kamino RefreshReserve (LiteSVM, deterministic fixtures)",
      signature: meta.signature ? Buffer.from(meta.signature()).toString("hex").slice(0, 16) : undefined,
      err: ok ? null : "transaction failed",
      logs: meta.logs(),
      computeUnits: Number(meta.computeUnitsConsumed()),
      accounts: ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        signer: k.isSigner,
        writable: k.isWritable,
      })),
      instructions: [
        {
          programId: K_LEND_PROGRAM_ID.toBase58(),
          accounts: ix.keys.map((k) => k.pubkey.toBase58()),
          dataLen: ix.data.length,
        },
      ],
    });

    expect(ok, "RefreshReserve failed in LiteSVM").to.be.true;
    expect(meta.logs().some((l: string) => /RefreshReserve|Token:/.test(l))).to.be.true;
  });
});

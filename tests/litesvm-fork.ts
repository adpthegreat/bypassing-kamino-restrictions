/**
 * A lazy-cloning mainnet fork over an in-process LiteSVM done locally so the WHOLE refinance flow (init
 * obligation → deposit → borrow → open Jupiter position → refinance) executes in
 * LiteSVM with nothing running on surfpool.
 *
 */
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { AccountLayout, ACCOUNT_SIZE } from "@solana/spl-token";
import {
  LiteSVM,
  Clock,
  TransactionMetadata,
  FailedTransactionMetadata,
} from "litesvm";
import { readdirSync } from "fs";
import { join } from "path";
import { PROGRAM_ID } from "./constants";
import { TOKEN_PROGRAM_ID } from "./utils";

const FIX = join(__dirname, "fixtures");
const OUR_SO = join(__dirname, "..", "target", "deploy", "kamino_juplend_refinance.so");
const ALT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

export class LiteSvmFork {
  readonly svm: LiteSVM;
  readonly mainnet: Connection;
  private loaded = new Set<string>();
  private clockSlot = 0n;
  private shim: Connection | null = null;

  private constructor(svm: LiteSVM, mainnet: Connection) {
    this.svm = svm;
    this.mainnet = mainnet;
  }

  /** Build the SVM, load every dumped protocol program (.so) + our program. */
  static create(mainnetRpc: string): LiteSvmFork {
    const svm = new LiteSVM()
      .withSplPrograms()
      .withSysvars()
      .withBuiltins()
      .withSigverify(false)
      .withBlockhashCheck(false);
    for (const f of readdirSync(FIX)) {
      if (!f.startsWith("program-") || !f.endsWith(".so")) continue;
      const id = f.slice("program-".length, -3);
      svm.addProgramFromFile(new PublicKey(id), join(FIX, f));
    }
    svm.addProgramFromFile(PROGRAM_ID, OUR_SO);
    return new LiteSvmFork(svm, new Connection(mainnetRpc, "confirmed"));
  }

  /**
   * Track the clock to mainnet's current slot with a small forward margin, so it
   * is always at or slightly ahead of every lazily-cloned account's last-update.
   * Accounts are fetched from mainnet throughout a test, so a fixed clock would
   * eventually sit BEHIND a freshly-fetched reserve and make time-based interest
   * math (Kamino refresh / Jupiter getExchangePrices) underflow. The margin also
   * covers the millisecond race between reading the slot and fetching accounts,
   * while staying well within the oracles' max staleness. Monotonic — the clock
   * only ever moves forward (mainnet slots increase; warpToSlot is forward-only).
   */
  async syncClock(marginSlots = 30, marginSeconds = 15): Promise<void> {
    const cur = await this.mainnet.getSlot("confirmed");
    const blockTime =
      (await this.mainnet.getBlockTime(cur)) ?? Math.floor(Date.now() / 1000);
    const slot = BigInt(cur + marginSlots);
    if (slot <= this.clockSlot) return; // never move backward
    const ts = BigInt(blockTime + marginSeconds);
    const epoch = slot / 432_000n;
    this.clockSlot = slot;
    this.svm.warpToSlot(slot);
    this.svm.setClock(new Clock(slot, ts, epoch, epoch, ts));
  }

  /** Lazily clone any of `keys` the SVM doesn't have yet from mainnet. */
  async ensure(keys: PublicKey[]): Promise<void> {
    const want = new Map<string, PublicKey>();
    for (const k of keys) {
      const s = k.toBase58();
      if (this.loaded.has(s)) continue;
      if (this.svm.getAccount(k)) {
        this.loaded.add(s);
        continue;
      }
      want.set(s, k);
    }
    const list = [...want.values()];
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const infos = await this.mainnet.getMultipleAccountsInfo(chunk, "confirmed");
      chunk.forEach((k, j) => {
        this.loaded.add(k.toBase58());
        const info = infos[j];
        if (!info) return; // created in-SVM by the flow (obligation, position, …)
        if (info.executable) return; // programs are addProgramFromFile'd
        this.svm.setAccount(k, {
          lamports: info.lamports,
          data: new Uint8Array(info.data),
          owner: info.owner,
          executable: false,
          rentEpoch: 0,
        });
      });
    }
  }

  /** Does an account exist on mainnet right now? (used to mirror setup ixs) */
  async existsOnMainnet(key: PublicKey): Promise<boolean> {
    return (await this.mainnet.getAccountInfo(key, "confirmed")) !== null;
  }

  /** Fabricate an SPL token account at `ata` holding `amount` of `mint`. */
  setTokenBalance(ata: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint) {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1, // initialized
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data
    );
    this.svm.setAccount(ata, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
      data: new Uint8Array(data),
      owner: TOKEN_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    });
    this.loaded.add(ata.toBase58());
  }

  tokenBalance(ata: PublicKey): bigint {
    const acc = this.svm.getAccount(ata);
    if (!acc) return 0n;
    return AccountLayout.decode(Buffer.from(acc.data)).amount;
  }

  /**
   * Fabricate an address lookup table account holding `addresses` (needed for the
   * ~69-account refinance, which can't fit as static keys). Building it directly
   * avoids the slot-hashes machinery a real createLookupTable transaction needs.
   */
  makeLookupTable(authority: PublicKey, addresses: PublicKey[]): AddressLookupTableAccount {
    const uniq = [...new Map(addresses.map((a) => [a.toBase58(), a])).values()];
    const lastExtendedSlot = this.clockSlot > 0n ? this.clockSlot - 1n : 0n;

    const meta = Buffer.alloc(56);
    meta.writeUInt32LE(1, 0); // ProgramState::LookupTable
    meta.writeBigUInt64LE(0xffffffffffffffffn, 4); // deactivation_slot = never
    meta.writeBigUInt64LE(lastExtendedSlot, 12);
    meta.writeUInt8(0, 20); // last_extended_slot_start_index
    meta.writeUInt8(1, 21); // Some(authority)
    authority.toBuffer().copy(meta, 22);
    meta.writeUInt16LE(0, 54); // padding
    const data = Buffer.concat([meta, ...uniq.map((a) => a.toBuffer())]);

    const key = Keypair.generate().publicKey;
    this.svm.setAccount(key, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data: new Uint8Array(data),
      owner: ALT_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    });
    this.loaded.add(key.toBase58());

    return new AddressLookupTableAccount({
      key,
      state: {
        deactivationSlot: 0xffffffffffffffffn,
        lastExtendedSlot: Number(lastExtendedSlot),
        lastExtendedSlotStartIndex: 0,
        authority,
        addresses: uniq,
      },
    });
  }

  /**
   * Ensure every account the instructions reference is present, then send a v0
   * transaction through LiteSVM. Returns the transaction metadata on success or
   * throws with the program logs on failure.
   */
  async send(
    payer: Keypair,
    ixs: TransactionInstruction[],
    opts: { lookupTables?: AddressLookupTableAccount[]; cuLimit?: number } = {}
  ): Promise<TransactionMetadata> {
    // Advance the clock to track mainnet, then lazily clone every referenced
    // account (their last-update is then <= the clock, so interest math is sound).
    await this.syncClock();
    const keys: PublicKey[] = [];
    for (const ix of ixs) {
      keys.push(ix.programId);
      for (const k of ix.keys) keys.push(k.pubkey);
    }
    await this.ensure(keys);

    const full = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cuLimit ?? 400_000 }),
      ...ixs,
    ];
    this.svm.expireBlockhash(); // fresh blockhash so repeated sends aren't deduped
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: this.svm.latestBlockhash(),
      instructions: full,
    }).compileToV0Message(opts.lookupTables ?? []);
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);

    const res = this.svm.sendTransaction(tx);
    if (res instanceof TransactionMetadata) return res;
    const meta: any = res;
    const logs: string[] = (meta.meta?.() ?? meta).logs?.() ?? [];
    const err = new Error(
      `LiteSVM transaction failed: ${meta.err?.() ?? "unknown"}\n  ${logs.slice(-20).join("\n  ")}`
    );
    (err as any).logs = logs;
    throw err;
  }

  /**
   * A web3.js Connection backed by the SVM (mainnet as fallback), so the Jupiter
   * Lend SDK reads the in-SVM position/vault state and simulates getExchangePrices
   * against LiteSVM — nothing is resolved from a live surfpool validator.
   */
  connection(): Connection {
    if (this.shim) return this.shim;
    const conn = new Connection(this.mainnet.rpcEndpoint, "confirmed");
    const self = this;
    const ctx = () => ({ slot: Number(self.clockSlot) });

    const toInfo = (acc: any) =>
      acc
        ? {
            data: Buffer.from(acc.data),
            executable: acc.executable,
            lamports: Number(acc.lamports),
            owner: acc.owner,
            rentEpoch: Number(acc.rentEpoch ?? 0),
          }
        : null;

    (conn as any).getAccountInfo = async (key: PublicKey) => {
      await self.ensure([key]);
      return toInfo(self.svm.getAccount(key));
    };
    (conn as any).getAccountInfoAndContext = async (key: PublicKey) => {
      await self.ensure([key]);
      return { context: ctx(), value: toInfo(self.svm.getAccount(key)) };
    };
    (conn as any).getMultipleAccountsInfo = async (keys: PublicKey[]) => {
      await self.ensure(keys);
      return keys.map((k) => toInfo(self.svm.getAccount(k)));
    };
    (conn as any).getSlot = async () => Number(self.clockSlot);
    (conn as any).getLatestBlockhash = async () => ({
      blockhash: self.svm.latestBlockhash(),
      lastValidBlockHeight: Number(self.clockSlot) + 150,
    });
    (conn as any).getMinimumBalanceForRentExemption = async (size: number) =>
      Number(self.svm.minimumBalanceForRentExemption(BigInt(size)));

    (conn as any).getTokenAccountBalance = async (key: PublicKey) => {
      await self.ensure([key]);
      const amount = self.tokenBalance(key);
      return {
        context: ctx(),
        value: {
          amount: amount.toString(),
          decimals: 0,
          uiAmount: null,
          uiAmountString: amount.toString(),
        },
      };
    };

    (conn as any).getAddressLookupTable = async (key: PublicKey) => {
      await self.ensure([key]);
      const acc = self.svm.getAccount(key);
      if (!acc) return { context: ctx(), value: null };
      return {
        context: ctx(),
        value: new AddressLookupTableAccount({
          key,
          state: AddressLookupTableAccount.deserialize(new Uint8Array(acc.data)),
        }),
      };
    };

    (conn as any).simulateTransaction = async (tx: any) => {
      // Ensure the (legacy) transaction's accounts, then simulate on the SVM.
      const keys: PublicKey[] = [];
      for (const ix of tx.instructions ?? []) {
        keys.push(ix.programId);
        for (const k of ix.keys) keys.push(k.pubkey);
      }
      if (tx.feePayer) keys.push(tx.feePayer);
      await self.ensure(keys);
      if (!tx.recentBlockhash) tx.recentBlockhash = self.svm.latestBlockhash();

      const info: any = self.svm.simulateTransaction(tx);
      const failed = info instanceof FailedTransactionMetadata;
      const m = info.meta();
      const logs: string[] = m.logs();
      const rd = m.returnData();
      const rdData: Uint8Array = rd.data();
      if (
        rdData.length &&
        !logs.some((l) => l.startsWith("Program return:"))
      ) {
        logs.push(
          `Program return: ${new PublicKey(rd.programId()).toBase58()} ${Buffer.from(
            rdData
          ).toString("base64")}`
        );
      }
      return {
        context: ctx(),
        value: {
          err: failed ? info.err() ?? "error" : null,
          logs,
          accounts: null,
          unitsConsumed: Number(m.computeUnitsConsumed()),
          returnData: rdData.length
            ? {
                data: [Buffer.from(rdData).toString("base64"), "base64"],
                programId: new PublicKey(rd.programId()).toBase58(),
              }
            : null,
        },
      };
    };

    this.shim = conn;
    return conn;
  }
}

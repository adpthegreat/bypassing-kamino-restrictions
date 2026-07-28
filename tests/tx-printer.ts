import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from "@solana/web3.js";

const useColor = process.env.NO_COLOR ? false : true;
const c = (code: string) => (s: string | number) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : `${s}`;
const dim = c("2");
const bold = c("1");
const red = c("31");
const green = c("32");
const yellow = c("33");
const blue = c("34");
const magenta = c("35");
const cyan = c("36");
const gray = c("90");

const PROGRAM_LABELS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: "Kamino Lend (KLend)",
  FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr: "Kamino Farms",
  jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi: "Jupiter Lend (Borrow)",
  Gr4ofKMU4AFW9hpR1dYxbVBHjvXDw9d6LYpCscTc3xMD: "Refinance Program (ours)",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Token Metadata",
  Sysvar1nstructions1111111111111111111111111: "Instructions Sysvar",
};

function label(programId: string): string {
  return PROGRAM_LABELS[programId] || "Unknown Program";
}

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
export interface LogNode {
  programId: string;
  depth: number; // 1 == top-level (stack height)
  children: LogNode[];
  consumed?: number;
  budget?: number;
  status?: "success" | "failed";
  messages: string[];
}

/**
 * Reconstruct the invoke tree from `Program <id> invoke [depth]` / `success` /
 * `consumed` log lines. Depth is the on-chain stack height — the exact value
 * the Instructions sysvar cannot see past when it is 1.
 */
export function buildCpiTreeFromLogs(logs: string[]): LogNode[] {
  const roots: LogNode[] = [];
  const stack: LogNode[] = [];

  const invokeRe = /^Program (\S+) invoke \[(\d+)\]$/;
  const successRe = /^Program (\S+) success$/;
  const failedRe = /^Program (\S+) failed/;
  const consumedRe = /^Program (\S+) consumed (\d+) of (\d+) compute units$/;

  for (const line of logs) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(invokeRe))) {
      const node: LogNode = {
        programId: m[1],
        depth: parseInt(m[2], 10),
        children: [],
        messages: [],
      };
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if ((m = line.match(consumedRe))) {
      const node = stack[stack.length - 1];
      if (node && node.programId === m[1]) {
        node.consumed = parseInt(m[2], 10);
        node.budget = parseInt(m[3], 10);
      }
    } else if ((m = line.match(successRe))) {
      const node = stack.pop();
      if (node) node.status = "success";
    } else if ((m = line.match(failedRe))) {
      const node = stack.pop();
      if (node) node.status = "failed";
    } else if (stack.length) {
      stack[stack.length - 1].messages.push(line.replace(/^Program (log|data): /, ""));
    }
  }
  return roots;
}

function renderCpiNode(node: LogNode, prefix: string, isLast: boolean): string[] {
  const out: string[] = [];
  const branch = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
  const name = label(node.programId);
  const statusIcon =
    node.status === "success" ? green("✓") : node.status === "failed" ? red("✗") : yellow("…");
  const depthTag =
    node.depth === 1 ? gray(`[height ${node.depth}]`) : magenta(`[height ${node.depth}]`);
  const cu =
    node.consumed !== undefined ? dim(` ${node.consumed.toLocaleString()} CU`) : "";
  out.push(
    `${gray(prefix + branch)}${statusIcon} ${bold(name)} ${depthTag} ${dim(short(node.programId))}${cu}`
  );
  const childPrefix = prefix + (prefix === "" ? "" : isLast ? "   " : "│  ");
  node.children.forEach((child, i) =>
    out.push(...renderCpiNode(child, childPrefix, i === node.children.length - 1))
  );
  return out;
}

export interface PrintableAccount {
  pubkey: string;
  signer: boolean;
  writable: boolean;
}
export interface PrintableIx {
  programId: string;
  accounts: string[];
  dataLen?: number;
  discriminant?: number | string;
}
export interface PrintableTx {
  title?: string;
  signature?: string;
  slot?: number;
  blockTime?: number | null;
  cluster?: string;
  err: any;
  fee?: number;
  computeUnits?: number;
  version?: number | "legacy";
  accounts?: PrintableAccount[];
  instructions?: PrintableIx[];
  logs?: string[];
  solDeltas?: { pubkey: string; delta: number }[];
  tokenDeltas?: {
    owner?: string;
    mint: string;
    delta: string;
    decimals: number;
  }[];
}

function hr(char = "─", width = 78): string {
  return gray(char.repeat(width));
}

export function printTransaction(tx: PrintableTx): void {
  const L: string[] = [];
  const ok = tx.err === null || tx.err === undefined;
  L.push("");
  L.push(hr("━"));
  L.push(
    `${bold(cyan("  SOLSCAN"))}${dim("-in-terminal")}  ${tx.title ? bold(tx.title) : ""}`
  );
  L.push(hr("━"));

  // Header
  const statusText = ok ? green("● SUCCESS") : red("● FAILED");
  L.push(`  ${bold("Status")}   ${statusText}${ok ? "" : "  " + red(JSON.stringify(tx.err))}`);
  if (tx.signature)
    L.push(`  ${bold("Signature")}  ${yellow(tx.signature)}`);
  if (tx.cluster) L.push(`  ${bold("Cluster")}  ${tx.cluster}`);
  const meta: string[] = [];
  if (tx.slot !== undefined) meta.push(`slot ${tx.slot.toLocaleString()}`);
  if (tx.blockTime) meta.push(new Date(tx.blockTime * 1000).toISOString());
  if (tx.version !== undefined) meta.push(`v:${tx.version}`);
  if (meta.length) L.push(`  ${bold("Meta")}     ${dim(meta.join("  •  "))}`);
  const cost: string[] = [];
  if (tx.fee !== undefined) cost.push(`fee ${(tx.fee / 1e9).toFixed(9)} SOL`);
  if (tx.computeUnits !== undefined)
    cost.push(`compute ${tx.computeUnits.toLocaleString()} CU`);
  if (cost.length) L.push(`  ${bold("Cost")}     ${dim(cost.join("  •  "))}`);

  // Accounts
  if (tx.accounts?.length) {
    L.push("");
    L.push(`  ${bold("Accounts")} ${dim(`(${tx.accounts.length})`)}`);
    tx.accounts.forEach((a, i) => {
      const roles = [
        a.signer ? green("signer") : "      ",
        a.writable ? yellow("writable") : dim("readonly"),
      ].join(" ");
      L.push(
        `    ${dim(String(i).padStart(2))}  ${roles}  ${a.pubkey}  ${dim(label(a.pubkey) !== "Unknown Program" ? label(a.pubkey) : "")}`
      );
    });
  }

  // Instructions
  if (tx.instructions?.length) {
    L.push("");
    L.push(`  ${bold("Instructions")} ${dim(`(${tx.instructions.length} top-level)`)}`);
    tx.instructions.forEach((ix, i) => {
      const disc =
        ix.discriminant !== undefined ? magenta(` disc=${ix.discriminant}`) : "";
      const dl = ix.dataLen !== undefined ? dim(` ${ix.dataLen}B`) : "";
      L.push(
        `    ${bold(`#${i + 1}`)} ${bold(label(ix.programId))} ${dim(short(ix.programId))}${disc}${dl} ${dim(`${ix.accounts.length} accts`)}`
      );
    });
  }

  // CPI tree (the money shot)
  if (tx.logs?.length) {
    const tree = buildCpiTreeFromLogs(tx.logs);
    if (tree.length) {
      L.push("");
      L.push(`  ${bold("CPI / stack-height tree")}`);
      L.push(
        `    ${dim("height 1 = top-level (visible to Instructions sysvar) · height ≥2 = inside a CPI")}`
      );
      tree.forEach((root, i) =>
        renderCpiNode(root, "    ", i === tree.length - 1).forEach((l) => L.push(l))
      );
    }
  }

  // SOL deltas
  if (tx.solDeltas?.length) {
    const nz = tx.solDeltas.filter((d) => d.delta !== 0);
    if (nz.length) {
      L.push("");
      L.push(`  ${bold("SOL balance changes")}`);
      nz.forEach((d) => {
        const s = (d.delta / 1e9).toFixed(9);
        L.push(
          `    ${d.pubkey}  ${d.delta > 0 ? green("+" + s) : red(s)} SOL`
        );
      });
    }
  }

  // Token deltas
  if (tx.tokenDeltas?.length) {
    const nz = tx.tokenDeltas.filter((d) => d.delta !== "0" && d.delta !== "");
    if (nz.length) {
      L.push("");
      L.push(`  ${bold("Token balance changes")}`);
      nz.forEach((d) => {
        const pos = !d.delta.startsWith("-");
        const ui = Number(d.delta) / 10 ** d.decimals;
        L.push(
          `    owner ${short(d.owner || "?")}  mint ${short(d.mint)}  ${pos ? green("+" + ui) : red(String(ui))}`
        );
      });
    }
  }

  L.push(hr("━"));
  L.push("");
  console.log(L.join("\n"));
}

/** Fetch a confirmed transaction by signature and print it. */
export async function printFetchedTransaction(
  connection: Connection,
  signature: string,
  title?: string
): Promise<void> {
  const resp = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!resp) {
    console.log(red(`Transaction ${signature} not found`));
    return;
  }
  printTransaction(fromResponse(resp, signature, title, connection.rpcEndpoint));
}

/** Convert a web3.js VersionedTransactionResponse into the printable shape. */
export function fromResponse(
  resp: VersionedTransactionResponse,
  signature?: string,
  title?: string,
  cluster?: string
): PrintableTx {
  const msg = resp.transaction.message;
  const keys = msg.getAccountKeys({
    accountKeysFromLookups: resp.meta?.loadedAddresses,
  });
  const staticLen = msg.staticAccountKeys.length;

  const accounts: PrintableAccount[] = [];
  const total = keys.length;
  for (let i = 0; i < total; i++) {
    const pk = keys.get(i)!;
    accounts.push({
      pubkey: pk.toBase58(),
      signer: i < staticLen ? msg.isAccountSigner(i) : false,
      writable: msg.isAccountWritable(i),
    });
  }

  const instructions: PrintableIx[] = msg.compiledInstructions.map((ix) => {
    const programId = keys.get(ix.programIdIndex)!.toBase58();
    return {
      programId,
      accounts: ix.accountKeyIndexes.map((idx) => keys.get(idx)!.toBase58()),
      dataLen: ix.data.length,
      discriminant: ix.data.length ? ix.data[0] : undefined,
    };
  });

  const pre = resp.meta?.preBalances ?? [];
  const post = resp.meta?.postBalances ?? [];
  const solDeltas = pre.map((p, i) => ({
    pubkey: accounts[i]?.pubkey ?? String(i),
    delta: (post[i] ?? p) - p,
  }));

  const tokenDeltas = diffTokenBalances(
    resp.meta?.preTokenBalances ?? [],
    resp.meta?.postTokenBalances ?? [],
    accounts
  );

  return {
    title,
    signature,
    cluster,
    slot: resp.slot,
    blockTime: resp.blockTime,
    err: resp.meta?.err ?? null,
    fee: resp.meta?.fee,
    computeUnits: resp.meta?.computeUnitsConsumed,
    version: (resp as any).version,
    accounts,
    instructions,
    logs: resp.meta?.logMessages ?? undefined,
    solDeltas,
    tokenDeltas,
  };
}

function diffTokenBalances(
  pre: any[],
  post: any[],
  accounts: PrintableAccount[]
): PrintableTx["tokenDeltas"] {
  const key = (b: any) => `${b.accountIndex}:${b.mint}`;
  const preMap = new Map(pre.map((b) => [key(b), b]));
  const out: NonNullable<PrintableTx["tokenDeltas"]> = [];
  const seen = new Set<string>();
  for (const b of post) {
    seen.add(key(b));
    const before = preMap.get(key(b));
    const beforeAmt = BigInt(before?.uiTokenAmount.amount ?? "0");
    const afterAmt = BigInt(b.uiTokenAmount.amount);
    const delta = afterAmt - beforeAmt;
    if (delta !== 0n)
      out.push({
        owner: b.owner,
        mint: b.mint,
        delta: delta.toString(),
        decimals: b.uiTokenAmount.decimals,
      });
  }
  for (const b of pre) {
    if (seen.has(key(b))) continue;
    const delta = -BigInt(b.uiTokenAmount.amount);
    if (delta !== 0n)
      out.push({
        owner: b.owner,
        mint: b.mint,
        delta: delta.toString(),
        decimals: b.uiTokenAmount.decimals,
      });
  }
  return out;
}

/**
 * Print from a LiteSVM execution result. LiteSVM exposes logs + CU but not
 * structured inner instructions, so we lean on the log-derived CPI tree.
 */
export function printLiteSVMResult(opts: {
  title?: string;
  signature?: string;
  err: any;
  logs: string[];
  computeUnits?: number;
  instructions?: PrintableIx[];
  accounts?: PrintableAccount[];
}): void {
  printTransaction({
    title: opts.title,
    signature: opts.signature,
    cluster: "LiteSVM (in-process)",
    err: opts.err,
    computeUnits: opts.computeUnits,
    logs: opts.logs,
    instructions: opts.instructions,
    accounts: opts.accounts,
  });
}

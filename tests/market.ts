import { Connection, PublicKey } from "@solana/web3.js";
import {
  KaminoMarket,
  KaminoReserve,
  DEFAULT_RECENT_SLOT_DURATION_MS,
} from "@kamino-finance/klend-sdk";
import { K_LEND_PROGRAM_ID, MAINNET_RPC_URL } from "./constants";

const JUP_LEND_BASE =
  process.env.JUP_LEND_API || "https://lite-api.jup.ag/lend/v1";
const KAMINO_BASE = process.env.KAMINO_API || "https://api.kamino.finance";

async function getJSON<T>(url: string, attempts = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}


export interface ReserveAccounts {
  reserve: PublicKey;
  liquidityMint: PublicKey; // the token
  liquiditySupplyVault: PublicKey;
  feeVault: PublicKey;
  collateralMint: PublicKey; // cToken mint
  collateralSupplyVault: PublicKey;
  collateralFarm: PublicKey;
  debtFarm: PublicKey;
  scopeOracle: PublicKey; // scope prices account this reserve refreshes against
}

export interface PairContext {
  collateralSymbol: string;
  debtSymbol: string;
  collateralMint: PublicKey;
  debtMint: PublicKey;

  // Kamino
  market: PublicKey;
  marketAuthority: PublicKey;
  collateral: ReserveAccounts;
  debt: ReserveAccounts;

  // Jupiter Lend
  jupiterVaultId: number;
  jupiterMarket: "main" | "ethena";
  // price-sensitive accounts to keep live on a fork so quotes don't go stale
  streamAccounts: PublicKey[];
}


function reserveAccounts(r: KaminoReserve): ReserveAccounts {
  const s = r.state as any;
  return {
    reserve: r.address,
    liquidityMint: s.liquidity.mintPubkey,
    liquiditySupplyVault: s.liquidity.supplyVault,
    feeVault: s.liquidity.feeVault,
    collateralMint: s.collateral.mintPubkey,
    collateralSupplyVault: s.collateral.supplyVault,
    collateralFarm: s.farmCollateral,
    debtFarm: s.farmDebt,
    scopeOracle: s.config.tokenInfo.scopeConfiguration.priceFeed,
  };
}

export async function loadKaminoPair(
  connection: Connection,
  market: PublicKey,
  collateralMint: PublicKey,
  debtMint: PublicKey
): Promise<{
  marketAuthority: PublicKey;
  collateral: ReserveAccounts;
  debt: ReserveAccounts;
}> {
  const km = await KaminoMarket.load(
    connection,
    market,
    DEFAULT_RECENT_SLOT_DURATION_MS,
    K_LEND_PROGRAM_ID,
    true
  );
  if (!km) throw new Error(`Kamino market ${market.toBase58()} not found`);
  const c = km.getReserveByMint(collateralMint);
  const d = km.getReserveByMint(debtMint);
  if (!c) throw new Error(`no Kamino reserve for collateral ${collateralMint.toBase58()} in ${market.toBase58()}`);
  if (!d) throw new Error(`no Kamino reserve for debt ${debtMint.toBase58()} in ${market.toBase58()}`);
  return {
    marketAuthority: km.getLendingMarketAuthority(),
    collateral: reserveAccounts(c),
    debt: reserveAccounts(d),
  };
}

interface JupBorrowVault {
  id: number;
  supplyToken: { address: string; symbol: string };
  borrowToken: { address: string; symbol: string };
  oracle: string;
  oracleSources?: { source: string }[];
}

async function resolveJupiterVault(
  collateralSymbol: string,
  debtSymbol: string
): Promise<{ vaultId: number; collateralMint: string; debtMint: string; streamAccounts: string[] }> {
  const vaults = await getJSON<JupBorrowVault[]>(`${JUP_LEND_BASE}/borrow/vaults`);
  const v = vaults.find(
    (x) =>
      x.supplyToken.symbol.toUpperCase() === collateralSymbol.toUpperCase() &&
      x.borrowToken.symbol.toUpperCase() === debtSymbol.toUpperCase()
  );
  if (!v)
    throw new Error(
      `no Jupiter Lend borrow vault for ${collateralSymbol}/${debtSymbol}`
    );
  const streamAccounts = [v.oracle, ...(v.oracleSources || []).map((s) => s.source)];
  return {
    vaultId: v.id,
    collateralMint: v.supplyToken.address,
    debtMint: v.borrowToken.address,
    streamAccounts,
  };
}

/** Find the Kamino market that holds both mints, preferring the isolated one. */
async function findKaminoMarket(
  collateralMint: string,
  debtMint: string,
  collateralSymbol: string
): Promise<PublicKey> {
  const markets = await getJSON<any[]>(`${KAMINO_BASE}/v2/kamino-market`);
  const pk = (m: any): string => m.lendingMarket || m.pubkey || m.address;
  // fetch every market's reserves in parallel, then pick a market holding both
  // mints — preferring an isolated market whose name mentions the collateral.
  const holds = await Promise.all(
    markets.map(async (m) => {
      const reserves = await getJSON<any[]>(
        `${KAMINO_BASE}/kamino-market/${pk(m)}/reserves/metrics`
      ).catch(() => [] as any[]);
      const mints = new Set(reserves.map((r) => r.liquidityTokenMint));
      return { m, ok: mints.has(collateralMint) && mints.has(debtMint) };
    })
  );
  const matches = holds.filter((h) => h.ok).map((h) => h.m);
  if (matches.length === 0)
    throw new Error(`no Kamino market holds both ${collateralSymbol} and the debt asset`);
  const named = matches.find((m) =>
    (m.name || "").toUpperCase().includes(collateralSymbol.toUpperCase())
  );
  return new PublicKey(pk(named || matches[0]));
}

/**
 * Resolve a full PairContext from just two symbols. Everything is fetched JIT.
 *
 * The Kamino load runs against mainnet (a fork can't serve a market-wide reserve
 * load, and the resolved pubkeys are network-agnostic — they clone into the fork
 * when the tests touch them). Pass `resolveConnection` to override the RPC used
 * for discovery.
 */
export async function getRefinancePair(opts: {
  collateralSymbol: string;
  debtSymbol: string;
  resolveConnection?: Connection;
}): Promise<PairContext> {
  const connection =
    opts.resolveConnection || new Connection(MAINNET_RPC_URL, "confirmed");
  const jup = await resolveJupiterVault(opts.collateralSymbol, opts.debtSymbol);
  const market = await findKaminoMarket(
    jup.collateralMint,
    jup.debtMint,
    opts.collateralSymbol
  );
  const collateralMint = new PublicKey(jup.collateralMint);
  const debtMint = new PublicKey(jup.debtMint);
  const kamino = await loadKaminoPair(connection, market, collateralMint, debtMint);

  return {
    collateralSymbol: opts.collateralSymbol,
    debtSymbol: opts.debtSymbol,
    collateralMint,
    debtMint,
    market,
    marketAuthority: kamino.marketAuthority,
    collateral: kamino.collateral,
    debt: kamino.debt,
    jupiterVaultId: jup.vaultId,
    jupiterMarket: "main",
    streamAccounts: [
      ...jup.streamAccounts.map((s) => new PublicKey(s)),
      kamino.collateral.scopeOracle,
      kamino.debt.scopeOracle,
    ],
  };
}

const JUP_LEND_BASE =
  process.env.JUP_LEND_API || "https://lite-api.jup.ag/lend/v1";
const KAMINO_BASE = process.env.KAMINO_API || "https://api.kamino.finance";

// Treat a reserve/vault as "fully utilized" at/above this utilization.
const FULL_UTILIZATION_THRESHOLD = 0.99;


interface JupToken {
  address: string;
  symbol: string;
  decimals: number;
  price?: string;
}
interface JupBorrowVault {
  id: number;
  address: string;
  supplyToken: JupToken; // collateral
  borrowToken: JupToken; // debt
  totalSupply: string; // collateral supplied (collateral units)
  totalBorrow: string; // debt borrowed (debt units)
  // Borrow-side liquidity (all in DEBT token units):
  borrowLimit: string; // max total debt the vault will lend
  borrowable: string; // free debt that can still be borrowed right now
  minimumBorrowing: string; // dust floor
  // Collateral-side liquidity (collateral token units):
  withdrawable: string; // collateral that can still be withdrawn
}
interface KaminoReserveMetrics {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  borrowApy: number | string;
  supplyApy: number | string;
  totalSupply: number | string;
  totalBorrow: number | string;
  totalSupplyUsd: number | string;
  totalBorrowUsd: number | string;
}


async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function getJupiterBorrowVaults(): Promise<JupBorrowVault[]> {
  return getJSON<JupBorrowVault[]>(`${JUP_LEND_BASE}/borrow/vaults`);
}

/** Discover the primary Kamino lending market pubkey. */
export async function getKaminoPrimaryMarket(): Promise<string> {
  const markets = await getJSON<any[]>(`${KAMINO_BASE}/v2/kamino-market`);
  const primary =
    markets.find((m) => m.isPrimary) ?? markets.find((m) => m.isCurated) ?? markets[0];
  const pk = primary?.lendingMarket ?? primary?.pubkey ?? primary?.address;
  if (!pk) throw new Error("could not resolve a Kamino market pubkey");
  return typeof pk === "string" ? pk : pk.toString();
}

export async function getKaminoReserves(
  market: string
): Promise<KaminoReserveMetrics[]> {
  return getJSON<KaminoReserveMetrics[]>(
    `${KAMINO_BASE}/kamino-market/${market}/reserves/metrics`
  );
}

function num(x: number | string | undefined): number {
  const n = typeof x === "string" ? parseFloat(x) : x ?? 0;
  return Number.isFinite(n) ? n : 0;
}

interface UtilInfo {
  utilization: number; // borrow / supply, 0..1
  freeLiquidity: number; // supply - borrow (raw)
  fullyUtilized: boolean;
}

// Jupiter DEBT-side utilization: how full is the borrow cap for the debt token.
// (totalSupply is collateral, totalBorrow is debt — different tokens — so we use
//  the vault's own borrow-cap fields, all denominated in the debt token.)
function jupVaultDebtUtil(v: JupBorrowVault): UtilInfo {
  const limit = num(v.borrowLimit);
  const borrowed = num(v.totalBorrow);
  const borrowable = num(v.borrowable);
  const minBorrow = num(v.minimumBorrowing);
  const utilization = limit > 0 ? borrowed / limit : 1;
  return {
    utilization,
    freeLiquidity: borrowable,
    fullyUtilized: borrowable <= minBorrow,
  };
}

function kaminoReserveUtil(r: KaminoReserveMetrics): UtilInfo {
  const supply = num(r.totalSupply);
  const borrow = num(r.totalBorrow);
  const utilization = supply > 0 ? borrow / supply : 1;
  return {
    utilization,
    freeLiquidity: supply - borrow,
    fullyUtilized: utilization >= FULL_UTILIZATION_THRESHOLD,
  };
}

export interface RefinanceableMarket {
  collateralMint: string;
  debtMint: string;
  collateralSymbol: string;
  debtSymbol: string;
  jupiter: {
    vault: string;
    debtUtilization: number;
    debtFullyUtilized: boolean;
  };
  kamino: {
    collateralReserve: string;
    debtReserve: string;
    debtUtilization: number;
    debtFullyUtilized: boolean;
  };
  // A refinance can only complete if the DESTINATION debt reserve has liquidity.
  canRefinanceKaminoToJupiter: boolean; // needs Jupiter debt free
  canRefinanceJupiterToKamino: boolean; // needs Kamino debt free
}

export async function findRefinanceableMarkets(): Promise<RefinanceableMarket[]> {
  const [jupVaults, market] = await Promise.all([
    getJupiterBorrowVaults(),
    getKaminoPrimaryMarket(),
  ]);
  const kaminoReserves = await getKaminoReserves(market);

  const kaminoByMint = new Map<string, KaminoReserveMetrics>();
  for (const r of kaminoReserves) kaminoByMint.set(r.liquidityTokenMint, r);

  const out: RefinanceableMarket[] = [];
  for (const v of jupVaults) {
    const cMint = v.supplyToken.address;
    const dMint = v.borrowToken.address;
    const kC = kaminoByMint.get(cMint);
    const kD = kaminoByMint.get(dMint);
    if (!kC || !kD) continue; // both legs must exist on Kamino too

    const jUtil = jupVaultDebtUtil(v);
    const kUtil = kaminoReserveUtil(kD);

    out.push({
      collateralMint: cMint,
      debtMint: dMint,
      collateralSymbol: v.supplyToken.symbol,
      debtSymbol: v.borrowToken.symbol,
      jupiter: {
        vault: v.address,
        debtUtilization: jUtil.utilization,
        debtFullyUtilized: jUtil.fullyUtilized,
      },
      kamino: {
        collateralReserve: kC.reserve,
        debtReserve: kD.reserve,
        debtUtilization: kUtil.utilization,
        debtFullyUtilized: kUtil.fullyUtilized,
      },
      canRefinanceKaminoToJupiter: !jUtil.fullyUtilized,
      canRefinanceJupiterToKamino: !kUtil.fullyUtilized,
    });
  }
  return out;
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

async function main() {
  console.log("Fetching Jupiter Lend borrow vaults + Kamino reserves…\n");
  const markets = await findRefinanceableMarkets();
  if (!markets.length) {
    console.log("No overlapping (collateral, debt) pairs found on both venues.");
    return;
  }
  console.log(
    `Found ${markets.length} refinanceable pair(s) present on BOTH Jupiter Lend and Kamino:\n`
  );
  const header = [
    "PAIR (collat/debt)".padEnd(22),
    "JUP debt util".padEnd(14),
    "KAM debt util".padEnd(14),
    "→JUP".padEnd(6),
    "→KAM".padEnd(6),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const m of markets) {
    const pair = `${m.collateralSymbol}/${m.debtSymbol}`.padEnd(22);
    const ju = (pct(m.jupiter.debtUtilization) + (m.jupiter.debtFullyUtilized ? " FULL" : "")).padEnd(14);
    const ku = (pct(m.kamino.debtUtilization) + (m.kamino.debtFullyUtilized ? " FULL" : "")).padEnd(14);
    const toJup = (m.canRefinanceKaminoToJupiter ? "✓" : "✗").padEnd(6);
    const toKam = (m.canRefinanceJupiterToKamino ? "✓" : "✗").padEnd(6);
    console.log([pair, ju, ku, toJup, toKam].join(" "));
  }
  console.log(
    "\n→JUP = Kamino→Jupiter refinance possible (Jupiter debt has liquidity)"
  );
  console.log(
    "→KAM = Jupiter→Kamino refinance possible (Kamino debt has liquidity)"
  );
  console.log(`\n(“FULL” = utilization ≥ ${pct(FULL_UTILIZATION_THRESHOLD)}, borrow leg would revert)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

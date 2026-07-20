// ESM bridge for @jup-ag/lend
//
// @jup-ag/lend ships as an ES Module (.mjs) but our TypeScript tests compile
// to CommonJS. Node.js does not allow require() of an ES Module, so we bridge
// via dynamic import() inside this .js file and cache the result.

let cachedModule = null;
let cachedBorrowModule = null;
let cachedFlashloanModule = null;

export async function getJupLend() {
  if (!cachedModule) cachedModule = await import("@jup-ag/lend");
  return cachedModule;
}

export async function getJupLendBorrow() {
  if (!cachedBorrowModule) cachedBorrowModule = await import("@jup-ag/lend/borrow");
  return cachedBorrowModule;
}

export async function getJupLendFlashloan() {
  if (!cachedFlashloanModule)
    cachedFlashloanModule = await import("@jup-ag/lend/flashloan");
  return cachedFlashloanModule;
}

let cachedRefinanceModule = null;
export async function getJupLendRefinance() {
  if (!cachedRefinanceModule)
    cachedRefinanceModule = await import("@jup-ag/lend/refinance");
  return cachedRefinanceModule;
}

# Tests & tooling

Everything for exercising the Kamino ⇄ Jupiter Lend refinance program and
demonstrating how it bypasses Kamino's anti-refinance restriction.

---

## The concept in one paragraph

Kamino's `RepayObligationLiquidityV2` handler enforces
`ix_utils::no_restricted_programs_within_tx(instruction_sysvar)`, which walks
**every top-level instruction** in the transaction (via the Instructions sysvar,
which only holds top-level instructions) and reverts with
`TransactionIncludesRestrictedPrograms` (error `6134` / `0x17f6`) if any
`program_id` is in `RESTRICTED_PROGRAMS = [jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi]`
— **Jupiter Lend's borrow program**. So you cannot repay a Kamino loan and touch
Jupiter Lend as top-level siblings in one transaction. Our program gets around
this by performing **both** the Kamino repay/withdraw **and** the Jupiter
deposit/borrow inside its own CPI (stack height 2), where the top-level-only
sysvar scan can't see `jupr81`. Source: `Kamino-Finance/klend@c060019`
(`handler_repay_obligation_liquidity.rs:152`,
`lending_market/ix_utils.rs`, `utils/consts.rs:253`).

> Subtlety worth knowing: the Jupiter SDK's operate/refinance instruction targets
> `jup8Qcdt…` (a *router* that CPIs `jupr81`), so using that ix keeps `jupr81`
> nested and does **not** trip the guard. To reproduce the block you must place
> `jupr81` **itself** at the top level (see `probe-toplevel-block.ts`).

---

## `tests/` — library modules & test suites

### Core helpers (imported by everything)

| File | What it does |
|------|--------------|
| **`constants.ts`** | All addresses and magic numbers: program id (env-overridable via `PROGRAM_ID`), instruction discriminants (`DISC`), Kamino/Jupiter program ids, the JLP/USDC market — reserves, vaults, collateral mints, fee vaults, scope oracles — plus `U64_MAX`, `MIN_I128`, test amounts, and RPC URLs. |
| **`utils.ts`** | The reusable toolbox: Surfpool `surfnet_*` cheatcodes (`surfnetAirdrop`, `surfnetTokenAirdrop`, `surfnetStreamAccount`), a v0 transaction sender with compute budget + ALT support (`sendV0Tx`), Kamino PDA derivations (`obligationAccount`, `userMetadataAccount`, `obligationFarmStatePda`), the reserve→farm byte parser (`getReserveFarms`), ATA helper (`getAtaAddress`), the address-lookup-table builder (`createLookupTable`), and little-endian byte packers (`u8/u16/u32/u64/meta`). |
| **`jup_lend_loader.js`** | ESM→CJS bridge for `@jup-ag/lend` (the SDK ships ESM only; the tests compile to CommonJS). Exposes `getJupLendBorrow()`, `getJupLendFlashloan()`, `getJupLendRefinance()` via cached dynamic `import()`. |

### Instruction / account assembly

| File | What it does |
|------|--------------|
| **`program-instructions.ts`** | `TransactionInstruction` builders for the program's **non-refinance** entrypoints (discriminants 0–7): `initKaminoIx`, `depositKaminoIx`, `borrowKaminoIx`, `depositAndBorrowJuplendIx`, `initJupiterIx`. Account orders mirror the Rust account structs in `program/src/protocols/{kamino,juplend}/actions.rs` exactly. |
| **`refinance-helpers.ts`** | The refinance instruction itself (discriminants 10/11). `buildJupiterOperateAccounts()` maps the Jupiter SDK's `accounts` object into the program's 36-slot fixed order (substituting the program-id placeholder for null claim accounts), `buildKaminoBlock()` builds the unified Kamino account block in `refinance.rs` order (starting with the KLend program id — the boundary marker the program scans for), and `buildRefinanceIx()` concatenates `[Jupiter operate][Jupiter remaining][Kamino block]` and encodes the data. |
| **`bootstrap.ts`** | The orchestration layer shared by tests and probes. `createCtx()` (payer + derived PDAs/ATAs), `prepare()` (stream oracles + Jupiter accounts, fund payer, resolve farms), position openers (`openKaminoLoan`, `initKaminoObligation`, `openJupiterPosition`, `openJupiterLoan`, `nextJupiterPositionId`), and both refinance directions (`refinanceKaminoToJupiter`, `refinanceJupiterToKamino`). `refinanceKaminoToJupiter` also takes `{ topLevelJupiter }` to build the **control** (a bare top-level `jupr81` ix) used by the bypass demo. |

### The Solscan printer

| File | What it does |
|------|--------------|
| **`tx-printer.ts`** | Solscan-in-the-terminal. Renders a transaction's status, fee/compute, the account table (signer/writable roles + program labels), the instruction list, SOL/token deltas, and — the centerpiece — the **CPI / stack-height tree** parsed from program logs (`Program … invoke [N]`). The stack-height tree is what makes the bypass visible: our program at height 1, Kamino + Jupiter at height 2. Works from a fetched tx (`printFetchedTransaction`/`fromResponse`), a LiteSVM result (`printLiteSVMResult`), or any log set (`buildCpiTreeFromLogs`). No explorer/RPC-stream dependency. |

### Test suites (mocha)

| File | What it does |
|------|--------------|
| **`refinance-kamino-to-jup.ts`** | Surfpool integration test — opens a real JLP/USDC loan on mainnet-forked Kamino, opens a destination Jupiter Lend position, migrates the whole position through our program, asserts success, and prints the tx. **Passes.** |
| **`refinance-jup-to-kamino.ts`** | The mirror — opens a Jupiter Lend loan, migrates it to Kamino. **Passes.** |
| **`litesvm-refinance.ts`** | Deterministic LiteSVM test. Loads the dumped mainnet fixtures + the KLend program into an in-process SVM, aligns the clock so scope prices aren't stale, executes a real Kamino `RefreshReserve`, and prints it. Reproducible every run (no fork drift). **Passes.** LiteSVM has no lazy cloning, so the full cross-protocol refinance is exercised on surfpool instead; this proves the dump-fixtures → LiteSVM → printer pipeline on a self-contained Kamino instruction. |

### Standalone tools

| File | What it does |
|------|--------------|
| **`fetch-refinanceable-markets.ts`** | Pure-REST, client-side. Pulls Jupiter Lend borrow vaults (`lite-api.jup.ag/lend/v1/borrow/vaults`) + Kamino reserve metrics (`api.kamino.finance`), cross-references by mint, and reports every token pair refinanceable on both venues with per-leg utilization, flagging fully-utilized (no free liquidity) legs in each direction. Run: `npm run fetch-markets`. |
| **`flashloan-bypass-demo.ts`** | Runs the same economic operation two ways and prints both: **BYPASS** (Jupiter nested in our CPI → allowed) vs **CONTROL** (a bare top-level `jupr81` added → the Kamino repay's scan rejects with `TransactionIncludesRestrictedPrograms`). Run: `npm run flashloan-demo` (needs surfpool). |

---

## `tests/fixtures/` — dumped mainnet state (for LiteSVM)

Produced by `npm run dump-fixtures`. Deterministic inputs so LiteSVM reproduces
the same execution every run.

| File | What it is |
|------|-----------|
| `manifest.json` | Dump metadata: source RPC, slot, blockTime, and the account name→pubkey map. Read first by the LiteSVM test to align the clock. |
| `jlp_reserve.json` | The Kamino JLP reserve account (base64 data + lamports/owner/executable). |
| `jlp_lending_market.json` | The JLP/USDC lending market account. |
| `scope_oracle.json` | The Kamino scope price feed the JLP reserve refreshes against. |
| `klend.so` | The on-chain KLend program binary (`solana program dump`), loaded into LiteSVM so the `RefreshReserve` CPI can run. ~10 MB. |

> These are gitignored-by-size in spirit but currently committed; regenerate with
> `npm run dump-fixtures` (or `RPC=http://127.0.0.1:8899 npm run dump-fixtures`
> to pull from a running surfpool).

---

## `scripts/` — probes & CLIs

| File | What it does |
|------|--------------|
| **`print-tx.ts`** | `npm run print-tx <signature> [rpcUrl]` — fetch any transaction from any cluster and dump it Solscan-style. Defaults to mainnet. |
| **`dump-fixtures.ts`** | `npm run dump-fixtures` — writes `tests/fixtures/` (accounts as base64 JSON + `klend.so` + manifest). |
| **`probe-kamino-open.ts`** | Fast iteration probe: opens a Kamino JLP/USDC loan step by step and prints the result. Validates the INIT/DEPOSIT/BORROW account wiring against live mainnet-forked Kamino. |
| **`probe-refinance-k2j.ts`** | Full Kamino→Jupiter refinance probe (the non-mocha version of the k2j test, with verbose step logging). |
| **`probe-refinance-j2k.ts`** | Full Jupiter→Kamino refinance probe. |
| **`probe-toplevel-block.ts`** | **The root-cause experiment.** Builds the naive one-call refinance shape — a **top-level** KLend repay next to a **bare top-level `jupr81`** — and simulates it. Confirms the restriction fires (`TransactionIncludesRestrictedPrograms`), proving the guard is enforced locally and that the bypass depends entirely on keeping `jupr81` out of the top level. |

---

## Running things

### Prereqs

```bash
npm install                 # web3.js, @jup-ag/lend, @kamino-finance/klend-sdk, litesvm, …
npm run build:program       # builds target/deploy/kamino_juplend_refinance.so
```

Surfpool **≥ 1.4** is required for the `surfnet_*` cheatcodes (the 0.1.x homebrew
build lacks them). A v1.5.0 binary is vendored at `./bin/surfpool`.

### Surfpool refinance tests (both directions pass)

Surfpool auto-deploys the program from `runbooks/deployment` on startup, and the
tests resolve the deployed program id + default to the local RPC on their own —
**no keygen, no manual deploy, no env vars.**

```bash
./bin/surfpool start &          # mainnet fork + cheatcodes + auto-deploy + Studio :18488
npm run test:kamino-to-jup
npm run test:jup-to-kamino
```

- Add `--rpc-url <your-RPC>` to avoid the public endpoint rate-limiting the fork.
- `constants.ts` reads the deployed id from `target/deploy/kamino_juplend_refinance-keypair.json`; override with `PROGRAM_ID=<addr>` only if you deploy elsewhere.
- State drifts across many runs (lazy fork); each test uses a fresh
  payer/obligation/position, so a clean session is deterministic — just restart
  surfpool (it re-deploys) if a run fails after many prior runs.
- View any signature at **http://127.0.0.1:18488** (Studio explorer).

### Deterministic LiteSVM test

```bash
npm run dump-fixtures       # populates tests/fixtures/
npm run test:litesvm
```

### Standalone

```bash
npm run fetch-markets                       # refinanceable pairs + utilization
npm run print-tx <signature> [rpcUrl]       # solscan-style dump of any tx
npm run flashloan-demo                       # bypass vs control (needs surfpool)
npx tsx scripts/probe-toplevel-block.ts      # prove the restriction fires
```

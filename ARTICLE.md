# Bypassing Kamino Finance Restricted Programs 

This article assumes the reader has a basic understanding of solana architecture and the anchor framework

Back in september 2025 jupiter launched their own lending protocol called jupiter lend in partnership with fluid, basically a solana rewrite of fluid lend, some weeks later, they introduced a feature called "jupiter refinance" which allowed you to one click migrate/refinance your loans from other lending protocols eg marginfi, kamino, including multiply positions, to jupiter lend, with the value proposition of having higher LTVs and APYs on your loans due to their better architecture and tick based liquidation design.

The refinance flow involved atomically repaying your loan using the zero fee flashloans from jupiter lend , withdrawing your collateral from the old lending venue (kamino finance in this example) then creating a new lending position in jupiter lend by depositing the same collateral, then borrowing the same asset.

But where it gets interesting is the steps/actions kamino took against it, basically hardcoding restrictions for transactions that involved jupiter lends borrow program through the repay instruction using the instruction sysvar with the logic being you can't repay your kamino loan, then the refinance flow cannot work and the lending position can't be migrated to jupiter lend.

Ironically, this restriction can easily bypassed and the purpose of the article is to explain how it can and also provide a functional solana program to do so, but first we have to understand some fundamental things - the instructions sysvar, cross program invocations and anatomy of solana flashloans work, lets get to it.

## Understanding the instruction sysvar

Sysvars in solana are basically read only system accounts that are used to access solana blockchain state.

The instruction sysvar is a specialized sysvar to access the serialized instructions of the current transaction including some metadata that are part of the transaction, by using it, we can introspect into the instructions of the current transaction and access their accounts and data.

(instructions in solana are made up of accounts, data, and the id of the program that we are executing)

We access sysvars in the anchor framework by listing them as a account under the `#[Derive(Accounts)]` struct using the address of the sysvar, in the code snippet below we are using the instruction sysvar and also adding an anchor constraint to ensure that the right address for the sysvar `Sysvar1nstructions1111111111111111111111111` is passed

```rust
    use anchor_lang::{
        prelude::*,
        solana_program::sysvar::{instructions::Instructions as SysInstructions},
        Accounts,
    };

    #[Derive(Accounts)]
    /// CHECK: Sysvar Instruction allowing introspection, fixed address
    #[account(address = SysInstructions::id())]
    pub instruction_sysvar_account: AccountInfo<'info>,
```

## (Cross program invocations) CPIs in solana

Cross program invocations or CPIs for short, is a functionality in solana that allows us to invoke the instructions of another existing program. In this example here we are invoking the burn instruction of the solana token program from our program using a cross program invocation (CPI)

```rust
pub fn burn<'info>(
    token_mint: AccountInfo<'info>,
    user_token_ata: AccountInfo<'info>,
    user: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    burn_amount: u64,
) -> Result<()> {
    anchor_spl::token::burn(
        CpiContext::new(
            token_program,
            anchor_spl::token::Burn {
                mint: token_mint,
                from: user_token_ata,
                authority: user,
            },
        ),
        burn_amount,
    )?;

    Ok(())
}
```

Solana uses a stack to track CPI calls, the initial stack height starts at 1, for every CPI call invoked, it adds 1 to the stack, the maximum number of nested cpi calls (Cpi depth) that can be invoked currently is [4](https://github.com/anza-xyz/agave/blob/master/program-runtime/src/execution_budget.rs?ref=blog.asymmetric.re#L8), but SIMD (solana improvement document) [0268](https://github.com/solana-foundation/solana-improvement-documents/blob/666aef1a6dc6b3a566ee4ad49d51beef8a792a93/proposals/0268-raise-cpi-nesting-limit.md) proposal increases it to 8.

## Understanding the program restriction and bypassing it

The kamino program restriction is invoked as an anchor account constraint for the instruction sysvar account that is passed in the list of accounts for the `RepayObligationLiquidity` instruction

```rust
#[derive(Accounts)]
pub struct RepayObligationLiquidity<'info> {
   
    pub owner: Signer<'info>,
    ///other accounts
    
    /// CHECK: Syvar Instruction allowing introspection, fixed address
    #[account(
        address = SysInstructions::id(),
        constraint = ix_utils::no_restricted_programs_within_tx(&instruction_sysvar_account)? @ LendingError::TransactionIncludesRestrictedPrograms
    )]
    pub instruction_sysvar_account: AccountInfo<'info>,
   
}

```

[source](https://github.com/Kamino-Finance/klend/blob/c06001927d68895be487482bdd82dcf6e88e6348/programs/klend/src/handlers/handler_repay_obligation_liquidity.rs#L149)

Lets breakdown the anchor constraint that invokes the program restriction, its a standard anchor check of the type `#[account(mut @ <custom_error>)]` where the function `no_restricted_programs_within_tx(&instruction_sysvar_account)` accepts the instruction sysvar account, is invoked during runtime and throws the custom error `LendingError::TransactionIncludesRestrictedPrograms` if it fails - that is the transaction involves an instruction containing an program id that is included in the restricted programs list.

```rust
 constraint = ix_utils::no_restricted_programs_within_tx(&instruction_sysvar_account)? @ LendingError::TransactionIncludesRestrictedPrograms
```

Now lets take a deeper dive into [ix_utils](https://github.com/Kamino-Finance/klend/blob/c06001927d68895be487482bdd82dcf6e88e6348/programs/klend/src/lending_market/ix_utils.rs#L161) and finally the `no_restricted_programs_within_tx` to see how everything works.

In `ix_utils` two solana_program helpers do the reading, and they're the only two concrete operations ix_utils actually needs:

`load_current_index_checked(sysvar)` → the index of the instruction currently executing.
`load_instruction_at_checked(index, sysvar)` → the Instruction (program id, accounts, data) sitting at that index. Everything else in ix_utils is an abstraction layered over these two methods.

Rather than calling the sysvar helpers directly everywhere, a trait for all the introspection logic is defined called the `InstructionLoader` which contains three more custom helpers `is_flash_forbidden_cpi_call` , `is_forbidden_cpi_call` and `tx_includes_restricted_programs` , the last helper is what we will be focusing on.

```rust
pub trait InstructionLoader {
    fn load_instruction_at(&self, index: usize) -> Result<Instruction, ProgramError>;
    fn load_current_index(&self) -> Result<u16, ProgramError>;
    fn is_flash_forbidden_cpi_call(&self) -> Result<bool>;
    fn is_forbidden_cpi_call(&self) -> Result<bool>;
    fn tx_includes_restricted_programs(&self) -> Result<bool>;
}
```

Another struct `BpfInstructionLoader` implements the `InstructionLoader` trait and just forwards to the actual sysvar account `instruction_sysvar_account_info`, passed in.

```rust
pub struct BpfInstructionLoader<'a, 'info> {
    pub instruction_sysvar_account_info: &'a AccountInfo<'info>,
}

impl InstructionLoader for BpfInstructionLoader<'_, '_> {
    fn load_instruction_at(&self, index: usize) -> Result<Instruction, ProgramError> {
        load_instruction_at_checked(index, self.instruction_sysvar_account_info)
    }
    fn load_current_index(&self) -> Result<u16, ProgramError> {
        load_current_index_checked(self.instruction_sysvar_account_info)
    }
}
```

So `BpfInstructionLoader::new(&instruction_sysvar_account)` is the object our constraint hands the sysvar to.

We create a custom iterator for the instructions called `IxIterator` to do this we implement the inbuilt rust trait [Iterator](https://doc.rust-lang.org/rust-by-example/trait/iter.html), where each item is an `Result<Instruction>` Object

```rust
impl<IxLoader: ?Sized> Iterator for IxIterator<'_, IxLoader>
where
    IxLoader: InstructionLoader,
{
    type Item = std::result::Result<Instruction, ProgramError>;
```

Now, to scan every instruction, the loader is now wrapped in an iterator that just increments from a starting index:

```rust
fn next(&mut self) -> Option<Self::Item> {
    match self.instruction_loader.load_instruction_at(self.current_ix_index) {
        Ok(ix) => {
            self.current_ix_index = self.current_ix_index.checked_add(1).unwrap();
            Some(Ok(ix))
        }
        Err(ProgramError::InvalidArgument) => None, // walked off the end → stop
        Err(e) => Some(Err(e)),
    }
}
```

The termination condition is the important detail: load_instruction_at_checked returns ProgramError::InvalidArgument when you ask for an index past the last instruction, and the iterator treats that as "done." So `IxIterator::new_at(0, loader)` yields instruction 0, 1, 2, … until the sysvar says there are no more — i.e. it enumerates exactly the transaction's instruction list, in order.

Now that we understand `ix_utils` and with the iterator in place, the restricted program check is rather straightforward.

```rust
fn tx_includes_restricted_programs(&self) -> Result<bool> {
    let ix_iterator = IxIterator::new_at(0, self);
    for ix_result in ix_iterator {
        let ix = ix_result?;
        if RESTRICTED_PROGRAMS.contains(&ix.program_id) {
            return Ok(true);
        }
    }
    Ok(false)
}
```

It iterates the whole transaction and returns true the moment it finds an instruction whose program_id is in the RESTRICTED_PROGRAMS list which currently only contains Jupiter Lend's borrow program:

```rust
pub const RESTRICTED_PROGRAMS: [Pubkey; 1] =
    [pubkey!("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi")];

pub fn no_restricted_programs_within_tx(
    instruction_sysvar_account_info: &AccountInfo,
) -> Result<bool> {
    let instruction_loader = BpfInstructionLoader::new(instruction_sysvar_account_info);
    Ok(!instruction_loader.tx_includes_restricted_programs()?)
}
```

Basically the key to bypassing this restriction depends on the fact that the instruction sysvar only holds the instructions at the stack depth of 1, that is, the top level instructions in a solana transaction. Put a jupr81 instruction at the top level next to a Kamino repay, and tx_includes_restricted_programs finds it → TransactionIncludesRestrictedPrograms. A naïve one-transaction Kamino→Jupiter refinance is dead on arrival.

So if we write a solana program that implements the same refinancing logic then the instruction that invokes the restricted jupiter borrow program (jupr81...) for either creating a new jupiter position in the same transaction that a kamino loan has been repayed will become an inner instruction with a stack depth of two, `tx_includes_restricted_programs` returns false, `no_restricted_programs_within_tx` returns true, the constraint passes, and the whole reifnance flow proceeds.

```markdown
Transaction
├── Instruction 0: Program A
│   ├── CPI -> Program B
│   │   └── CPI -> Program C
│   └── CPI -> Program D
├── Instruction 1: Program E
└── Instruction 2: Program F
```

Also this is the reason that most solana lending protocols that support flashloans do not allow you to execute a flashloan instruction via CPI because the flashloan check uses the instruction sysvar to introspect into the current transaction to check if there is a valid repay instruction that is, one with the equivalent borrowed asset type and amount, so it has to be top level (at CPI stack depth 1).

Lets go ahead and explain our bypass program

## Design and implementation of our program

To implement our program we use the [pinocchio](https://github.com/anza-xyz/pinocchio) framework - a lightweight solana framework that produces binaries far less than anchor with an optimized entrypoint.

We follow the blueshifts beethoven [design architecture](https://github.com/blueshift-gg/beethoven/blob/master/crates/core/src/lib.rs#L58) where every protocol action is generalized by a trait each with a method, one method for implementing the protocol specific action where we use PDA signing and the other where we do not, each protocol implements the specifc trait with its specific account requirements and CPI logic.

```rust
#![allow(dead_code)]
use pinocchio::{instruction::Signer, ProgramResult};

pub trait Deposit<'info> {
    type Accounts;
    type Data;

    fn deposit(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

pub trait Withdraw<'info> {
    type Accounts;
    type Data;

    fn withdraw(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::withdraw_signed(ctx, amount, data, &[])
    }

    fn withdraw_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}
```

Then we implement the method for each protoco, in this case we implement the logic for depositing into kamino finance and jupiter lend and for the rest of the3 actions -> initialize (position), borrow, withdraw, repay,

```rust 
// Jupiter Lend implementation
impl<'info> Deposit<'info> for JupiterLend {
    type Accounts = JupiterOperateAccounts<'info>;
    type Data = [u8; 3];

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        operate(ctx, amount as i128, 0, data, signer_seeds)
    }
}

//Kamino Finance Implementation
impl<'info> Deposit<'info> for Kamino {
    type Accounts = KaminoDepositAccounts<'info>;
    type Data = u8;

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        flags: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let flags = *flags;

        refresh_reserve(
            ctx.reserve,
            ctx.lending_market,
            ctx.scope_oracle,
            ctx.kamino_lending_program,
        )?;

        if flags & FLAG_HAS_BORROWS != 0 {
            refresh_reserve(
                ctx.borrow_reserve,
                ctx.lending_market,
                ctx.scope_oracle_borrow,
                ctx.kamino_lending_program,
            )?;
        }

        refresh_obligation(
            ctx.lending_market,
            ctx.obligation,
            ctx.reserve,
            Some(ctx.borrow_reserve),
            flags,
            signer_seeds,
        )?;

        deposit_collateral(ctx, amount, signer_seeds)
    }
}
```

## Jupiter Lend `operate` deltas

Jupiter has an interesting and efficient design where every action is carried out through a single operate instruction with five parameters, two of which are the new collateral amount `new_col` and new debt amount `new_debt` , and the signs of each amount pick the action; while the magnitude is the amount.

With this we can represent the four fundamental lending actions - deposit, withdraw, borrow, repay and optionally inserting `u64::MAX` (encoded as `i128::MIN`) means "all" to pay all the debt, withdraw all the collateral, etc

[source](https://github.com/Instadapp/fluid-solana-programs/blob/626b177f235224bc5d074d39439cd2558f542886/programs/vaults/src/module/user.rs#L71)

```rust
pub fn operate<'info>(
    ctx: Context<'_, '_, 'info, 'info, Operate<'info>>,
    new_col: i128,
    new_debt: i128,
    transfer_type: Option<TransferType>,
    remaining_accounts_indices: Vec<u8>,
) -> Result<(u32, i128, i128)> 
```

With this a combination of signed amounts and magnitude can execute two actions together at once eg deposit and borrow, payback (repay) and withdraw.

Here is a table showing all the actions together.

![Jupiter operate deltas](docs/operate-deltas.png)

## Kamino

The kamino implementation was more tedious because their collateral and borrows need to be refreshed before every borrow or repay transaction

Before any instruction invocation involving reserves in kamino finance, we need to refresh the relevant reserves for either the debt (obligation) and the collateral, we use a system of bitmasking adapted from this [repo](https://github.com/L0STE/anchor-looping-program/blob/main/programs/anchor-looping/src/lib.rs#L22)

So before each withdraw, deposit, borrow or repay kamino instruction invocatiion we add either refresh the collateral, and or the borrow, in order for the reserves to not be stale 

## The reserve-refresh bitmask

Kamino won't let you touch an obligation until every reserve it holds has been refreshed *in the same slot*, and its `RefreshObligation` instruction is picky: you must hand it **exactly** the reserves the obligation currently holds — no more, no fewer — as remaining accounts. Pass a borrow reserve to an obligation that has no debt and it rejects the whole thing with a reserve-count mismatch.

That's a problem when you're chaining actions inside one transaction, because the obligation's composition *changes as you go* — repay all the debt and the borrow side vanishes; deposit collateral and the collateral side appears. So the program carries a tiny **bitmask** describing what the obligation holds, and rewrites it between sub-actions with plain bitwise ops.

Two bits, one for each side of a lending position:

```rust
pub const FLAG_HAS_COLLATERAL: u8 = 1 << 0; // 0b01
pub const FLAG_HAS_BORROWS:    u8 = 1 << 1; // 0b10
```

### The bitmask decides which reserves get refreshed

`refresh_obligation` reads the two bits and assembles the reserve list it forwards to Kamino's `RefreshObligation` — collateral if `FLAG_HAS_COLLATERAL` is set, borrow if `FLAG_HAS_BORROWS` is set:

```rust
pub fn refresh_obligation<'a>(
    lending_market: &'a AccountInfo,
    obligation: &'a AccountInfo,
    collateral_reserve: &'a AccountInfo,
    borrow_reserve: Option<&'a AccountInfo>,
    flags: u8,
    signers: &[Signer],
) -> ProgramResult {
    let mut reserve_infos: [MaybeUninit<&AccountInfo>; 2] = /* ... */;
    let mut count = 0usize;

    if flags & FLAG_HAS_COLLATERAL != 0 {
        reserve_infos[count].write(collateral_reserve);
        count += 1;
    }
    if flags & FLAG_HAS_BORROWS != 0 {
        if let Some(reserve) = borrow_reserve {
            reserve_infos[count].write(reserve);
            count += 1;
        }
    }
    // pass exactly `count` reserves to RefreshObligation
    refresh_obligation_with_reserves(lending_market, obligation, /* &reserves[..count] */, signers)
}
```

So the bitmask is a compact description of the obligation's current reserve set, and `flags & FLAG_X != 0` is just "does the obligation hold side X right now?".

### Each action refreshes its own side always, the other side conditionally

Every Kamino action follows the same rule: **always refresh the reserve it operates on; refresh the opposite side only if the obligation holds it.** `deposit` targets collateral, so it refreshes collateral unconditionally and the borrow reserve only when `FLAG_HAS_BORROWS` is set:

```rust
fn deposit_signed(ctx, amount, flags, signer_seeds) -> ProgramResult {
    let flags = *flags;

    refresh_reserve(ctx.reserve, ctx.lending_market, ctx.scope_oracle, ctx.kamino_lending_program)?;      // collateral: always

    if flags & FLAG_HAS_BORROWS != 0 {
        refresh_reserve(ctx.borrow_reserve, ctx.lending_market, ctx.scope_oracle_borrow, ctx.kamino_lending_program)?; // debt: only if held
    }

    refresh_obligation(ctx.lending_market, ctx.obligation, ctx.reserve, Some(ctx.borrow_reserve), flags, signer_seeds)?;
    deposit_collateral(ctx, amount, signer_seeds)
}
```

`withdraw` is the mirror image — its target *is* collateral, so same shape: refresh the withdraw reserve always, the borrow reserve only under `FLAG_HAS_BORROWS`.

`borrow` and `repay` target the **debt** side, so the condition flips — they refresh the borrow reserve unconditionally and the collateral reserve only under `FLAG_HAS_COLLATERAL`:

```rust
fn borrow_signed(ctx, amount, flags, signer_seeds) -> ProgramResult {
    let flags = *flags;

    if flags & FLAG_HAS_COLLATERAL != 0 {
        refresh_reserve(ctx.collateral_reserve, /* scope_oracle_collateral */ ..)?; // collateral: only if held
    }
    refresh_reserve(ctx.borrow_reserve, /* scope_oracle_borrow */ ..)?;             // debt: always

    refresh_obligation(ctx.lending_market, ctx.obligation, ctx.collateral_reserve, Some(ctx.borrow_reserve), flags, signer_seeds)?;
    borrow_from_reserve(ctx, amount, signer_seeds)
}
```

### Rewriting the mask between chained actions

This is where the bitmask earns its keep. In a refinance the actions run back-to-back on the *same* obligation, and each one mutates the obligation, so the flag we feed the *next* action has to reflect that mutation. The program does it with a single bitwise op each time.

**Kamino → Jupiter** repays, then withdraws. Repaying gets the caller's full flag (the obligation has both sides). But if we repaid **all** the debt (`u64::MAX`), the borrow side is now gone — so before the withdraw we **clear** the borrow bit with `& !FLAG_HAS_BORROWS`, leaving only collateral:

```rust
fn process_kamino_to_jupiter(&self) -> ProgramResult {
    // after a full repay the obligation no longer has a borrow → clear that bit
    let withdraw_flag = if self.data.source_repay_amount == u64::MAX {
        self.data.kamino_has_collateral_or_borrow_flag & !FLAG_HAS_BORROWS
    } else {
        self.data.kamino_has_collateral_or_borrow_flag
    };

    Kamino::repay(&repay_accounts, self.data.source_repay_amount,
                  &self.data.kamino_has_collateral_or_borrow_flag)?; // repay: original mask (still has debt)
    Kamino::withdraw(&withdraw_accounts, self.data.source_withdraw_amount,
                     &withdraw_flag)?;                               // withdraw: borrow bit cleared

    JupiterLend::deposit_and_borrow(/* ... */)
}
```

Had we left `FLAG_HAS_BORROWS` set, the withdraw's `refresh_obligation` would try to hand `RefreshObligation` a borrow reserve the obligation no longer has → count mismatch, revert.

**Jupiter → Kamino** is the inverse. The destination Kamino obligation starts empty, so `deposit` runs with the caller's mask (typically `0` — nothing held yet). After the deposit the obligation *has* collateral, so before the borrow we **set** the collateral bit with `| FLAG_HAS_COLLATERAL`:

```rust
fn process_jupiter_to_kamino(&self) -> ProgramResult {
    let deposit_flag = self.data.kamino_has_collateral_or_borrow_flag;   // fresh obligation → usually 0
    let borrow_flag  = deposit_flag | FLAG_HAS_COLLATERAL;               // after deposit, collateral exists → set the bit

    JupiterLend::repay_and_withdraw(/* ... */)?;
    Kamino::deposit(&deposit_accounts, self.data.destination_deposit_amount, &deposit_flag)?; // deposit: 0 reserves refreshed
    Kamino::borrow(&borrow_accounts,  self.data.destination_borrow_amount,  &borrow_flag)?;   // borrow: collateral bit set
}
```

So the whole scheme is: one `u8`, two meaningful bits, where `& FLAG` asks "does the obligation hold this side?", `| FLAG` records "it now does," and `& !FLAG` records "it no longer does." That's enough to keep `RefreshObligation`'s strict reserve list correct as the position is torn down on one venue and rebuilt on the other — without the client having to re-specify the obligation's shape at every step.

## Testing with LiteSVM and surfpool too

- dumping fixtures directly at test time 
- Oracle drift gives errors in mainnet , surfnetStreamAccount usage 

## Conclusion

They were discussions largely involving the actions Kamino finance took, some said its against the ethos of defi, others said its fair game in competition to prevent vampire attack of their user base 

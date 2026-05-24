use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    protocols::{invoke_signed_with_accounts, invoke_signed_with_count},
    traits::{Borrow, Deposit, Initialize, Repay, Withdraw},
    write_bytes, UNINIT_BYTE,
};

pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const FLAG_HAS_COLLATERAL: u8 = 1 << 0;
pub const FLAG_HAS_BORROWS: u8 = 1 << 1;

const DISC_REFRESH_RESERVE: [u8; 8] = [2, 218, 138, 235, 79, 201, 25, 102];
const DISC_REFRESH_OBLIGATION: [u8; 8] = [33, 132, 147, 228, 151, 192, 72, 89];
const DISC_INIT_USER_METADATA: [u8; 8] = [117, 169, 176, 69, 197, 23, 15, 162];
const DISC_INIT_OBLIGATION: [u8; 8] = [251, 10, 231, 76, 27, 11, 159, 96];
const DISC_INIT_OBLIGATION_FARMS: [u8; 8] = [136, 63, 15, 186, 211, 152, 168, 164];
const DISC_DEPOSIT_RESERVE_LIQUIDITY_V2: [u8; 8] = [216, 224, 191, 27, 204, 151, 102, 175];
const DISC_WITHDRAW_OBLIGATION_COLLATERAL_V2: [u8; 8] = [235, 52, 119, 152, 149, 197, 20, 7];
const DISC_BORROW_OBLIGATION_LIQUIDITY_V2: [u8; 8] = [161, 128, 143, 245, 171, 199, 194, 6];
const DISC_REPAY_OBLIGATION_LIQUIDITY_V2: [u8; 8] = [116, 174, 213, 76, 180, 53, 210, 144];

pub struct Kamino;

pub struct KaminoInitAccounts<'info> {
    pub kamino_lending_program: &'info AccountInfo,
    pub signer: &'info AccountInfo,
    pub user_metadata: &'info AccountInfo,
    pub obligation: &'info AccountInfo,
    pub lending_market: &'info AccountInfo,
    pub lending_market_authority: &'info AccountInfo,
    pub reserve: &'info AccountInfo,
    pub obligation_farm_state: &'info AccountInfo,
    pub reserve_farm_state: &'info AccountInfo,
    pub farms_program: &'info AccountInfo,
    pub rent: &'info AccountInfo,
    pub system_program: &'info AccountInfo,
}

impl<'info> KaminoInitAccounts<'info> {
    pub fn try_from_slice(accounts: &'info [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, signer, user_metadata, obligation, lending_market, lending_market_authority, reserve, obligation_farm_state, reserve_farm_state, farms_program, rent, system_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            signer,
            user_metadata,
            obligation,
            lending_market,
            lending_market_authority,
            reserve,
            obligation_farm_state,
            reserve_farm_state,
            farms_program,
            rent,
            system_program,
        })
    }
}

pub struct KaminoDepositAccounts<'info> {
    pub kamino_lending_program: &'info AccountInfo,
    pub owner: &'info AccountInfo,
    pub obligation: &'info AccountInfo,
    pub lending_market: &'info AccountInfo,
    pub lending_market_authority: &'info AccountInfo,
    pub reserve: &'info AccountInfo,
    pub reserve_liquidity_mint: &'info AccountInfo,
    pub reserve_liquidity_supply: &'info AccountInfo,
    pub reserve_collateral_mint: &'info AccountInfo,
    pub reserve_destination_deposit_collateral: &'info AccountInfo,
    pub user_source_liquidity: &'info AccountInfo,
    pub collateral_token_program: &'info AccountInfo,
    pub liquidity_token_program: &'info AccountInfo,
    pub instruction_sysvar_account: &'info AccountInfo,
    pub obligation_farm_user_state: &'info AccountInfo,
    pub reserve_farm_state: &'info AccountInfo,
    pub farms_program: &'info AccountInfo,
    pub scope_oracle: &'info AccountInfo,
    pub borrow_reserve: &'info AccountInfo,
    pub scope_oracle_borrow: &'info AccountInfo,
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> KaminoDepositAccounts<'info> {
    pub fn try_from_slice(accounts: &'info [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, reserve, reserve_liquidity_mint, reserve_liquidity_supply, reserve_collateral_mint, reserve_destination_deposit_collateral, user_source_liquidity, collateral_token_program, liquidity_token_program, instruction_sysvar_account, obligation_farm_user_state, reserve_farm_state, farms_program, scope_oracle, borrow_reserve, scope_oracle_borrow, reserve_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            reserve,
            reserve_liquidity_mint,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            reserve_destination_deposit_collateral,
            user_source_liquidity,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
            obligation_farm_user_state,
            reserve_farm_state,
            farms_program,
            scope_oracle,
            borrow_reserve,
            scope_oracle_borrow,
            reserve_accounts,
        })
    }
}

pub struct KaminoBorrowAccounts<'info> {
    pub kamino_lending_program: &'info AccountInfo,
    pub owner: &'info AccountInfo,
    pub obligation: &'info AccountInfo,
    pub lending_market: &'info AccountInfo,
    pub lending_market_authority: &'info AccountInfo,
    pub collateral_reserve: &'info AccountInfo,
    pub borrow_reserve: &'info AccountInfo,
    pub output_mint: &'info AccountInfo,
    pub reserve_borrow_supply: &'info AccountInfo,
    pub borrow_reserve_liquidity_fee_receiver: &'info AccountInfo,
    pub user_borrow_destination: &'info AccountInfo,
    pub token_program: &'info AccountInfo,
    pub instruction_sysvar_account: &'info AccountInfo,
    pub borrow_obligation_farm_state: &'info AccountInfo,
    pub borrow_reserve_farm_state: &'info AccountInfo,
    pub farms_program: &'info AccountInfo,
    pub scope_oracle_collateral: &'info AccountInfo,
    pub scope_oracle_borrow: &'info AccountInfo,
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> KaminoBorrowAccounts<'info> {
    pub fn try_from_slice(accounts: &'info [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, collateral_reserve, borrow_reserve, output_mint, reserve_borrow_supply, borrow_reserve_liquidity_fee_receiver, user_borrow_destination, token_program, instruction_sysvar_account, borrow_obligation_farm_state, borrow_reserve_farm_state, farms_program, scope_oracle_collateral, scope_oracle_borrow, reserve_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            collateral_reserve,
            borrow_reserve,
            output_mint,
            reserve_borrow_supply,
            borrow_reserve_liquidity_fee_receiver,
            user_borrow_destination,
            token_program,
            instruction_sysvar_account,
            borrow_obligation_farm_state,
            borrow_reserve_farm_state,
            farms_program,
            scope_oracle_collateral,
            scope_oracle_borrow,
            reserve_accounts,
        })
    }
}

pub struct KaminoRepayAccounts<'info> {
    pub kamino_lending_program: &'info AccountInfo,
    pub owner: &'info AccountInfo,
    pub obligation: &'info AccountInfo,
    pub lending_market: &'info AccountInfo,
    pub lending_market_authority: &'info AccountInfo,
    pub collateral_reserve: &'info AccountInfo,
    pub borrow_reserve: &'info AccountInfo,
    pub output_mint: &'info AccountInfo,
    pub reserve_borrow_supply: &'info AccountInfo,
    pub user_source_liquidity: &'info AccountInfo,
    pub token_program: &'info AccountInfo,
    pub instruction_sysvar_account: &'info AccountInfo,
    pub borrow_obligation_farm_state: &'info AccountInfo,
    pub borrow_reserve_farm_state: &'info AccountInfo,
    pub farms_program: &'info AccountInfo,
    pub scope_oracle_collateral: &'info AccountInfo,
    pub scope_oracle_borrow: &'info AccountInfo,
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> KaminoRepayAccounts<'info> {
    pub fn try_from_slice(accounts: &'info [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, collateral_reserve, borrow_reserve, output_mint, reserve_borrow_supply, user_source_liquidity, token_program, instruction_sysvar_account, borrow_obligation_farm_state, borrow_reserve_farm_state, farms_program, scope_oracle_collateral, scope_oracle_borrow, reserve_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            collateral_reserve,
            borrow_reserve,
            output_mint,
            reserve_borrow_supply,
            user_source_liquidity,
            token_program,
            instruction_sysvar_account,
            borrow_obligation_farm_state,
            borrow_reserve_farm_state,
            farms_program,
            scope_oracle_collateral,
            scope_oracle_borrow,
            reserve_accounts,
        })
    }
}

pub struct KaminoWithdrawAccounts<'info> {
    pub kamino_lending_program: &'info AccountInfo,
    pub owner: &'info AccountInfo,
    pub obligation: &'info AccountInfo,
    pub lending_market: &'info AccountInfo,
    pub lending_market_authority: &'info AccountInfo,
    pub withdraw_reserve: &'info AccountInfo,
    pub reserve_liquidity_mint: &'info AccountInfo,
    pub reserve_source_collateral: &'info AccountInfo,
    pub reserve_collateral_mint: &'info AccountInfo,
    pub reserve_liquidity_supply: &'info AccountInfo,
    pub user_destination_liquidity: &'info AccountInfo,
    pub collateral_token_program: &'info AccountInfo,
    pub liquidity_token_program: &'info AccountInfo,
    pub instruction_sysvar_account: &'info AccountInfo,
    pub obligation_farm_user_state: &'info AccountInfo,
    pub reserve_farm_state: &'info AccountInfo,
    pub farms_program: &'info AccountInfo,
    pub scope_oracle: &'info AccountInfo,
    pub borrow_reserve: &'info AccountInfo,
    pub scope_oracle_borrow: &'info AccountInfo,
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> KaminoWithdrawAccounts<'info> {
    pub fn try_from_slice(accounts: &'info [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, withdraw_reserve, reserve_liquidity_mint, reserve_source_collateral, reserve_collateral_mint, reserve_liquidity_supply, user_destination_liquidity, collateral_token_program, liquidity_token_program, instruction_sysvar_account, obligation_farm_user_state, reserve_farm_state, farms_program, scope_oracle, borrow_reserve, scope_oracle_borrow, reserve_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            withdraw_reserve,
            reserve_liquidity_mint,
            reserve_source_collateral,
            reserve_collateral_mint,
            reserve_liquidity_supply,
            user_destination_liquidity,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
            obligation_farm_user_state,
            reserve_farm_state,
            farms_program,
            scope_oracle,
            borrow_reserve,
            scope_oracle_borrow,
            reserve_accounts,
        })
    }
}

pub fn refresh_reserve<'a>(
    reserve: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    scope_oracle: &'a AccountInfo,
    kamino_lending_program: &'a AccountInfo,
) -> ProgramResult {
    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (reserve, AccountMeta::writable(reserve.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (scope_oracle, AccountMeta::readonly(scope_oracle.key())),
        ],
        &DISC_REFRESH_RESERVE,
        &[],
    )
}

pub fn refresh_obligation_with_reserves<'a>(
    lending_market: &'a AccountInfo,
    obligation: &'a AccountInfo,
    reserve_accounts: &[&'a AccountInfo],
    signers: &[Signer],
) -> ProgramResult {
    const MAX: usize = 18;
    let mut metas: [MaybeUninit<AccountMeta>; MAX] = unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&AccountInfo>; MAX] =
        unsafe { MaybeUninit::uninit().assume_init() };

    let mut count = 0usize;

    metas[count].write(AccountMeta::readonly(lending_market.key()));
    infos[count].write(lending_market);
    count += 1;

    metas[count].write(AccountMeta::writable(obligation.key()));
    infos[count].write(obligation);
    count += 1;

    for r in reserve_accounts {
        if count >= MAX {
            break;
        }
        metas[count].write(AccountMeta::readonly(r.key()));
        infos[count].write(r);
        count += 1;
    }

    invoke_signed_with_count(
        &KAMINO_LEND_PROGRAM_ID,
        &metas,
        &infos,
        count,
        &DISC_REFRESH_OBLIGATION,
        signers,
    )
}

pub fn refresh_obligation<'a>(
    lending_market: &'a AccountInfo,
    obligation: &'a AccountInfo,
    collateral_reserve: &'a AccountInfo,
    borrow_reserve: Option<&'a AccountInfo>,
    flags: u8,
    signers: &[Signer],
) -> ProgramResult {
    let mut reserve_infos: [MaybeUninit<&AccountInfo>; 2] =
        unsafe { MaybeUninit::uninit().assume_init() };
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

    let reserve_slice: &[&AccountInfo] =
        unsafe { from_raw_parts(reserve_infos.as_ptr() as *const &AccountInfo, count) };

    refresh_obligation_with_reserves(lending_market, obligation, reserve_slice, signers)
}

fn init_user_metadata<'a>(ctx: &'a KaminoInitAccounts<'a>, signers: &[Signer]) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 40];
    write_bytes(&mut data[0..8], &DISC_INIT_USER_METADATA);
    write_bytes(&mut data[8..40], &[0u8; 32]);

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.signer, AccountMeta::readonly_signer(ctx.signer.key())),
            (ctx.signer, AccountMeta::writable_signer(ctx.signer.key())),
            (
                ctx.user_metadata,
                AccountMeta::writable(ctx.user_metadata.key()),
            ),
            (
                ctx.kamino_lending_program,
                AccountMeta::readonly(ctx.kamino_lending_program.key()),
            ),
            (ctx.rent, AccountMeta::readonly(ctx.rent.key())),
            (
                ctx.system_program,
                AccountMeta::readonly(ctx.system_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 40) },
        signers,
    )
}

fn init_obligation<'a>(ctx: &'a KaminoInitAccounts<'a>, signers: &[Signer]) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 10];
    write_bytes(&mut data[0..8], &DISC_INIT_OBLIGATION);
    write_bytes(&mut data[8..9], &[0]); // tag
    write_bytes(&mut data[9..10], &[0]); // id

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.signer, AccountMeta::readonly_signer(ctx.signer.key())),
            (ctx.signer, AccountMeta::writable_signer(ctx.signer.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.system_program,
                AccountMeta::readonly(ctx.system_program.key()),
            ),
            (
                ctx.system_program,
                AccountMeta::readonly(ctx.system_program.key()),
            ),
            (
                ctx.user_metadata,
                AccountMeta::readonly(ctx.user_metadata.key()),
            ),
            (ctx.rent, AccountMeta::readonly(ctx.rent.key())),
            (
                ctx.system_program,
                AccountMeta::readonly(ctx.system_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 10) },
        signers,
    )
}

fn init_obligation_farms<'a>(
    ctx: &'a KaminoInitAccounts<'a>,
    mode: u8,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 9];
    write_bytes(&mut data[0..8], &DISC_INIT_OBLIGATION_FARMS);
    write_bytes(&mut data[8..9], &[mode]);

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.signer, AccountMeta::writable_signer(ctx.signer.key())),
            (ctx.signer, AccountMeta::readonly(ctx.signer.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market_authority,
                AccountMeta::readonly(ctx.lending_market_authority.key()),
            ),
            (ctx.reserve, AccountMeta::writable(ctx.reserve.key())),
            (
                ctx.reserve_farm_state,
                AccountMeta::writable(ctx.reserve_farm_state.key()),
            ),
            (
                ctx.obligation_farm_state,
                AccountMeta::writable(ctx.obligation_farm_state.key()),
            ),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.farms_program,
                AccountMeta::readonly(ctx.farms_program.key()),
            ),
            (ctx.rent, AccountMeta::readonly(ctx.rent.key())),
            (
                ctx.system_program,
                AccountMeta::readonly(ctx.system_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 9) },
        signers,
    )
}

pub fn deposit_collateral<'a>(
    ctx: &'a KaminoDepositAccounts<'a>,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_DEPOSIT_RESERVE_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.owner, AccountMeta::writable_signer(ctx.owner.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.lending_market_authority,
                AccountMeta::readonly(ctx.lending_market_authority.key()),
            ),
            (ctx.reserve, AccountMeta::writable(ctx.reserve.key())),
            (
                ctx.reserve_liquidity_mint,
                AccountMeta::readonly(ctx.reserve_liquidity_mint.key()),
            ),
            (
                ctx.reserve_liquidity_supply,
                AccountMeta::writable(ctx.reserve_liquidity_supply.key()),
            ),
            (
                ctx.reserve_collateral_mint,
                AccountMeta::writable(ctx.reserve_collateral_mint.key()),
            ),
            (
                ctx.reserve_destination_deposit_collateral,
                AccountMeta::writable(ctx.reserve_destination_deposit_collateral.key()),
            ),
            (
                ctx.user_source_liquidity,
                AccountMeta::writable(ctx.user_source_liquidity.key()),
            ),
            (
                ctx.kamino_lending_program,
                AccountMeta::readonly(ctx.kamino_lending_program.key()),
            ),
            (
                ctx.collateral_token_program,
                AccountMeta::readonly(ctx.collateral_token_program.key()),
            ),
            (
                ctx.liquidity_token_program,
                AccountMeta::readonly(ctx.liquidity_token_program.key()),
            ),
            (
                ctx.instruction_sysvar_account,
                AccountMeta::readonly(ctx.instruction_sysvar_account.key()),
            ),
            (
                ctx.obligation_farm_user_state,
                AccountMeta::writable(ctx.obligation_farm_user_state.key()),
            ),
            (
                ctx.reserve_farm_state,
                AccountMeta::writable(ctx.reserve_farm_state.key()),
            ),
            (
                ctx.farms_program,
                AccountMeta::readonly(ctx.farms_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

pub fn borrow_from_reserve<'a>(
    ctx: &'a KaminoBorrowAccounts<'a>,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_BORROW_OBLIGATION_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.owner, AccountMeta::readonly_signer(ctx.owner.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.lending_market_authority,
                AccountMeta::readonly(ctx.lending_market_authority.key()),
            ),
            (
                ctx.borrow_reserve,
                AccountMeta::writable(ctx.borrow_reserve.key()),
            ),
            (
                ctx.output_mint,
                AccountMeta::readonly(ctx.output_mint.key()),
            ),
            (
                ctx.reserve_borrow_supply,
                AccountMeta::writable(ctx.reserve_borrow_supply.key()),
            ),
            (
                ctx.borrow_reserve_liquidity_fee_receiver,
                AccountMeta::writable(ctx.borrow_reserve_liquidity_fee_receiver.key()),
            ),
            (
                ctx.user_borrow_destination,
                AccountMeta::writable(ctx.user_borrow_destination.key()),
            ),
            // referrerTokenState: kamino_lending_program as the no-referrer sentinel (readonly).
            (
                ctx.kamino_lending_program,
                AccountMeta::readonly(ctx.kamino_lending_program.key()),
            ),
            (
                ctx.token_program,
                AccountMeta::readonly(ctx.token_program.key()),
            ),
            (
                ctx.instruction_sysvar_account,
                AccountMeta::readonly(ctx.instruction_sysvar_account.key()),
            ),
            (
                ctx.borrow_obligation_farm_state,
                AccountMeta::writable(ctx.borrow_obligation_farm_state.key()),
            ),
            (
                ctx.borrow_reserve_farm_state,
                AccountMeta::writable(ctx.borrow_reserve_farm_state.key()),
            ),
            (
                ctx.farms_program,
                AccountMeta::readonly(ctx.farms_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

pub fn repay_debt<'a>(
    ctx: &'a KaminoRepayAccounts<'a>,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_REPAY_OBLIGATION_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.owner, AccountMeta::readonly_signer(ctx.owner.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.borrow_reserve,
                AccountMeta::writable(ctx.borrow_reserve.key()),
            ),
            (
                ctx.output_mint,
                AccountMeta::readonly(ctx.output_mint.key()),
            ),
            (
                ctx.reserve_borrow_supply,
                AccountMeta::writable(ctx.reserve_borrow_supply.key()),
            ),
            (
                ctx.user_source_liquidity,
                AccountMeta::writable(ctx.user_source_liquidity.key()),
            ),
            (
                ctx.token_program,
                AccountMeta::readonly(ctx.token_program.key()),
            ),
            (
                ctx.instruction_sysvar_account,
                AccountMeta::readonly(ctx.instruction_sysvar_account.key()),
            ),
            (
                ctx.borrow_obligation_farm_state,
                AccountMeta::writable(ctx.borrow_obligation_farm_state.key()),
            ),
            (
                ctx.borrow_reserve_farm_state,
                AccountMeta::writable(ctx.borrow_reserve_farm_state.key()),
            ),
            (
                ctx.lending_market_authority,
                AccountMeta::readonly(ctx.lending_market_authority.key()),
            ),
            (
                ctx.farms_program,
                AccountMeta::readonly(ctx.farms_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

pub fn withdraw_collateral<'a>(
    ctx: &'a KaminoWithdrawAccounts<'a>,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_WITHDRAW_OBLIGATION_COLLATERAL_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (ctx.owner, AccountMeta::writable_signer(ctx.owner.key())),
            (ctx.obligation, AccountMeta::writable(ctx.obligation.key())),
            (
                ctx.lending_market,
                AccountMeta::readonly(ctx.lending_market.key()),
            ),
            (
                ctx.lending_market_authority,
                AccountMeta::readonly(ctx.lending_market_authority.key()),
            ),
            (
                ctx.withdraw_reserve,
                AccountMeta::writable(ctx.withdraw_reserve.key()),
            ),
            (
                ctx.reserve_liquidity_mint,
                AccountMeta::readonly(ctx.reserve_liquidity_mint.key()),
            ),
            (
                ctx.reserve_source_collateral,
                AccountMeta::writable(ctx.reserve_source_collateral.key()),
            ),
            (
                ctx.reserve_collateral_mint,
                AccountMeta::writable(ctx.reserve_collateral_mint.key()),
            ),
            (
                ctx.reserve_liquidity_supply,
                AccountMeta::writable(ctx.reserve_liquidity_supply.key()),
            ),
            (
                ctx.user_destination_liquidity,
                AccountMeta::writable(ctx.user_destination_liquidity.key()),
            ),
            (
                ctx.kamino_lending_program,
                AccountMeta::readonly(ctx.kamino_lending_program.key()),
            ),
            (
                ctx.collateral_token_program,
                AccountMeta::readonly(ctx.collateral_token_program.key()),
            ),
            (
                ctx.liquidity_token_program,
                AccountMeta::readonly(ctx.liquidity_token_program.key()),
            ),
            (
                ctx.instruction_sysvar_account,
                AccountMeta::readonly(ctx.instruction_sysvar_account.key()),
            ),
            (
                ctx.obligation_farm_user_state,
                AccountMeta::writable(ctx.obligation_farm_user_state.key()),
            ),
            (
                ctx.reserve_farm_state,
                AccountMeta::writable(ctx.reserve_farm_state.key()),
            ),
            (
                ctx.farms_program,
                AccountMeta::readonly(ctx.farms_program.key()),
            ),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

/// Initialize: init_user_metadata (if needed) + init_obligation (if needed) + init_obligation_farms.
/// Data = mode: u8  (0 = collateral farm, 1 = debt farm)
impl<'info> Initialize<'info> for Kamino {
    type Accounts = KaminoInitAccounts<'info>;
    type Data = u8;

    fn initialize_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let mode = *data;

        if ctx.user_metadata.lamports() == 0 {
            init_user_metadata(ctx, signer_seeds)?;
        }

        if ctx.obligation.lamports() == 0 {
            init_obligation(ctx, signer_seeds)?;
        }

        init_obligation_farms(ctx, mode, signer_seeds)
    }
}

/// Deposit: refresh collateral reserve, optionally refresh the existing borrow
/// reserve, then refresh obligation and deposit.
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

/// Borrow: refresh collateral + borrow reserves + obligation, then borrow.
impl<'info> Borrow<'info> for Kamino {
    type Accounts = KaminoBorrowAccounts<'info>;
    type Data = u8;

    fn borrow_signed(
        ctx: &Self::Accounts,
        amount: u64,
        flags: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let flags = *flags;

        if flags & FLAG_HAS_COLLATERAL != 0 {
            refresh_reserve(
                ctx.collateral_reserve,
                ctx.lending_market,
                ctx.scope_oracle_collateral,
                ctx.kamino_lending_program,
            )?;
        }

        refresh_reserve(
            ctx.borrow_reserve,
            ctx.lending_market,
            ctx.scope_oracle_borrow,
            ctx.kamino_lending_program,
        )?;

        refresh_obligation(
            ctx.lending_market,
            ctx.obligation,
            ctx.collateral_reserve,
            Some(ctx.borrow_reserve),
            flags,
            signer_seeds,
        )?;

        borrow_from_reserve(ctx, amount, signer_seeds)
    }
}

/// Repay: refresh collateral + borrow reserves + obligation, then repay.
impl<'info> Repay<'info> for Kamino {
    type Accounts = KaminoRepayAccounts<'info>;
    type Data = u8;

    fn repay_signed(
        ctx: &Self::Accounts,
        amount: u64,
        flags: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let flags = *flags;

        if flags & FLAG_HAS_COLLATERAL != 0 {
            refresh_reserve(
                ctx.collateral_reserve,
                ctx.lending_market,
                ctx.scope_oracle_collateral,
                ctx.kamino_lending_program,
            )?;
        }

        refresh_reserve(
            ctx.borrow_reserve,
            ctx.lending_market,
            ctx.scope_oracle_borrow,
            ctx.kamino_lending_program,
        )?;

        refresh_obligation(
            ctx.lending_market,
            ctx.obligation,
            ctx.collateral_reserve,
            Some(ctx.borrow_reserve),
            flags,
            signer_seeds,
        )?;

        repay_debt(ctx, amount, signer_seeds)
    }
}

/// Withdraw: refresh the withdraw reserve, optionally refresh the borrow reserve,
/// then refresh obligation and withdraw.
impl<'info> Withdraw<'info> for Kamino {
    type Accounts = KaminoWithdrawAccounts<'info>;
    type Data = u8;

    fn withdraw_signed(
        ctx: &Self::Accounts,
        amount: u64,
        flags: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let flags = *flags;

        refresh_reserve(
            ctx.withdraw_reserve,
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
            ctx.withdraw_reserve,
            Some(ctx.borrow_reserve),
            flags,
            signer_seeds,
        )?;

        withdraw_collateral(ctx, amount, signer_seeds)
    }
}

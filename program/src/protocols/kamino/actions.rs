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
    traits::{Borrow, Deposit, Repay, Withdraw},
    write_bytes, UNINIT_BYTE,
};

pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

const DISC_REFRESH_RESERVE: [u8; 8] = [2, 218, 138, 235, 79, 201, 25, 102];
const DISC_REFRESH_OBLIGATION: [u8; 8] = [33, 132, 147, 228, 151, 192, 72, 89];
const DISC_DEPOSIT_RESERVE_LIQUIDITY_V2: [u8; 8] = [216, 224, 191, 27, 204, 151, 102, 175];
const DISC_WITHDRAW_OBLIGATION_COLLATERAL_V2: [u8; 8] = [235, 52, 119, 152, 149, 197, 20, 7];
const DISC_BORROW_OBLIGATION_LIQUIDITY_V2: [u8; 8] = [161, 128, 143, 245, 171, 199, 194, 6];
const DISC_REPAY_OBLIGATION_LIQUIDITY_V2: [u8; 8] = [116, 174, 213, 76, 180, 53, 210, 144];

pub struct Kamino;

/// Accounts for Kamino deposit (18+ accounts):
///  [0]  kamino_lending_program
///  [1]  owner (signer)
///  [2]  obligation
///  [3]  lending_market
///  [4]  lending_market_authority
///  [5]  reserve
///  [6]  reserve_liquidity_mint
///  [7]  reserve_liquidity_supply
///  [8]  reserve_collateral_mint
///  [9]  reserve_destination_deposit_collateral
///  [10] user_source_liquidity
///  [11] collateral_token_program
///  [12] liquidity_token_program
///  [13] instruction_sysvar_account
///  [14] obligation_farm_user_state
///  [15] reserve_farm_state
///  [16] farms_program
///  [17] scope_oracle
///  [18..] reserve_accounts
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
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> TryFrom<&'info [AccountInfo]> for KaminoDepositAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 18 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            kamino_lending_program: &accounts[0],
            owner: &accounts[1],
            obligation: &accounts[2],
            lending_market: &accounts[3],
            lending_market_authority: &accounts[4],
            reserve: &accounts[5],
            reserve_liquidity_mint: &accounts[6],
            reserve_liquidity_supply: &accounts[7],
            reserve_collateral_mint: &accounts[8],
            reserve_destination_deposit_collateral: &accounts[9],
            user_source_liquidity: &accounts[10],
            collateral_token_program: &accounts[11],
            liquidity_token_program: &accounts[12],
            instruction_sysvar_account: &accounts[13],
            obligation_farm_user_state: &accounts[14],
            reserve_farm_state: &accounts[15],
            farms_program: &accounts[16],
            scope_oracle: &accounts[17],
            reserve_accounts: &accounts[18..],
        })
    }
}

/// Accounts for Kamino borrow (18+ accounts):
///  [0]  kamino_lending_program
///  [1]  owner
///  [2]  obligation
///  [3]  lending_market
///  [4]  lending_market_authority
///  [5]  collateral_reserve  (for refresh)
///  [6]  borrow_reserve
///  [7]  output_mint
///  [8]  reserve_borrow_supply
///  [9]  borrow_reserve_liquidity_fee_receiver
///  [10] user_borrow_destination
///  [11] token_program
///  [12] instruction_sysvar_account
///  [13] borrow_obligation_farm_state
///  [14] borrow_reserve_farm_state
///  [15] farms_program
///  [16] scope_oracle_collateral
///  [17] scope_oracle_borrow
///  [18..] reserve_accounts
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

impl<'info> TryFrom<&'info [AccountInfo]> for KaminoBorrowAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 18 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            kamino_lending_program: &accounts[0],
            owner: &accounts[1],
            obligation: &accounts[2],
            lending_market: &accounts[3],
            lending_market_authority: &accounts[4],
            collateral_reserve: &accounts[5],
            borrow_reserve: &accounts[6],
            output_mint: &accounts[7],
            reserve_borrow_supply: &accounts[8],
            borrow_reserve_liquidity_fee_receiver: &accounts[9],
            user_borrow_destination: &accounts[10],
            token_program: &accounts[11],
            instruction_sysvar_account: &accounts[12],
            borrow_obligation_farm_state: &accounts[13],
            borrow_reserve_farm_state: &accounts[14],
            farms_program: &accounts[15],
            scope_oracle_collateral: &accounts[16],
            scope_oracle_borrow: &accounts[17],
            reserve_accounts: &accounts[18..],
        })
    }
}

/// Accounts for Kamino repay (17+ accounts):
///  [0]  kamino_lending_program
///  [1]  owner
///  [2]  obligation
///  [3]  lending_market
///  [4]  lending_market_authority
///  [5]  collateral_reserve
///  [6]  borrow_reserve
///  [7]  output_mint
///  [8]  reserve_borrow_supply
///  [9]  user_source_liquidity
///  [10] token_program
///  [11] instruction_sysvar_account
///  [12] borrow_obligation_farm_state
///  [13] borrow_reserve_farm_state
///  [14] farms_program
///  [15] scope_oracle_collateral
///  [16] scope_oracle_borrow
///  [17..] reserve_accounts
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

impl<'info> TryFrom<&'info [AccountInfo]> for KaminoRepayAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 17 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            kamino_lending_program: &accounts[0],
            owner: &accounts[1],
            obligation: &accounts[2],
            lending_market: &accounts[3],
            lending_market_authority: &accounts[4],
            collateral_reserve: &accounts[5],
            borrow_reserve: &accounts[6],
            output_mint: &accounts[7],
            reserve_borrow_supply: &accounts[8],
            user_source_liquidity: &accounts[9],
            token_program: &accounts[10],
            instruction_sysvar_account: &accounts[11],
            borrow_obligation_farm_state: &accounts[12],
            borrow_reserve_farm_state: &accounts[13],
            farms_program: &accounts[14],
            scope_oracle_collateral: &accounts[15],
            scope_oracle_borrow: &accounts[16],
            reserve_accounts: &accounts[17..],
        })
    }
}

/// Accounts for Kamino withdraw (18+ accounts):
///  [0]  kamino_lending_program
///  [1]  owner
///  [2]  obligation
///  [3]  lending_market
///  [4]  lending_market_authority
///  [5]  withdraw_reserve
///  [6]  reserve_liquidity_mint
///  [7]  reserve_source_collateral
///  [8]  reserve_collateral_mint
///  [9]  reserve_liquidity_supply
///  [10] user_destination_liquidity
///  [11] collateral_token_program
///  [12] liquidity_token_program
///  [13] instruction_sysvar_account
///  [14] obligation_farm_user_state
///  [15] reserve_farm_state
///  [16] farms_program
///  [17] scope_oracle
///  [18..] reserve_accounts
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
    pub reserve_accounts: &'info [AccountInfo],
}

impl<'info> TryFrom<&'info [AccountInfo]> for KaminoWithdrawAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 18 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            kamino_lending_program: &accounts[0],
            owner: &accounts[1],
            obligation: &accounts[2],
            lending_market: &accounts[3],
            lending_market_authority: &accounts[4],
            withdraw_reserve: &accounts[5],
            reserve_liquidity_mint: &accounts[6],
            reserve_source_collateral: &accounts[7],
            reserve_collateral_mint: &accounts[8],
            reserve_liquidity_supply: &accounts[9],
            user_destination_liquidity: &accounts[10],
            collateral_token_program: &accounts[11],
            liquidity_token_program: &accounts[12],
            instruction_sysvar_account: &accounts[13],
            obligation_farm_user_state: &accounts[14],
            reserve_farm_state: &accounts[15],
            farms_program: &accounts[16],
            scope_oracle: &accounts[17],
            reserve_accounts: &accounts[18..],
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
    let mut metas: [MaybeUninit<AccountMeta>; MAX] =
        unsafe { MaybeUninit::uninit().assume_init() };
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
        metas[count].write(AccountMeta::writable(r.key()));
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

#[allow(clippy::too_many_arguments)]
pub fn deposit_collateral<'a>(
    owner: &'a AccountInfo,
    obligation: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    lending_market_authority: &'a AccountInfo,
    reserve: &'a AccountInfo,
    reserve_liquidity_mint: &'a AccountInfo,
    reserve_liquidity_supply: &'a AccountInfo,
    reserve_collateral_mint: &'a AccountInfo,
    reserve_destination_deposit_collateral: &'a AccountInfo,
    user_source_liquidity: &'a AccountInfo,
    collateral_token_program: &'a AccountInfo,
    liquidity_token_program: &'a AccountInfo,
    instruction_sysvar_account: &'a AccountInfo,
    obligation_farm_user_state: &'a AccountInfo,
    reserve_farm_state: &'a AccountInfo,
    farms_program: &'a AccountInfo,
    kamino_lending_program: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_DEPOSIT_RESERVE_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (owner, AccountMeta::writable_signer(owner.key())),
            (obligation, AccountMeta::writable(obligation.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (
                lending_market_authority,
                AccountMeta::readonly(lending_market_authority.key()),
            ),
            (reserve, AccountMeta::writable(reserve.key())),
            (
                reserve_liquidity_mint,
                AccountMeta::readonly(reserve_liquidity_mint.key()),
            ),
            (
                reserve_liquidity_supply,
                AccountMeta::writable(reserve_liquidity_supply.key()),
            ),
            (
                reserve_collateral_mint,
                AccountMeta::writable(reserve_collateral_mint.key()),
            ),
            (
                reserve_destination_deposit_collateral,
                AccountMeta::writable(reserve_destination_deposit_collateral.key()),
            ),
            (
                user_source_liquidity,
                AccountMeta::writable(user_source_liquidity.key()),
            ),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (
                collateral_token_program,
                AccountMeta::readonly(collateral_token_program.key()),
            ),
            (
                liquidity_token_program,
                AccountMeta::readonly(liquidity_token_program.key()),
            ),
            (
                instruction_sysvar_account,
                AccountMeta::readonly(instruction_sysvar_account.key()),
            ),
            (
                obligation_farm_user_state,
                AccountMeta::writable(obligation_farm_user_state.key()),
            ),
            (
                reserve_farm_state,
                AccountMeta::writable(reserve_farm_state.key()),
            ),
            (farms_program, AccountMeta::readonly(farms_program.key())),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn borrow_from_reserve<'a>(
    owner: &'a AccountInfo,
    obligation: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    lending_market_authority: &'a AccountInfo,
    borrow_reserve: &'a AccountInfo,
    output_mint: &'a AccountInfo,
    reserve_borrow_supply: &'a AccountInfo,
    borrow_reserve_liquidity_fee_receiver: &'a AccountInfo,
    user_borrow_destination: &'a AccountInfo,
    token_program: &'a AccountInfo,
    instruction_sysvar_account: &'a AccountInfo,
    borrow_obligation_farm_state: &'a AccountInfo,
    borrow_reserve_farm_state: &'a AccountInfo,
    farms_program: &'a AccountInfo,
    kamino_lending_program: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_BORROW_OBLIGATION_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (owner, AccountMeta::readonly_signer(owner.key())),
            (obligation, AccountMeta::writable(obligation.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (
                lending_market_authority,
                AccountMeta::readonly(lending_market_authority.key()),
            ),
            (borrow_reserve, AccountMeta::writable(borrow_reserve.key())),
            (output_mint, AccountMeta::readonly(output_mint.key())),
            (
                reserve_borrow_supply,
                AccountMeta::writable(reserve_borrow_supply.key()),
            ),
            (
                borrow_reserve_liquidity_fee_receiver,
                AccountMeta::writable(borrow_reserve_liquidity_fee_receiver.key()),
            ),
            (
                user_borrow_destination,
                AccountMeta::writable(user_borrow_destination.key()),
            ),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (token_program, AccountMeta::readonly(token_program.key())),
            (
                instruction_sysvar_account,
                AccountMeta::readonly(instruction_sysvar_account.key()),
            ),
            (
                borrow_obligation_farm_state,
                AccountMeta::writable(borrow_obligation_farm_state.key()),
            ),
            (
                borrow_reserve_farm_state,
                AccountMeta::writable(borrow_reserve_farm_state.key()),
            ),
            (farms_program, AccountMeta::readonly(farms_program.key())),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn repay_debt<'a>(
    owner: &'a AccountInfo,
    obligation: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    borrow_reserve: &'a AccountInfo,
    output_mint: &'a AccountInfo,
    reserve_borrow_supply: &'a AccountInfo,
    user_source_liquidity: &'a AccountInfo,
    token_program: &'a AccountInfo,
    instruction_sysvar_account: &'a AccountInfo,
    borrow_obligation_farm_state: &'a AccountInfo,
    borrow_reserve_farm_state: &'a AccountInfo,
    lending_market_authority: &'a AccountInfo,
    farms_program: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_REPAY_OBLIGATION_LIQUIDITY_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (owner, AccountMeta::readonly_signer(owner.key())),
            (obligation, AccountMeta::writable(obligation.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (borrow_reserve, AccountMeta::writable(borrow_reserve.key())),
            (output_mint, AccountMeta::readonly(output_mint.key())),
            (
                reserve_borrow_supply,
                AccountMeta::writable(reserve_borrow_supply.key()),
            ),
            (
                user_source_liquidity,
                AccountMeta::writable(user_source_liquidity.key()),
            ),
            (token_program, AccountMeta::readonly(token_program.key())),
            (
                instruction_sysvar_account,
                AccountMeta::readonly(instruction_sysvar_account.key()),
            ),
            (
                borrow_obligation_farm_state,
                AccountMeta::writable(borrow_obligation_farm_state.key()),
            ),
            (
                borrow_reserve_farm_state,
                AccountMeta::writable(borrow_reserve_farm_state.key()),
            ),
            (
                lending_market_authority,
                AccountMeta::readonly(lending_market_authority.key()),
            ),
            (farms_program, AccountMeta::readonly(farms_program.key())),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn withdraw_collateral<'a>(
    owner: &'a AccountInfo,
    obligation: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    lending_market_authority: &'a AccountInfo,
    withdraw_reserve: &'a AccountInfo,
    reserve_liquidity_mint: &'a AccountInfo,
    reserve_source_collateral: &'a AccountInfo,
    reserve_collateral_mint: &'a AccountInfo,
    reserve_liquidity_supply: &'a AccountInfo,
    user_destination_liquidity: &'a AccountInfo,
    collateral_token_program: &'a AccountInfo,
    liquidity_token_program: &'a AccountInfo,
    instruction_sysvar_account: &'a AccountInfo,
    obligation_farm_user_state: &'a AccountInfo,
    reserve_farm_state: &'a AccountInfo,
    farms_program: &'a AccountInfo,
    kamino_lending_program: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 16];
    write_bytes(&mut data[0..8], &DISC_WITHDRAW_OBLIGATION_COLLATERAL_V2);
    write_bytes(&mut data[8..16], &amount.to_le_bytes());

    invoke_signed_with_accounts(
        &KAMINO_LEND_PROGRAM_ID,
        [
            (owner, AccountMeta::writable_signer(owner.key())),
            (obligation, AccountMeta::writable(obligation.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (
                lending_market_authority,
                AccountMeta::readonly(lending_market_authority.key()),
            ),
            (
                withdraw_reserve,
                AccountMeta::writable(withdraw_reserve.key()),
            ),
            (
                reserve_liquidity_mint,
                AccountMeta::readonly(reserve_liquidity_mint.key()),
            ),
            (
                reserve_source_collateral,
                AccountMeta::writable(reserve_source_collateral.key()),
            ),
            (
                reserve_collateral_mint,
                AccountMeta::writable(reserve_collateral_mint.key()),
            ),
            (
                reserve_liquidity_supply,
                AccountMeta::writable(reserve_liquidity_supply.key()),
            ),
            (
                user_destination_liquidity,
                AccountMeta::writable(user_destination_liquidity.key()),
            ),
            (
                kamino_lending_program,
                AccountMeta::readonly(kamino_lending_program.key()),
            ),
            (
                collateral_token_program,
                AccountMeta::readonly(collateral_token_program.key()),
            ),
            (
                liquidity_token_program,
                AccountMeta::readonly(liquidity_token_program.key()),
            ),
            (
                instruction_sysvar_account,
                AccountMeta::readonly(instruction_sysvar_account.key()),
            ),
            (
                obligation_farm_user_state,
                AccountMeta::writable(obligation_farm_user_state.key()),
            ),
            (
                reserve_farm_state,
                AccountMeta::writable(reserve_farm_state.key()),
            ),
            (farms_program, AccountMeta::readonly(farms_program.key())),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 16) },
        signers,
    )
}

impl<'info> Repay<'info> for Kamino {
    type Accounts = KaminoRepayAccounts<'info>;
    type Data = ();

    fn repay_signed(
        ctx: &Self::Accounts,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        refresh_reserve(
            ctx.collateral_reserve,
            ctx.lending_market,
            ctx.scope_oracle_collateral,
            ctx.kamino_lending_program,
        )?;
        refresh_reserve(
            ctx.borrow_reserve,
            ctx.lending_market,
            ctx.scope_oracle_borrow,
            ctx.kamino_lending_program,
        )?;

        let mut reserve_infos: [MaybeUninit<&AccountInfo>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let extra_count = ctx.reserve_accounts.len().min(16);
        for i in 0..extra_count {
            reserve_infos[i].write(&ctx.reserve_accounts[i]);
        }
        let reserve_slice: &[&AccountInfo] =
            unsafe { from_raw_parts(reserve_infos.as_ptr() as *const &AccountInfo, extra_count) };

        refresh_obligation_with_reserves(
            ctx.lending_market,
            ctx.obligation,
            reserve_slice,
            signer_seeds,
        )?;

        repay_debt(
            ctx.owner,
            ctx.obligation,
            ctx.lending_market,
            ctx.borrow_reserve,
            ctx.output_mint,
            ctx.reserve_borrow_supply,
            ctx.user_source_liquidity,
            ctx.token_program,
            ctx.instruction_sysvar_account,
            ctx.borrow_obligation_farm_state,
            ctx.borrow_reserve_farm_state,
            ctx.lending_market_authority,
            ctx.farms_program,
            amount,
            signer_seeds,
        )
    }
}

impl<'info> Withdraw<'info> for Kamino {
    type Accounts = KaminoWithdrawAccounts<'info>;
    type Data = ();

    fn withdraw_signed(
        ctx: &Self::Accounts,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        refresh_reserve(
            ctx.withdraw_reserve,
            ctx.lending_market,
            ctx.scope_oracle,
            ctx.kamino_lending_program,
        )?;

        for r in ctx.reserve_accounts {
            refresh_reserve(
                r,
                ctx.lending_market,
                ctx.scope_oracle,
                ctx.kamino_lending_program,
            )?;
        }

        let mut reserve_infos: [MaybeUninit<&AccountInfo>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let extra_count = ctx.reserve_accounts.len().min(16);
        for i in 0..extra_count {
            reserve_infos[i].write(&ctx.reserve_accounts[i]);
        }
        let reserve_slice: &[&AccountInfo] =
            unsafe { from_raw_parts(reserve_infos.as_ptr() as *const &AccountInfo, extra_count) };

        refresh_obligation_with_reserves(
            ctx.lending_market,
            ctx.obligation,
            reserve_slice,
            signer_seeds,
        )?;

        withdraw_collateral(
            ctx.owner,
            ctx.obligation,
            ctx.lending_market,
            ctx.lending_market_authority,
            ctx.withdraw_reserve,
            ctx.reserve_liquidity_mint,
            ctx.reserve_source_collateral,
            ctx.reserve_collateral_mint,
            ctx.reserve_liquidity_supply,
            ctx.user_destination_liquidity,
            ctx.collateral_token_program,
            ctx.liquidity_token_program,
            ctx.instruction_sysvar_account,
            ctx.obligation_farm_user_state,
            ctx.reserve_farm_state,
            ctx.farms_program,
            ctx.kamino_lending_program,
            amount,
            signer_seeds,
        )
    }
}

impl<'info> Deposit<'info> for Kamino {
    type Accounts = KaminoDepositAccounts<'info>;
    type Data = ();

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        refresh_reserve(
            ctx.reserve,
            ctx.lending_market,
            ctx.scope_oracle,
            ctx.kamino_lending_program,
        )?;

        for r in ctx.reserve_accounts {
            refresh_reserve(
                r,
                ctx.lending_market,
                ctx.scope_oracle,
                ctx.kamino_lending_program,
            )?;
        }

        let mut reserve_infos: [MaybeUninit<&AccountInfo>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let extra_count = ctx.reserve_accounts.len().min(16);
        for i in 0..extra_count {
            reserve_infos[i].write(&ctx.reserve_accounts[i]);
        }
        let reserve_slice: &[&AccountInfo] =
            unsafe { from_raw_parts(reserve_infos.as_ptr() as *const &AccountInfo, extra_count) };

        refresh_obligation_with_reserves(
            ctx.lending_market,
            ctx.obligation,
            reserve_slice,
            signer_seeds,
        )?;

        deposit_collateral(
            ctx.owner,
            ctx.obligation,
            ctx.lending_market,
            ctx.lending_market_authority,
            ctx.reserve,
            ctx.reserve_liquidity_mint,
            ctx.reserve_liquidity_supply,
            ctx.reserve_collateral_mint,
            ctx.reserve_destination_deposit_collateral,
            ctx.user_source_liquidity,
            ctx.collateral_token_program,
            ctx.liquidity_token_program,
            ctx.instruction_sysvar_account,
            ctx.obligation_farm_user_state,
            ctx.reserve_farm_state,
            ctx.farms_program,
            ctx.kamino_lending_program,
            amount,
            signer_seeds,
        )
    }
}

impl<'info> Borrow<'info> for Kamino {
    type Accounts = KaminoBorrowAccounts<'info>;
    type Data = ();

    fn borrow_signed(
        ctx: &Self::Accounts,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        refresh_reserve(
            ctx.collateral_reserve,
            ctx.lending_market,
            ctx.scope_oracle_collateral,
            ctx.kamino_lending_program,
        )?;

        refresh_reserve(
            ctx.borrow_reserve,
            ctx.lending_market,
            ctx.scope_oracle_borrow,
            ctx.kamino_lending_program,
        )?;

        let mut reserve_infos: [MaybeUninit<&AccountInfo>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let extra_count = ctx.reserve_accounts.len().min(16);
        for i in 0..extra_count {
            reserve_infos[i].write(&ctx.reserve_accounts[i]);
        }
        let reserve_slice: &[&AccountInfo] =
            unsafe { from_raw_parts(reserve_infos.as_ptr() as *const &AccountInfo, extra_count) };

        refresh_obligation_with_reserves(
            ctx.lending_market,
            ctx.obligation,
            reserve_slice,
            signer_seeds,
        )?;

        borrow_from_reserve(
            ctx.owner,
            ctx.obligation,
            ctx.lending_market,
            ctx.lending_market_authority,
            ctx.borrow_reserve,
            ctx.output_mint,
            ctx.reserve_borrow_supply,
            ctx.borrow_reserve_liquidity_fee_receiver,
            ctx.user_borrow_destination,
            ctx.token_program,
            ctx.instruction_sysvar_account,
            ctx.borrow_obligation_farm_state,
            ctx.borrow_reserve_farm_state,
            ctx.farms_program,
            ctx.kamino_lending_program,
            amount,
            signer_seeds,
        )
    }
}

use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub const KAMINO_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

const DISC_REFRESH_RESERVE: [u8; 8]    = [2, 218, 138, 235, 79, 201, 25, 102];
const DISC_REFRESH_OBLIGATION: [u8; 8] = [33, 132, 147, 228, 151, 192, 72, 89];
const DISC_REPAY_V2: [u8; 8]          = [116, 174, 213, 76, 180, 53, 210, 144];
const DISC_WITHDRAW_V2: [u8; 8]       = [235, 52, 119, 152, 149, 197, 20, 7];


fn cpi<'a, const N: usize>(
    program_id: &Pubkey,
    accounts: [(&'a AccountInfo, AccountMeta<'a>); N],
    data: &[u8],
) -> ProgramResult {
    let mut metas: [MaybeUninit<AccountMeta<'a>>; N] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&'a AccountInfo>; N] =
        unsafe { MaybeUninit::uninit().assume_init() };

    for (i, (info, meta)) in accounts.into_iter().enumerate() {
        metas[i].write(meta);
        infos[i].write(info);
    }

    let ix = Instruction {
        program_id,
        accounts: unsafe { from_raw_parts(metas.as_ptr() as *const AccountMeta<'a>, N) },
        data,
    };
    slice_invoke_signed(
        &ix,
        unsafe { from_raw_parts(infos.as_ptr() as *const &AccountInfo, N) },
        &[],
    )
}

#[inline(never)]
fn refresh_reserve<'a>(
    reserve: &'a AccountInfo,
    lending_market: &'a AccountInfo,
    scope_oracle: &'a AccountInfo,
    placeholder: &'a AccountInfo,
) -> ProgramResult {
    cpi(
        &KAMINO_PROGRAM_ID,
        [
            (reserve, AccountMeta::writable(reserve.key())),
            (lending_market, AccountMeta::readonly(lending_market.key())),
            (placeholder, AccountMeta::readonly(placeholder.key())),
            (placeholder, AccountMeta::readonly(placeholder.key())),
            (placeholder, AccountMeta::readonly(placeholder.key())),
            (scope_oracle, AccountMeta::readonly(scope_oracle.key())),
        ],
        &DISC_REFRESH_RESERVE,
    )
}

#[inline(never)]
fn refresh_obligation<'a>(
    lending_market: &'a AccountInfo,
    obligation: &'a AccountInfo,
    reserves: &[&'a AccountInfo],
) -> ProgramResult {
    const MAX: usize = 18; // 2 fixed + up to 16 reserve slots
    let count = 2 + reserves.len();
    if count > MAX {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut metas: [MaybeUninit<AccountMeta<'a>>; MAX] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&'a AccountInfo>; MAX] =
        unsafe { MaybeUninit::uninit().assume_init() };

    metas[0].write(AccountMeta::readonly(lending_market.key()));
    infos[0].write(lending_market);
    metas[1].write(AccountMeta::writable(obligation.key()));
    infos[1].write(obligation);
    for (i, r) in reserves.iter().enumerate() {
        metas[2 + i].write(AccountMeta::writable(r.key()));
        infos[2 + i].write(r);
    }

    let ix = Instruction {
        program_id: &KAMINO_PROGRAM_ID,
        accounts: unsafe { from_raw_parts(metas.as_ptr() as *const AccountMeta<'a>, count) },
        data: &DISC_REFRESH_OBLIGATION,
    };
    slice_invoke_signed(
        &ix,
        unsafe { from_raw_parts(infos.as_ptr() as *const &AccountInfo, count) },
        &[],
    )
}

/// Kamino repay account layout (17+ accounts):
///  [0]  kamino_program   (placeholder for oracle slots in refresh_reserve)
///  [1]  owner            (signer)
///  [2]  obligation
///  [3]  lending_market
///  [4]  lending_market_authority
///  [5]  collateral_reserve
///  [6]  borrow_reserve
///  [7]  reserve_liquidity_mint
///  [8]  reserve_supply_vault
///  [9]  user_source_liquidity
///  [10] token_program
///  [11] instruction_sysvar
///  [12] borrow_obligation_farm_state
///  [13] borrow_reserve_farm_state
///  [14] farms_program
///  [15] scope_oracle_collateral
///  [16] scope_oracle_borrow
///  [17..] extra reserves already in obligation (for refresh_obligation)
#[inline(never)]
pub fn repay(accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    if accounts.len() < 17 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let placeholder        = &accounts[0];
    let obligation         = &accounts[2];
    let lending_market     = &accounts[3];
    let collateral_reserve = &accounts[5];
    let borrow_reserve     = &accounts[6];
    let scope_oracle_col   = &accounts[15];
    let scope_oracle_bor   = &accounts[16];

    refresh_reserve(collateral_reserve, lending_market, scope_oracle_col, placeholder)?;
    refresh_reserve(borrow_reserve, lending_market, scope_oracle_bor, placeholder)?;

    let mut extra_buf: [MaybeUninit<&AccountInfo>; 16] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let extra_len = (accounts.len().saturating_sub(17)).min(16);
    for (i, a) in accounts[17..17 + extra_len].iter().enumerate() {
        extra_buf[i].write(a);
    }
    let extra = unsafe { from_raw_parts(extra_buf.as_ptr() as *const &AccountInfo, extra_len) };
    refresh_obligation(lending_market, obligation, extra)?;

    let mut data = [0u8; 16];
    data[..8].copy_from_slice(&DISC_REPAY_V2);
    data[8..].copy_from_slice(&amount.to_le_bytes());

    cpi(
        &KAMINO_PROGRAM_ID,
        [
            (&accounts[1], AccountMeta::readonly_signer(accounts[1].key())),
            (&accounts[2], AccountMeta::writable(accounts[2].key())),
            (&accounts[3], AccountMeta::readonly(accounts[3].key())),
            (&accounts[6], AccountMeta::writable(accounts[6].key())),
            (&accounts[7], AccountMeta::readonly(accounts[7].key())),
            (&accounts[8], AccountMeta::writable(accounts[8].key())),
            (&accounts[9], AccountMeta::writable(accounts[9].key())),
            (&accounts[10], AccountMeta::readonly(accounts[10].key())),
            (&accounts[11], AccountMeta::readonly(accounts[11].key())),
            (&accounts[12], AccountMeta::writable(accounts[12].key())),
            (&accounts[13], AccountMeta::writable(accounts[13].key())),
            (&accounts[4], AccountMeta::readonly(accounts[4].key())),
            (&accounts[14], AccountMeta::readonly(accounts[14].key())),
        ],
        &data,
    )
}

/// Kamino withdraw account layout (18+ accounts):
///  [0]  kamino_program
///  [1]  owner            (signer)
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
///  [13] instruction_sysvar
///  [14] obligation_farm_user_state
///  [15] reserve_farm_state
///  [16] farms_program
///  [17] scope_oracle
///  [18..] extra reserves still in obligation (for refresh_obligation)
#[inline(never)]
pub fn withdraw(accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    if accounts.len() < 18 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let placeholder      = &accounts[0];
    let obligation       = &accounts[2];
    let lending_market   = &accounts[3];
    let withdraw_reserve = &accounts[5];
    let scope_oracle     = &accounts[17];

    refresh_reserve(withdraw_reserve, lending_market, scope_oracle, placeholder)?;

    let mut extra_buf: [MaybeUninit<&AccountInfo>; 16] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let extra_len = (accounts.len().saturating_sub(18)).min(16);
    for (i, a) in accounts[18..18 + extra_len].iter().enumerate() {
        extra_buf[i].write(a);
    }
    let extra = unsafe { from_raw_parts(extra_buf.as_ptr() as *const &AccountInfo, extra_len) };
    refresh_obligation(lending_market, obligation, extra)?;

    let mut data = [0u8; 16];
    data[..8].copy_from_slice(&DISC_WITHDRAW_V2);
    data[8..].copy_from_slice(&amount.to_le_bytes());

    cpi(
        &KAMINO_PROGRAM_ID,
        [
            (&accounts[1], AccountMeta::writable_signer(accounts[1].key())),
            (&accounts[2], AccountMeta::writable(accounts[2].key())),
            (&accounts[3], AccountMeta::readonly(accounts[3].key())),
            (&accounts[4], AccountMeta::readonly(accounts[4].key())),
            (&accounts[5], AccountMeta::writable(accounts[5].key())),
            (&accounts[6], AccountMeta::readonly(accounts[6].key())),
            (&accounts[7], AccountMeta::writable(accounts[7].key())),
            (&accounts[8], AccountMeta::writable(accounts[8].key())),
            (&accounts[9], AccountMeta::writable(accounts[9].key())),
            (&accounts[10], AccountMeta::writable(accounts[10].key())),
            (placeholder, AccountMeta::readonly(placeholder.key())),
            (&accounts[11], AccountMeta::readonly(accounts[11].key())),
            (&accounts[12], AccountMeta::readonly(accounts[12].key())),
            (&accounts[13], AccountMeta::readonly(accounts[13].key())),
            (&accounts[14], AccountMeta::writable(accounts[14].key())),
            (&accounts[15], AccountMeta::writable(accounts[15].key())),
            (&accounts[16], AccountMeta::readonly(accounts[16].key())),
        ],
        &data,
    )
}

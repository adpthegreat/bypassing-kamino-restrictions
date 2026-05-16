use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    protocols::{
        juplend::{JupiterInitAccounts, JupiterLend, JupiterOperateAccounts},
        kamino::{
            Kamino, KaminoBorrowAccounts, KaminoDepositAccounts, KaminoInitAccounts,
            KaminoRepayAccounts, KaminoWithdrawAccounts,
        },
    },
    traits::{Borrow, Deposit, Initialize, Repay, Withdraw},
};

entrypoint!(process_instruction);


const INIT_KAMINO: u8          = 0;
const INIT_JUPITER_LEND: u8    = 1;
const DEPOSIT_KAMINO: u8       = 2;
const BORROW_KAMINO: u8        = 3;
const REPAY_KAMINO: u8         = 4;
const WITHDRAW_KAMINO: u8      = 5;
const DEPOSIT_JUPLEND: u8      = 6;
const BORROW_JUPLEND: u8       = 7;
const REPAY_JUPLEND: u8        = 8;
const WITHDRAW_JUPLEND: u8     = 9;
const REFINANCE_KAMINO_TO_JUP: u8 = 10;
const REFINANCE_JUP_TO_KAMINO: u8 = 11;

//  INIT_KAMINO          [mode: u8]
//  INIT_JUPITER_LEND    [vault_id: u16 LE][next_position_id: u32 LE]
//  DEPOSIT_KAMINO       [amount: u64 LE]
//  BORROW_KAMINO        [amount: u64 LE]
//  REPAY_KAMINO         [amount: u64 LE]
//  WITHDRAW_KAMINO      [amount: u64 LE]
//  DEPOSIT_JUPLEND      [amount: u64 LE][indices: [u8; 3]]
//  BORROW_JUPLEND       [amount: u64 LE][indices: [u8; 3]]
//  REPAY_JUPLEND        [amount: u64 LE][indices: [u8; 3]]
//  WITHDRAW_JUPLEND     [amount: u64 LE][indices: [u8; 3]]
//  REFINANCE_KAMINO_TO_JUP  [repay_len: u16][withdraw_len: u16][juplend_len: u16][indices: [u8; 3]
//  REFINANCE_JUP_TO_KAMINO  [juplend_len: u16][deposit_len: u16][borrow_len:  u16][indices: [u8; 3]

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let disc = instruction_data[0];
    let data = &instruction_data[1..];

    match disc {
        INIT_KAMINO          => process_init_kamino(accounts, data),
        INIT_JUPITER_LEND    => process_init_juplend(accounts, data),
        DEPOSIT_KAMINO       => process_deposit_kamino(accounts, data),
        BORROW_KAMINO        => process_borrow_kamino(accounts, data),
        REPAY_KAMINO         => process_repay_kamino(accounts, data),
        WITHDRAW_KAMINO      => process_withdraw_kamino(accounts, data),
        DEPOSIT_JUPLEND      => process_deposit_juplend(accounts, data),
        BORROW_JUPLEND       => process_borrow_juplend(accounts, data),
        REPAY_JUPLEND        => process_repay_juplend(accounts, data),
        WITHDRAW_JUPLEND     => process_withdraw_juplend(accounts, data),
        REFINANCE_KAMINO_TO_JUP => process_refinance_kamino_to_jup(accounts, data),
        REFINANCE_JUP_TO_KAMINO => process_refinance_jup_to_kamino(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_init_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mode = data[0];
    let ctx = KaminoInitAccounts::try_from(accounts)?;
    Kamino::initialize(&ctx, &mode)
}

fn process_deposit_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let ctx = KaminoDepositAccounts::try_from(accounts)?;
    Kamino::deposit(&ctx, amount, &())
}

fn process_borrow_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let ctx = KaminoBorrowAccounts::try_from(accounts)?;
    Kamino::borrow(&ctx, amount, &())
}

fn process_repay_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let ctx = KaminoRepayAccounts::try_from(accounts)?;
    Kamino::repay(&ctx, amount, &())
}

fn process_withdraw_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let ctx = KaminoWithdrawAccounts::try_from(accounts)?;
    Kamino::withdraw(&ctx, amount, &())
}


fn process_init_juplend(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let vault_id = u16::from_le_bytes(data[0..2].try_into().unwrap());
    let next_position_id = u32::from_le_bytes(data[2..6].try_into().unwrap());
    let ctx = JupiterInitAccounts::try_from(accounts)?;
    JupiterLend::initialize(&ctx, &(vault_id, next_position_id))
}

fn process_deposit_juplend(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 11 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let indices: [u8; 3] = data[8..11].try_into().unwrap();
    let ctx = JupiterOperateAccounts::try_from(accounts)?;
    JupiterLend::deposit(&ctx, amount, &indices)
}

fn process_borrow_juplend(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 11 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let indices: [u8; 3] = data[8..11].try_into().unwrap();
    let ctx = JupiterOperateAccounts::try_from(accounts)?;
    JupiterLend::borrow(&ctx, amount, &indices)
}

fn process_repay_juplend(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 11 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let indices: [u8; 3] = data[8..11].try_into().unwrap();
    let ctx = JupiterOperateAccounts::try_from(accounts)?;
    JupiterLend::repay(&ctx, amount, &indices)
}

fn process_withdraw_juplend(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 11 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let indices: [u8; 3] = data[8..11].try_into().unwrap();
    let ctx = JupiterOperateAccounts::try_from(accounts)?;
    JupiterLend::withdraw(&ctx, amount, &indices)
}


fn process_refinance_kamino_to_jup(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 25 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let kamino_repay_len    = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
    let kamino_withdraw_len = u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize;
    let juplend_len         = u16::from_le_bytes(data[4..6].try_into().unwrap()) as usize;
    let indices: [u8; 3]    = data[6..9].try_into().unwrap();
    let jup_deposit_amount  = u64::from_le_bytes(data[9..17].try_into().unwrap());
    let jup_borrow_amount   = u64::from_le_bytes(data[17..25].try_into().unwrap());

    let total = kamino_repay_len + kamino_withdraw_len + juplend_len;
    if accounts.len() < total {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let repay_accounts    = &accounts[0..kamino_repay_len];
    let withdraw_accounts = &accounts[kamino_repay_len..kamino_repay_len + kamino_withdraw_len];
    let juplend_accounts  = &accounts[kamino_repay_len + kamino_withdraw_len..total];

    let repay_ctx    = KaminoRepayAccounts::try_from(repay_accounts)?;
    let withdraw_ctx = KaminoWithdrawAccounts::try_from(withdraw_accounts)?;
    let juplend_ctx  = JupiterOperateAccounts::try_from(juplend_accounts)?;

    Kamino::repay(&repay_ctx, u64::MAX, &())?;
    Kamino::withdraw(&withdraw_ctx, u64::MAX, &())?;
    JupiterLend::deposit_and_borrow(&juplend_ctx, jup_deposit_amount, jup_borrow_amount, &indices)
}

fn process_refinance_jup_to_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 25 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let juplend_len           = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
    let kamino_deposit_len    = u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize;
    let kamino_borrow_len     = u16::from_le_bytes(data[4..6].try_into().unwrap()) as usize;
    let indices: [u8; 3]      = data[6..9].try_into().unwrap();
    let kamino_deposit_amount = u64::from_le_bytes(data[9..17].try_into().unwrap());
    let kamino_borrow_amount  = u64::from_le_bytes(data[17..25].try_into().unwrap());

    let total = juplend_len + kamino_deposit_len + kamino_borrow_len;
    if accounts.len() < total {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let juplend_accounts        = &accounts[0..juplend_len];
    let kamino_deposit_accounts = &accounts[juplend_len..juplend_len + kamino_deposit_len];
    let kamino_borrow_accounts  = &accounts[juplend_len + kamino_deposit_len..total];

    let juplend_ctx = JupiterOperateAccounts::try_from(juplend_accounts)?;
    let deposit_ctx = KaminoDepositAccounts::try_from(kamino_deposit_accounts)?;
    let borrow_ctx  = KaminoBorrowAccounts::try_from(kamino_borrow_accounts)?;

    JupiterLend::repay_and_withdraw(&juplend_ctx, u64::MAX, u64::MAX, &indices)?;
    Kamino::deposit(&deposit_ctx, kamino_deposit_amount, &())?;
    Kamino::borrow(&borrow_ctx, kamino_borrow_amount, &())
}

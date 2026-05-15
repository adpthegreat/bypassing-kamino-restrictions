use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    protocols::{
        juplend::{JupiterLend, JupiterOperateAccounts},
        kamino::{
            Kamino, KaminoBorrowAccounts, KaminoDepositAccounts, KaminoRepayAccounts,
            KaminoWithdrawAccounts,
        },
    },
    traits::{Borrow, Deposit, Repay, Withdraw},
};

entrypoint!(process_instruction);

/// Instruction data layout:
///   [0]     discriminant  u8   (0 = RefinanceKaminoToJupiter, 1 = RefinanceJupiterToKamino)
///   [1..3]  account_count_1   u16 LE
///   [3..5]  account_count_2   u16 LE
///   [5..7]  account_count_3   u16 LE
///   [7..10] juplend_indices   [u8; 3]
///
/// All amounts are implicitly u64::MAX (full position refinance).
///
/// RefinanceKaminoToJupiter counts:
///   account_count_1 = kamino_repay_account_count
///   account_count_2 = kamino_withdraw_account_count
///   account_count_3 = juplend_account_count
///
/// RefinanceJupiterToKamino counts:
///   account_count_1 = juplend_account_count
///   account_count_2 = kamino_deposit_account_count
///   account_count_3 = kamino_borrow_account_count
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let direction = instruction_data[0];
    let data = &instruction_data[1..];

    match direction {
        0 => process_kamino_to_jup(accounts, data),
        1 => process_jup_to_kamino(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_kamino_to_jup(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let kamino_repay_len = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
    let kamino_withdraw_len = u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize;
    let juplend_len = u16::from_le_bytes(data[4..6].try_into().unwrap()) as usize;
    let indices: [u8; 3] = data[6..9].try_into().unwrap();

    let total = kamino_repay_len + kamino_withdraw_len + juplend_len;
    if accounts.len() < total {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let repay_accounts = &accounts[0..kamino_repay_len];
    let withdraw_accounts = &accounts[kamino_repay_len..kamino_repay_len + kamino_withdraw_len];
    let juplend_accounts = &accounts[kamino_repay_len + kamino_withdraw_len..total];

    let repay_ctx = KaminoRepayAccounts::try_from(repay_accounts)?;
    let withdraw_ctx = KaminoWithdrawAccounts::try_from(withdraw_accounts)?;
    let juplend_ctx = JupiterOperateAccounts::try_from(juplend_accounts)?;

    Kamino::repay(&repay_ctx, u64::MAX, &())?;
    Kamino::withdraw(&withdraw_ctx, u64::MAX, &())?;
    JupiterLend::deposit_and_borrow(&juplend_ctx, u64::MAX, u64::MAX, &indices)
}

fn process_jup_to_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let juplend_len = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
    let kamino_deposit_len = u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize;
    let kamino_borrow_len = u16::from_le_bytes(data[4..6].try_into().unwrap()) as usize;
    let indices: [u8; 3] = data[6..9].try_into().unwrap();

    let total = juplend_len + kamino_deposit_len + kamino_borrow_len;
    if accounts.len() < total {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let juplend_accounts = &accounts[0..juplend_len];
    let kamino_deposit_accounts = &accounts[juplend_len..juplend_len + kamino_deposit_len];
    let kamino_borrow_accounts = &accounts[juplend_len + kamino_deposit_len..total];

    let juplend_ctx = JupiterOperateAccounts::try_from(juplend_accounts)?;
    let deposit_ctx = KaminoDepositAccounts::try_from(kamino_deposit_accounts)?;
    let borrow_ctx = KaminoBorrowAccounts::try_from(kamino_borrow_accounts)?;

    JupiterLend::repay_and_withdraw(&juplend_ctx, u64::MAX, u64::MAX, &indices)?;
    Kamino::deposit(&deposit_ctx, u64::MAX, &())?;
    Kamino::borrow(&borrow_ctx, u64::MAX, &())
}

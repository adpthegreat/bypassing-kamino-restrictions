use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    protocols::{juplend, kamino},
    refinance,
};

entrypoint!(process_instruction);

const INIT_KAMINO: u8 = 0;
const INIT_JUPITER_LEND: u8 = 1;
const DEPOSIT_KAMINO: u8 = 2;
const BORROW_KAMINO: u8 = 3;
const REPAY_KAMINO: u8 = 4;
const WITHDRAW_KAMINO: u8 = 5;
const DEPOSIT_JUPLEND: u8 = 6;
const BORROW_JUPLEND: u8 = 7;
const REPAY_JUPLEND: u8 = 8;
const WITHDRAW_JUPLEND: u8 = 9;
const REFINANCE_KAMINO_TO_JUP: u8 = 10;
const REFINANCE_JUP_TO_KAMINO: u8 = 11;

//  INIT_KAMINO          [mode: u8]
//  INIT_JUPITER_LEND    [vault_id: u16 LE][next_position_id: u32 LE]
//  DEPOSIT_KAMINO       [amount: u64 LE][flags: u8]
//  BORROW_KAMINO        [amount: u64 LE][flags: u8]
//  REPAY_KAMINO         [amount: u64 LE][flags: u8]
//  WITHDRAW_KAMINO      [amount: u64 LE][flags: u8]
//  DEPOSIT_JUPLEND      [amount: u64 LE][indices: [u8; 3]]
//  BORROW_JUPLEND       [amount: u64 LE][indices: [u8; 3]]
//  REPAY_JUPLEND        [amount: u64 LE][indices: [u8; 3]]
//  WITHDRAW_JUPLEND     [amount: u64 LE][indices: [u8; 3]]
//  REFINANCE_KAMINO_TO_JUP  [repay_len: u16][withdraw_len: u16][juplend_len: u16][repay_flags: u8][withdraw_flags: u8][indices: [u8; 3]][jup_col: u64][jup_debt: u64]
//  REFINANCE_JUP_TO_KAMINO  [juplend_len: u16][deposit_len: u16][borrow_len: u16][deposit_flags: u8][borrow_flags: u8][indices: [u8; 3]][kamino_col: u64][kamino_debt: u64]

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
        INIT_KAMINO => kamino::processor::process_init(accounts, data),
        INIT_JUPITER_LEND => juplend::processor::process_init(accounts, data),
        DEPOSIT_KAMINO => kamino::processor::process_deposit(accounts, data),
        BORROW_KAMINO => kamino::processor::process_borrow(accounts, data),
        REPAY_KAMINO => kamino::processor::process_repay(accounts, data),
        WITHDRAW_KAMINO => kamino::processor::process_withdraw(accounts, data),
        DEPOSIT_JUPLEND => juplend::processor::process_deposit(accounts, data),
        BORROW_JUPLEND => juplend::processor::process_borrow(accounts, data),
        REPAY_JUPLEND => juplend::processor::process_repay(accounts, data),
        WITHDRAW_JUPLEND => juplend::processor::process_withdraw(accounts, data),
        REFINANCE_KAMINO_TO_JUP => refinance::process_kamino_to_jupiter(accounts, data),
        REFINANCE_JUP_TO_KAMINO => refinance::process_jupiter_to_kamino(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

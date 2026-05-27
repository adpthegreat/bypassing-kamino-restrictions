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
const DEPOSIT_AND_BORROW_JUPLEND: u8 = 6;
const REPAY_AND_WITHDRAW_JUPLEND: u8 = 7;
const REFINANCE_KAMINO_TO_JUP: u8 = 10;
const REFINANCE_JUP_TO_KAMINO: u8 = 11;

//  INIT_KAMINO          [mode: u8]
//  INIT_JUPITER_LEND    [vault_id: u16 LE][next_position_id: u32 LE]
//  DEPOSIT_KAMINO       [amount: u64 LE][flags: u8]
//  BORROW_KAMINO        [amount: u64 LE][flags: u8]
//  REPAY_KAMINO         [amount: u64 LE][flags: u8]
//  WITHDRAW_KAMINO      [amount: u64 LE][flags: u8]
//  DEPOSIT_AND_BORROW_JUPLEND [deposit_amount: u64 LE][borrow_amount: u64 LE][indices: [u8; 3]]
//  REPAY_AND_WITHDRAW_JUPLEND [withdraw_amount: u64 LE][repay_amount: u64 LE][indices: [u8; 3]]
//  REFINANCE_KAMINO_TO_JUP  [source_repay: u64][source_withdraw: u64][destination_deposit: u64][destination_borrow: u64][kamino_has_collateral_or_borrow_flag: u8][indices: [u8; 3]]
//  REFINANCE_JUP_TO_KAMINO  [source_repay: u64][source_withdraw: u64][destination_deposit: u64][destination_borrow: u64][kamino_has_collateral_or_borrow_flag: u8][indices: [u8; 3]]

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

        DEPOSIT_AND_BORROW_JUPLEND => {
            juplend::processor::process_deposit_and_borrow(accounts, data)
        }
        REPAY_AND_WITHDRAW_JUPLEND => {
            juplend::processor::process_repay_and_withdraw(accounts, data)
        }

        REFINANCE_KAMINO_TO_JUP => refinance::process_kamino_to_jupiter(accounts, data),
        REFINANCE_JUP_TO_KAMINO => refinance::process_jupiter_to_kamino(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

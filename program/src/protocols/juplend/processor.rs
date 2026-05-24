use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::traits::{Borrow, Deposit, Initialize, Repay, Withdraw};

use super::{
    data::{JupiterInitData, JupiterOperateData},
    JupiterInitAccounts, JupiterLend, JupiterOperateAccounts,
};

pub struct InitJupiter<'a> {
    pub accounts: JupiterInitAccounts<'a>,
    pub data: JupiterInitData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for InitJupiter<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = JupiterInitData::try_from(raw_data)?;
        let accounts = JupiterInitAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl InitJupiter<'_> {
    fn process(&self) -> ProgramResult {
        JupiterLend::initialize(
            &self.accounts,
            &(self.data.vault_id, self.data.next_position_id),
        )
    }
}

pub struct OperateJupiter<'a> {
    pub accounts: JupiterOperateAccounts<'a>,
    pub data: JupiterOperateData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for OperateJupiter<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = JupiterOperateData::try_from(raw_data)?;
        let accounts = JupiterOperateAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

pub fn process_init(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    InitJupiter::try_from((data, accounts))?.process()
}

pub fn process_deposit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::deposit(&ix.accounts, ix.data.amount, &ix.data.indices)
}

pub fn process_borrow(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::borrow(&ix.accounts, ix.data.amount, &ix.data.indices)
}

pub fn process_repay(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::repay(&ix.accounts, ix.data.amount, &ix.data.indices)
}

pub fn process_withdraw(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::withdraw(&ix.accounts, ix.data.amount, &ix.data.indices)
}

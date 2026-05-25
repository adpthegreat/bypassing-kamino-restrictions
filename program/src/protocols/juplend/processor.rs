use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::traits::Initialize;

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

pub fn process_deposit_and_borrow(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::deposit_and_borrow(
        &ix.accounts,
        ix.data.collateral_amount,
        ix.data.debt_amount,
        &ix.data.indices,
    )
}

pub fn process_repay_and_withdraw(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = OperateJupiter::try_from((data, accounts))?;
    JupiterLend::repay_and_withdraw(
        &ix.accounts,
        ix.data.debt_amount,
        ix.data.collateral_amount,
        &ix.data.indices,
    )
}

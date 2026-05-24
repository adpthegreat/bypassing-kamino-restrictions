use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::traits::{Borrow, Deposit, Initialize, Repay, Withdraw};

use super::{
    data::{KaminoActionData, KaminoInitData},
    Kamino, KaminoBorrowAccounts, KaminoDepositAccounts, KaminoInitAccounts, KaminoRepayAccounts,
    KaminoWithdrawAccounts,
};

pub struct InitKamino<'a> {
    pub accounts: KaminoInitAccounts<'a>,
    pub data: KaminoInitData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for InitKamino<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = KaminoInitData::try_from(raw_data)?;
        let accounts = KaminoInitAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl InitKamino<'_> {
    fn process(&self) -> ProgramResult {
        Kamino::initialize(&self.accounts, &self.data.mode)
    }
}

pub struct DepositKamino<'a> {
    pub accounts: KaminoDepositAccounts<'a>,
    pub data: KaminoActionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for DepositKamino<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = KaminoActionData::try_from(raw_data)?;
        let accounts = KaminoDepositAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl DepositKamino<'_> {
    fn process(&self) -> ProgramResult {
        Kamino::deposit(&self.accounts, self.data.amount, &self.data.flags)
    }
}

pub struct BorrowKamino<'a> {
    pub accounts: KaminoBorrowAccounts<'a>,
    pub data: KaminoActionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for BorrowKamino<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = KaminoActionData::try_from(raw_data)?;
        let accounts = KaminoBorrowAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl BorrowKamino<'_> {
    fn process(&self) -> ProgramResult {
        Kamino::borrow(&self.accounts, self.data.amount, &self.data.flags)
    }
}

pub struct RepayKamino<'a> {
    pub accounts: KaminoRepayAccounts<'a>,
    pub data: KaminoActionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for RepayKamino<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = KaminoActionData::try_from(raw_data)?;
        let accounts = KaminoRepayAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl RepayKamino<'_> {
    fn process(&self) -> ProgramResult {
        Kamino::repay(&self.accounts, self.data.amount, &self.data.flags)
    }
}

pub struct WithdrawKamino<'a> {
    pub accounts: KaminoWithdrawAccounts<'a>,
    pub data: KaminoActionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for WithdrawKamino<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = KaminoActionData::try_from(raw_data)?;
        let accounts = KaminoWithdrawAccounts::try_from_slice(accounts)?;
        Ok(Self { accounts, data })
    }
}

impl WithdrawKamino<'_> {
    fn process(&self) -> ProgramResult {
        Kamino::withdraw(&self.accounts, self.data.amount, &self.data.flags)
    }
}

pub fn process_init(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    InitKamino::try_from((data, accounts))?.process()
}

pub fn process_deposit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    DepositKamino::try_from((data, accounts))?.process()
}

pub fn process_borrow(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    BorrowKamino::try_from((data, accounts))?.process()
}

pub fn process_repay(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    RepayKamino::try_from((data, accounts))?.process()
}

pub fn process_withdraw(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    WithdrawKamino::try_from((data, accounts))?.process()
}

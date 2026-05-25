#![allow(dead_code)]
use pinocchio::{instruction::Signer, ProgramResult};

pub trait Initialize<'info> {
    type Accounts;
    type Data;

    fn initialize(ctx: &Self::Accounts, data: &Self::Data) -> ProgramResult {
        Self::initialize_signed(ctx, data, &[])
    }

    fn initialize_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

pub trait Deposit<'info> {
    type Accounts;
    type Data;

    fn deposit(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

pub trait Withdraw<'info> {
    type Accounts;
    type Data;

    fn withdraw(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::withdraw_signed(ctx, amount, data, &[])
    }

    fn withdraw_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

pub trait Borrow<'info> {
    type Accounts;
    type Data;

    fn borrow(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::borrow_signed(ctx, amount, data, &[])
    }

    fn borrow_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

pub trait Repay<'info> {
    type Accounts;
    type Data;

    fn repay(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::repay_signed(ctx, amount, data, &[])
    }

    fn repay_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;
}

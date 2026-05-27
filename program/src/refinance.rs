use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::{
    protocols::{
        juplend::{JupiterLend, JupiterOperateAccounts},
        kamino::{
            Kamino, KaminoBorrowAccounts, KaminoDepositAccounts, KaminoRepayAccounts,
            KaminoWithdrawAccounts, FLAG_HAS_BORROWS, FLAG_HAS_COLLATERAL, KAMINO_LEND_PROGRAM_ID,
        },
    },
    traits::{Borrow, Deposit, Repay, Withdraw},
};

const JUPITER_OPERATE_FIXED_ACCOUNTS: usize = 36;

pub struct RefinanceData {
    // Debt to repay on the source venue.
    pub source_repay_amount: u64,
    // Collateral to withdraw from the source venue.
    pub source_withdraw_amount: u64,
    // Collateral to be deposited into the destination venue.
    pub destination_deposit_amount: u64,
    // Debt to be borrowed from the destination venue.
    pub destination_borrow_amount: u64,
    // Kamino refresh-obligation state flag.
    pub kamino_has_collateral_or_borrow_flag: u8,
    pub jupiter_indices: [u8; 3],
}

impl TryFrom<&[u8]> for RefinanceData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 36 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            source_repay_amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            source_withdraw_amount: u64::from_le_bytes(data[8..16].try_into().unwrap()),
            destination_deposit_amount: u64::from_le_bytes(data[16..24].try_into().unwrap()),
            destination_borrow_amount: u64::from_le_bytes(data[24..32].try_into().unwrap()),
            kamino_has_collateral_or_borrow_flag: data[32],
            jupiter_indices: data[33..36].try_into().unwrap(),
        })
    }
}

pub struct KaminoAccounts<'a> {
    pub kamino_lending_program: &'a AccountInfo,
    pub owner: &'a AccountInfo,
    pub obligation: &'a AccountInfo,
    pub lending_market: &'a AccountInfo,
    pub lending_market_authority: &'a AccountInfo,

    pub collateral_reserve: &'a AccountInfo,
    pub collateral_reserve_liquidity_mint: &'a AccountInfo,
    pub collateral_reserve_liquidity_supply: &'a AccountInfo,
    pub collateral_reserve_collateral_mint: &'a AccountInfo,
    pub collateral_reserve_collateral_supply: &'a AccountInfo,
    pub user_collateral_liquidity: &'a AccountInfo,
    pub collateral_token_program: &'a AccountInfo,
    pub liquidity_token_program: &'a AccountInfo,
    pub instruction_sysvar_account: &'a AccountInfo,
    pub collateral_obligation_farm_state: &'a AccountInfo,
    pub collateral_reserve_farm_state: &'a AccountInfo,
    pub farms_program: &'a AccountInfo,
    pub collateral_scope_oracle: &'a AccountInfo,

    pub debt_reserve: &'a AccountInfo,
    pub debt_reserve_liquidity_mint: &'a AccountInfo,
    pub debt_reserve_liquidity_supply: &'a AccountInfo,
    pub debt_reserve_liquidity_fee_receiver: &'a AccountInfo,
    pub user_debt_liquidity: &'a AccountInfo,
    pub debt_token_program: &'a AccountInfo,
    pub debt_obligation_farm_state: &'a AccountInfo,
    pub debt_reserve_farm_state: &'a AccountInfo,
    pub debt_scope_oracle: &'a AccountInfo,

    pub reserve_accounts: &'a [AccountInfo],
}

impl<'a> KaminoAccounts<'a> {
    pub fn try_from_slice(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, collateral_reserve, collateral_reserve_liquidity_mint, collateral_reserve_liquidity_supply, collateral_reserve_collateral_mint, collateral_reserve_collateral_supply, user_collateral_liquidity, collateral_token_program, liquidity_token_program, instruction_sysvar_account, collateral_obligation_farm_state, collateral_reserve_farm_state, farms_program, collateral_scope_oracle, debt_reserve, debt_reserve_liquidity_mint, debt_reserve_liquidity_supply, debt_reserve_liquidity_fee_receiver, user_debt_liquidity, debt_token_program, debt_obligation_farm_state, debt_reserve_farm_state, debt_scope_oracle, reserve_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            kamino_lending_program,
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            collateral_reserve,
            collateral_reserve_liquidity_mint,
            collateral_reserve_liquidity_supply,
            collateral_reserve_collateral_mint,
            collateral_reserve_collateral_supply,
            user_collateral_liquidity,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
            collateral_obligation_farm_state,
            collateral_reserve_farm_state,
            farms_program,
            collateral_scope_oracle,
            debt_reserve,
            debt_reserve_liquidity_mint,
            debt_reserve_liquidity_supply,
            debt_reserve_liquidity_fee_receiver,
            user_debt_liquidity,
            debt_token_program,
            debt_obligation_farm_state,
            debt_reserve_farm_state,
            debt_scope_oracle,
            reserve_accounts,
        })
    }

    fn deposit_accounts(&self) -> KaminoDepositAccounts<'_> {
        KaminoDepositAccounts {
            kamino_lending_program: self.kamino_lending_program,
            owner: self.owner,
            obligation: self.obligation,
            lending_market: self.lending_market,
            lending_market_authority: self.lending_market_authority,
            reserve: self.collateral_reserve,
            reserve_liquidity_mint: self.collateral_reserve_liquidity_mint,
            reserve_liquidity_supply: self.collateral_reserve_liquidity_supply,
            reserve_collateral_mint: self.collateral_reserve_collateral_mint,
            reserve_destination_deposit_collateral: self.collateral_reserve_collateral_supply,
            user_source_liquidity: self.user_collateral_liquidity,
            collateral_token_program: self.collateral_token_program,
            liquidity_token_program: self.liquidity_token_program,
            instruction_sysvar_account: self.instruction_sysvar_account,
            obligation_farm_user_state: self.collateral_obligation_farm_state,
            reserve_farm_state: self.collateral_reserve_farm_state,
            farms_program: self.farms_program,
            scope_oracle: self.collateral_scope_oracle,
            borrow_reserve: self.debt_reserve,
            scope_oracle_borrow: self.debt_scope_oracle,
            reserve_accounts: self.reserve_accounts,
        }
    }

    fn withdraw_accounts(&self) -> KaminoWithdrawAccounts<'_> {
        KaminoWithdrawAccounts {
            kamino_lending_program: self.kamino_lending_program,
            owner: self.owner,
            obligation: self.obligation,
            lending_market: self.lending_market,
            lending_market_authority: self.lending_market_authority,
            withdraw_reserve: self.collateral_reserve,
            reserve_liquidity_mint: self.collateral_reserve_liquidity_mint,
            reserve_source_collateral: self.collateral_reserve_collateral_supply,
            reserve_collateral_mint: self.collateral_reserve_collateral_mint,
            reserve_liquidity_supply: self.collateral_reserve_liquidity_supply,
            user_destination_liquidity: self.user_collateral_liquidity,
            collateral_token_program: self.collateral_token_program,
            liquidity_token_program: self.liquidity_token_program,
            instruction_sysvar_account: self.instruction_sysvar_account,
            obligation_farm_user_state: self.collateral_obligation_farm_state,
            reserve_farm_state: self.collateral_reserve_farm_state,
            farms_program: self.farms_program,
            scope_oracle: self.collateral_scope_oracle,
            borrow_reserve: self.debt_reserve,
            scope_oracle_borrow: self.debt_scope_oracle,
            reserve_accounts: self.reserve_accounts,
        }
    }

    fn repay_accounts(&self) -> KaminoRepayAccounts<'_> {
        KaminoRepayAccounts {
            kamino_lending_program: self.kamino_lending_program,
            owner: self.owner,
            obligation: self.obligation,
            lending_market: self.lending_market,
            lending_market_authority: self.lending_market_authority,
            collateral_reserve: self.collateral_reserve,
            borrow_reserve: self.debt_reserve,
            output_mint: self.debt_reserve_liquidity_mint,
            reserve_borrow_supply: self.debt_reserve_liquidity_supply,
            user_source_liquidity: self.user_debt_liquidity,
            token_program: self.debt_token_program,
            instruction_sysvar_account: self.instruction_sysvar_account,
            borrow_obligation_farm_state: self.debt_obligation_farm_state,
            borrow_reserve_farm_state: self.debt_reserve_farm_state,
            farms_program: self.farms_program,
            scope_oracle_collateral: self.collateral_scope_oracle,
            scope_oracle_borrow: self.debt_scope_oracle,
            reserve_accounts: self.reserve_accounts,
        }
    }

    fn borrow_accounts(&self) -> KaminoBorrowAccounts<'_> {
        KaminoBorrowAccounts {
            kamino_lending_program: self.kamino_lending_program,
            owner: self.owner,
            obligation: self.obligation,
            lending_market: self.lending_market,
            lending_market_authority: self.lending_market_authority,
            collateral_reserve: self.collateral_reserve,
            borrow_reserve: self.debt_reserve,
            output_mint: self.debt_reserve_liquidity_mint,
            reserve_borrow_supply: self.debt_reserve_liquidity_supply,
            borrow_reserve_liquidity_fee_receiver: self.debt_reserve_liquidity_fee_receiver,
            user_borrow_destination: self.user_debt_liquidity,
            token_program: self.debt_token_program,
            instruction_sysvar_account: self.instruction_sysvar_account,
            borrow_obligation_farm_state: self.debt_obligation_farm_state,
            borrow_reserve_farm_state: self.debt_reserve_farm_state,
            farms_program: self.farms_program,
            scope_oracle_collateral: self.collateral_scope_oracle,
            scope_oracle_borrow: self.debt_scope_oracle,
            reserve_accounts: self.reserve_accounts,
        }
    }
}

pub struct RefinanceAccounts<'a> {
    pub juplend_accounts: JupiterOperateAccounts<'a>,
    pub kamino_accounts: KaminoAccounts<'a>,
}

impl<'a> RefinanceAccounts<'a> {
    fn try_from_slice(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < JUPITER_OPERATE_FIXED_ACCOUNTS {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        // Jupiter has 36 fixed accounts; only scan its variable remaining accounts for the Kamino boundary.
        let kamino_start = accounts[JUPITER_OPERATE_FIXED_ACCOUNTS..]
            .iter()
            .position(|account| account.key() == &KAMINO_LEND_PROGRAM_ID)
            .map(|offset| JUPITER_OPERATE_FIXED_ACCOUNTS + offset)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;

        let (juplend_slice, kamino_slice) = accounts.split_at(kamino_start);

        Ok(Self {
            juplend_accounts: JupiterOperateAccounts::try_from_slice(juplend_slice)?,
            kamino_accounts: KaminoAccounts::try_from_slice(kamino_slice)?,
        })
    }
}

pub struct Refinance<'a> {
    pub accounts: RefinanceAccounts<'a>,
    pub data: RefinanceData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountInfo])> for Refinance<'a> {
    type Error = ProgramError;

    fn try_from((raw_data, accounts): (&'a [u8], &'a [AccountInfo])) -> Result<Self, Self::Error> {
        let data = RefinanceData::try_from(raw_data)?;
        let accounts = RefinanceAccounts::try_from_slice(accounts)?;

        Ok(Self { accounts, data })
    }
}

impl Refinance<'_> {
    fn process_kamino_to_jupiter(&self) -> ProgramResult {
        let repay_accounts = self.accounts.kamino_accounts.repay_accounts();
        let withdraw_accounts = self.accounts.kamino_accounts.withdraw_accounts();
        let withdraw_flag = if self.data.source_repay_amount == u64::MAX {
            self.data.kamino_has_collateral_or_borrow_flag & !FLAG_HAS_BORROWS
        } else {
            self.data.kamino_has_collateral_or_borrow_flag
        };

        Kamino::repay(
            &repay_accounts,
            self.data.source_repay_amount,
            &self.data.kamino_has_collateral_or_borrow_flag,
        )?;

        Kamino::withdraw(
            &withdraw_accounts,
            self.data.source_withdraw_amount,
            &withdraw_flag,
        )?;

        JupiterLend::deposit_and_borrow(
            &self.accounts.juplend_accounts,
            self.data.destination_deposit_amount,
            self.data.destination_borrow_amount,
            &self.data.jupiter_indices,
        )
    }

    fn process_jupiter_to_kamino(&self) -> ProgramResult {
        let deposit_accounts = self.accounts.kamino_accounts.deposit_accounts();
        let borrow_accounts = self.accounts.kamino_accounts.borrow_accounts();
        let deposit_flag = self.data.kamino_has_collateral_or_borrow_flag;
        let borrow_flag = deposit_flag | FLAG_HAS_COLLATERAL;

        JupiterLend::repay_and_withdraw(
            &self.accounts.juplend_accounts,
            self.data.source_repay_amount,
            self.data.source_withdraw_amount,
            &self.data.jupiter_indices,
        )?;

        Kamino::deposit(
            &deposit_accounts,
            self.data.destination_deposit_amount,
            &deposit_flag,
        )?;
        Kamino::borrow(
            &borrow_accounts,
            self.data.destination_borrow_amount,
            &borrow_flag,
        )
    }
}

pub fn process_kamino_to_jupiter(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    Refinance::try_from((data, accounts))?.process_kamino_to_jupiter()
}

pub fn process_jupiter_to_kamino(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    Refinance::try_from((data, accounts))?.process_jupiter_to_kamino()
}

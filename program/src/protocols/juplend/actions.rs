use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    protocols::{invoke_signed_with_accounts, invoke_signed_with_count},
    traits::{Borrow, Deposit, Initialize, Repay, Withdraw},
    write_bytes, UNINIT_BYTE,
};

pub const JUP_LEND_VAULTS_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi");

const DISC_INIT_POSITION: [u8; 8] = [197, 20, 10, 1, 97, 160, 177, 91];
const DISC_OPERATE: [u8; 8]       = [217, 106, 208, 99, 116, 151, 42, 135];

pub struct JupiterLend;


/// Accounts required to init a Jupiter Lend position (14 accounts):
///  [0]  vaults_program
///  [1]  signer
///  [2]  vault_admin
///  [3]  vault_state
///  [4]  position
///  [5]  position_mint
///  [6]  position_token_account
///  [7]  metadata_account
///  [8]  token_program
///  [9]  associated_token_program
///  [10] system_program
///  [11] sysvar_instruction
///  [12] metadata_program
///  [13] rent
pub struct JupiterInitAccounts<'info> {
    pub vaults_program: &'info AccountInfo,
    pub signer: &'info AccountInfo,
    pub vault_admin: &'info AccountInfo,
    pub vault_state: &'info AccountInfo,
    pub position: &'info AccountInfo,
    pub position_mint: &'info AccountInfo,
    pub position_token_account: &'info AccountInfo,
    pub metadata_account: &'info AccountInfo,
    pub token_program: &'info AccountInfo,
    pub associated_token_program: &'info AccountInfo,
    pub system_program: &'info AccountInfo,
    pub sysvar_instruction: &'info AccountInfo,
    pub metadata_program: &'info AccountInfo,
    pub rent: &'info AccountInfo,
}

impl<'info> TryFrom<&'info [AccountInfo]> for JupiterInitAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 14 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            vaults_program: &accounts[0],
            signer: &accounts[1],
            vault_admin: &accounts[2],
            vault_state: &accounts[3],
            position: &accounts[4],
            position_mint: &accounts[5],
            position_token_account: &accounts[6],
            metadata_account: &accounts[7],
            token_program: &accounts[8],
            associated_token_program: &accounts[9],
            system_program: &accounts[10],
            sysvar_instruction: &accounts[11],
            metadata_program: &accounts[12],
            rent: &accounts[13],
        })
    }
}


/// Accounts for Jupiter Lend operate (36+ accounts):
///  [0]  vaults_program   – placeholder; not forwarded to CPI
///  [1]  signer
///  [2]  signer_supply_token_account
///  [3]  signer_borrow_token_account
///  [4]  recipient
///  [5]  recipient_borrow_token_account
///  [6]  recipient_supply_token_account
///  [7]  vault_config
///  [8]  vault_state
///  [9]  supply_token
///  [10] borrow_token
///  [11] oracle
///  [12] position
///  [13] position_token_account
///  [14] current_position_tick
///  [15] final_position_tick
///  [16] current_position_tick_id
///  [17] final_position_tick_id
///  [18] new_branch
///  [19] supply_token_reserves_liquidity
///  [20] borrow_token_reserves_liquidity
///  [21] vault_supply_position_on_liquidity
///  [22] vault_borrow_position_on_liquidity
///  [23] supply_rate_model
///  [24] borrow_rate_model
///  [25] vault_supply_token_account
///  [26] vault_borrow_token_account
///  [27] supply_token_claim_account
///  [28] borrow_token_claim_account
///  [29] liquidity
///  [30] liquidity_program
///  [31] oracle_program
///  [32] supply_token_program
///  [33] borrow_token_program
///  [34] associated_token_program
///  [35] system_program
///  [36..] remaining_accounts
pub struct JupiterOperateAccounts<'info> {
    pub vaults_program: &'info AccountInfo,
    pub signer: &'info AccountInfo,
    pub signer_supply_token_account: &'info AccountInfo,
    pub signer_borrow_token_account: &'info AccountInfo,
    pub recipient: &'info AccountInfo,
    pub recipient_borrow_token_account: &'info AccountInfo,
    pub recipient_supply_token_account: &'info AccountInfo,
    pub vault_config: &'info AccountInfo,
    pub vault_state: &'info AccountInfo,
    pub supply_token: &'info AccountInfo,
    pub borrow_token: &'info AccountInfo,
    pub oracle: &'info AccountInfo,
    pub position: &'info AccountInfo,
    pub position_token_account: &'info AccountInfo,
    pub current_position_tick: &'info AccountInfo,
    pub final_position_tick: &'info AccountInfo,
    pub current_position_tick_id: &'info AccountInfo,
    pub final_position_tick_id: &'info AccountInfo,
    pub new_branch: &'info AccountInfo,
    pub supply_token_reserves_liquidity: &'info AccountInfo,
    pub borrow_token_reserves_liquidity: &'info AccountInfo,
    pub vault_supply_position_on_liquidity: &'info AccountInfo,
    pub vault_borrow_position_on_liquidity: &'info AccountInfo,
    pub supply_rate_model: &'info AccountInfo,
    pub borrow_rate_model: &'info AccountInfo,
    pub vault_supply_token_account: &'info AccountInfo,
    pub vault_borrow_token_account: &'info AccountInfo,
    pub supply_token_claim_account: &'info AccountInfo,
    pub borrow_token_claim_account: &'info AccountInfo,
    pub liquidity: &'info AccountInfo,
    pub liquidity_program: &'info AccountInfo,
    pub oracle_program: &'info AccountInfo,
    pub supply_token_program: &'info AccountInfo,
    pub borrow_token_program: &'info AccountInfo,
    pub associated_token_program: &'info AccountInfo,
    pub system_program: &'info AccountInfo,
    pub remaining_accounts: &'info [AccountInfo],
}

impl<'info> TryFrom<&'info [AccountInfo]> for JupiterOperateAccounts<'info> {
    type Error = ProgramError;
    fn try_from(accounts: &'info [AccountInfo]) -> Result<Self, Self::Error> {
        if accounts.len() < 36 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Ok(Self {
            vaults_program: &accounts[0],
            signer: &accounts[1],
            signer_supply_token_account: &accounts[2],
            signer_borrow_token_account: &accounts[3],
            recipient: &accounts[4],
            recipient_borrow_token_account: &accounts[5],
            recipient_supply_token_account: &accounts[6],
            vault_config: &accounts[7],
            vault_state: &accounts[8],
            supply_token: &accounts[9],
            borrow_token: &accounts[10],
            oracle: &accounts[11],
            position: &accounts[12],
            position_token_account: &accounts[13],
            current_position_tick: &accounts[14],
            final_position_tick: &accounts[15],
            current_position_tick_id: &accounts[16],
            final_position_tick_id: &accounts[17],
            new_branch: &accounts[18],
            supply_token_reserves_liquidity: &accounts[19],
            borrow_token_reserves_liquidity: &accounts[20],
            vault_supply_position_on_liquidity: &accounts[21],
            vault_borrow_position_on_liquidity: &accounts[22],
            supply_rate_model: &accounts[23],
            borrow_rate_model: &accounts[24],
            vault_supply_token_account: &accounts[25],
            vault_borrow_token_account: &accounts[26],
            supply_token_claim_account: &accounts[27],
            borrow_token_claim_account: &accounts[28],
            liquidity: &accounts[29],
            liquidity_program: &accounts[30],
            oracle_program: &accounts[31],
            supply_token_program: &accounts[32],
            borrow_token_program: &accounts[33],
            associated_token_program: &accounts[34],
            system_program: &accounts[35],
            remaining_accounts: &accounts[36..],
        })
    }
}


/// Init position CPI (13 fixed accounts; vaults_program passed last as readonly).
#[allow(clippy::too_many_arguments)]
pub fn init_position<'a>(
    signer: &'a AccountInfo,
    vault_admin: &'a AccountInfo,
    vault_state: &'a AccountInfo,
    position: &'a AccountInfo,
    position_mint: &'a AccountInfo,
    position_token_account: &'a AccountInfo,
    metadata_account: &'a AccountInfo,
    token_program: &'a AccountInfo,
    associated_token_program: &'a AccountInfo,
    system_program: &'a AccountInfo,
    sysvar_instruction: &'a AccountInfo,
    metadata_program: &'a AccountInfo,
    rent: &'a AccountInfo,
    vaults_program: &'a AccountInfo,
    vault_id: u16,
    next_position_id: u32,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [UNINIT_BYTE; 14];
    write_bytes(&mut data[0..8], &DISC_INIT_POSITION);
    write_bytes(&mut data[8..10], &vault_id.to_le_bytes());
    write_bytes(&mut data[10..14], &next_position_id.to_le_bytes());

    invoke_signed_with_accounts(
        &JUP_LEND_VAULTS_PROGRAM_ID,
        [
            (signer, AccountMeta::writable_signer(signer.key())),
            (vault_admin, AccountMeta::writable(vault_admin.key())),
            (vault_state, AccountMeta::writable(vault_state.key())),
            (position, AccountMeta::writable(position.key())),
            (position_mint, AccountMeta::writable(position_mint.key())),
            (position_token_account, AccountMeta::writable(position_token_account.key())),
            (metadata_account, AccountMeta::writable(metadata_account.key())),
            (token_program, AccountMeta::readonly(token_program.key())),
            (associated_token_program, AccountMeta::readonly(associated_token_program.key())),
            (system_program, AccountMeta::readonly(system_program.key())),
            (sysvar_instruction, AccountMeta::readonly(sysvar_instruction.key())),
            (metadata_program, AccountMeta::readonly(metadata_program.key())),
            (rent, AccountMeta::readonly(rent.key())),
            (vaults_program, AccountMeta::readonly(vaults_program.key())),
        ],
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 14) },
        signers,
    )
}

/// Core operate CPI (35 fixed + N remaining; vaults_program at [0] is skipped).
///
/// Instruction data (48 bytes):
///   [0..8]   discriminator
///   [8..24]  new_col  i128 LE  (positive=deposit, negative=withdraw, i128::MIN=all)
///   [24..40] new_debt i128 LE  (positive=borrow, negative=repay, i128::MIN=all)
///   [40]     transfer_type option = 0 (None)
///   [41..45] 3u32 LE (indices count)
///   [45..48] indices[3]
pub fn operate<'a>(
    ctx: &'a JupiterOperateAccounts<'a>,
    new_col: i128,
    new_debt: i128,
    indices: &[u8; 3],
    signers: &[Signer],
) -> ProgramResult {
    let remaining_count = ctx.remaining_accounts.len();
    let total = 35 + remaining_count;

    let mut data = [UNINIT_BYTE; 48];
    write_bytes(&mut data[0..8], &DISC_OPERATE);
    write_bytes(&mut data[8..24], &new_col.to_le_bytes());
    write_bytes(&mut data[24..40], &new_debt.to_le_bytes());
    write_bytes(&mut data[40..41], &[0]); // None transfer_type
    write_bytes(&mut data[41..45], &3u32.to_le_bytes());
    write_bytes(&mut data[45..48], indices);

    let mut metas: [MaybeUninit<AccountMeta>; 64] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&AccountInfo>; 64] =
        unsafe { MaybeUninit::uninit().assume_init() };

    metas[0].write(AccountMeta::writable_signer(ctx.signer.key()));
    infos[0].write(ctx.signer);

    metas[1].write(AccountMeta::writable(ctx.signer_supply_token_account.key()));
    infos[1].write(ctx.signer_supply_token_account);

    metas[2].write(AccountMeta::writable(ctx.signer_borrow_token_account.key()));
    infos[2].write(ctx.signer_borrow_token_account);

    metas[3].write(AccountMeta::writable(ctx.recipient.key()));
    infos[3].write(ctx.recipient);

    metas[4].write(AccountMeta::writable(ctx.recipient_borrow_token_account.key()));
    infos[4].write(ctx.recipient_borrow_token_account);

    metas[5].write(AccountMeta::writable(ctx.recipient_supply_token_account.key()));
    infos[5].write(ctx.recipient_supply_token_account);

    metas[6].write(AccountMeta::writable(ctx.vault_config.key()));
    infos[6].write(ctx.vault_config);

    metas[7].write(AccountMeta::writable(ctx.vault_state.key()));
    infos[7].write(ctx.vault_state);

    metas[8].write(AccountMeta::readonly(ctx.supply_token.key()));
    infos[8].write(ctx.supply_token);

    metas[9].write(AccountMeta::readonly(ctx.borrow_token.key()));
    infos[9].write(ctx.borrow_token);

    metas[10].write(AccountMeta::readonly(ctx.oracle.key()));
    infos[10].write(ctx.oracle);

    metas[11].write(AccountMeta::writable(ctx.position.key()));
    infos[11].write(ctx.position);

    metas[12].write(AccountMeta::readonly(ctx.position_token_account.key()));
    infos[12].write(ctx.position_token_account);

    metas[13].write(AccountMeta::writable(ctx.current_position_tick.key()));
    infos[13].write(ctx.current_position_tick);

    metas[14].write(AccountMeta::writable(ctx.final_position_tick.key()));
    infos[14].write(ctx.final_position_tick);

    metas[15].write(AccountMeta::writable(ctx.current_position_tick_id.key()));
    infos[15].write(ctx.current_position_tick_id);

    metas[16].write(AccountMeta::writable(ctx.final_position_tick_id.key()));
    infos[16].write(ctx.final_position_tick_id);

    metas[17].write(AccountMeta::writable(ctx.new_branch.key()));
    infos[17].write(ctx.new_branch);

    metas[18].write(AccountMeta::writable(ctx.supply_token_reserves_liquidity.key()));
    infos[18].write(ctx.supply_token_reserves_liquidity);

    metas[19].write(AccountMeta::writable(ctx.borrow_token_reserves_liquidity.key()));
    infos[19].write(ctx.borrow_token_reserves_liquidity);

    metas[20].write(AccountMeta::writable(ctx.vault_supply_position_on_liquidity.key()));
    infos[20].write(ctx.vault_supply_position_on_liquidity);

    metas[21].write(AccountMeta::writable(ctx.vault_borrow_position_on_liquidity.key()));
    infos[21].write(ctx.vault_borrow_position_on_liquidity);

    metas[22].write(AccountMeta::writable(ctx.supply_rate_model.key()));
    infos[22].write(ctx.supply_rate_model);

    metas[23].write(AccountMeta::writable(ctx.borrow_rate_model.key()));
    infos[23].write(ctx.borrow_rate_model);

    metas[24].write(AccountMeta::writable(ctx.vault_supply_token_account.key()));
    infos[24].write(ctx.vault_supply_token_account);

    metas[25].write(AccountMeta::writable(ctx.vault_borrow_token_account.key()));
    infos[25].write(ctx.vault_borrow_token_account);

    metas[26].write(AccountMeta::readonly(ctx.supply_token_claim_account.key()));
    infos[26].write(ctx.supply_token_claim_account);

    metas[27].write(AccountMeta::readonly(ctx.borrow_token_claim_account.key()));
    infos[27].write(ctx.borrow_token_claim_account);

    metas[28].write(AccountMeta::writable(ctx.liquidity.key()));
    infos[28].write(ctx.liquidity);

    metas[29].write(AccountMeta::readonly(ctx.liquidity_program.key()));
    infos[29].write(ctx.liquidity_program);

    metas[30].write(AccountMeta::readonly(ctx.oracle_program.key()));
    infos[30].write(ctx.oracle_program);

    metas[31].write(AccountMeta::readonly(ctx.supply_token_program.key()));
    infos[31].write(ctx.supply_token_program);

    metas[32].write(AccountMeta::readonly(ctx.borrow_token_program.key()));
    infos[32].write(ctx.borrow_token_program);

    metas[33].write(AccountMeta::readonly(ctx.associated_token_program.key()));
    infos[33].write(ctx.associated_token_program);

    metas[34].write(AccountMeta::readonly(ctx.system_program.key()));
    infos[34].write(ctx.system_program);

    for (i, acc) in ctx.remaining_accounts.iter().enumerate() {
        if acc.is_writable() {
            metas[35 + i].write(AccountMeta::writable(acc.key()));
        } else {
            metas[35 + i].write(AccountMeta::readonly(acc.key()));
        }
        infos[35 + i].write(acc);
    }

    invoke_signed_with_count(
        &JUP_LEND_VAULTS_PROGRAM_ID,
        &metas,
        &infos,
        total,
        unsafe { from_raw_parts(data.as_ptr() as *const u8, 48) },
        signers,
    )
}


/// Initialize: calls init_position CPI.
/// Data = (vault_id: u16, next_position_id: u32)
impl<'info> Initialize<'info> for JupiterLend {
    type Accounts = JupiterInitAccounts<'info>;
    type Data = (u16, u32);

    fn initialize_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let (vault_id, next_position_id) = *data;
        init_position(
            ctx.signer,
            ctx.vault_admin,
            ctx.vault_state,
            ctx.position,
            ctx.position_mint,
            ctx.position_token_account,
            ctx.metadata_account,
            ctx.token_program,
            ctx.associated_token_program,
            ctx.system_program,
            ctx.sysvar_instruction,
            ctx.metadata_program,
            ctx.rent,
            ctx.vaults_program,
            vault_id,
            next_position_id,
            signer_seeds,
        )
    }
}

/// Deposit: operate with new_col = amount, new_debt = 0.
/// Data = [u8; 3] (indices)
impl<'info> Deposit<'info> for JupiterLend {
    type Accounts = JupiterOperateAccounts<'info>;
    type Data = [u8; 3];

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        operate(ctx, amount as i128, 0, data, signer_seeds)
    }
}

/// Withdraw: operate with new_col negative (i128::MIN = full).
/// Data = [u8; 3] (indices)
impl<'info> Withdraw<'info> for JupiterLend {
    type Accounts = JupiterOperateAccounts<'info>;
    type Data = [u8; 3];

    fn withdraw_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let col = if amount == u64::MAX { i128::MIN } else { -(amount as i128) };
        operate(ctx, col, 0, data, signer_seeds)
    }
}

/// Borrow: operate with new_debt positive.
/// Data = [u8; 3] (indices)
impl<'info> Borrow<'info> for JupiterLend {
    type Accounts = JupiterOperateAccounts<'info>;
    type Data = [u8; 3];

    fn borrow_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        operate(ctx, 0, amount as i128, data, signer_seeds)
    }
}

/// Repay: operate with new_debt negative (i128::MIN = full).
/// Data = [u8; 3] (indices)
impl<'info> Repay<'info> for JupiterLend {
    type Accounts = JupiterOperateAccounts<'info>;
    type Data = [u8; 3];

    fn repay_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let debt = if amount == u64::MAX { i128::MIN } else { -(amount as i128) };
        operate(ctx, 0, debt, data, signer_seeds)
    }
}

impl JupiterLend {
    /// Combined deposit + borrow in a single operate call.
    pub fn deposit_and_borrow<'a>(
        ctx: &'a JupiterOperateAccounts<'a>,
        deposit_amount: u64,
        borrow_amount: u64,
        indices: &[u8; 3],
    ) -> ProgramResult {
        operate(
            ctx,
            deposit_amount as i128,
            borrow_amount as i128,
            indices,
            &[],
        )
    }

    /// Combined repay + withdraw in a single operate call (u64::MAX → i128::MIN = full).
    pub fn repay_and_withdraw<'a>(
        ctx: &'a JupiterOperateAccounts<'a>,
        repay_amount: u64,
        withdraw_amount: u64,
        indices: &[u8; 3],
    ) -> ProgramResult {
        let debt = if repay_amount == u64::MAX { i128::MIN } else { -(repay_amount as i128) };
        let col  = if withdraw_amount == u64::MAX { i128::MIN } else { -(withdraw_amount as i128) };
        operate(ctx, col, debt, indices, &[])
    }
}

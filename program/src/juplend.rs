use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

/// jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi
/// This is the program Kamino blacklisted. As a CPI target it is invisible
/// to SYSVAR_INSTRUCTIONS when this wrapper is the outer instruction.
pub const JUP_LEND_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi");

const DISC_OPERATE: [u8; 8] = [217, 106, 208, 99, 116, 151, 42, 135];

/// Jupiter Lend operate account layout (36 fixed + N remaining accounts).
/// See jupiter-refinance-pinocchio/program/src/protocols/jupiter/actions.rs
/// for the full account list with field names.
///
/// Instruction data (48 bytes):
///   [0..8]   discriminator
///   [8..24]  new_col  i128 LE  (positive=deposit, i128::MIN=full)
///   [24..40] new_debt i128 LE  (positive=borrow, i128::MIN=full)
///   [40]     transfer_type = 0 (None)
///   [41..45] 3u32 LE (indices count)
///   [45..48] indices[3]
#[inline(never)]
pub fn operate(
    accounts: &[AccountInfo],
    deposit_amount: u64,
    borrow_amount: u64,
    indices: &[u8; 3],
) -> ProgramResult {
    if accounts.len() < 36 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let new_col = deposit_amount as i128;
    let new_debt = borrow_amount as i128;

    let mut data = [0u8; 48];
    data[0..8].copy_from_slice(&DISC_OPERATE);
    data[8..24].copy_from_slice(&new_col.to_le_bytes());
    data[24..40].copy_from_slice(&new_debt.to_le_bytes());
    data[40] = 0; // None transfer_type
    data[41..45].copy_from_slice(&3u32.to_le_bytes());
    data[45..48].copy_from_slice(indices);

    let total = (accounts.len() - 1).min(48); // skip accounts[0]; cap at array size
    let mut metas: [MaybeUninit<AccountMeta>; 48] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&AccountInfo>; 48] =
        unsafe { MaybeUninit::uninit().assume_init() };

    // accounts[0] is the vaults_program placeholder — skip it, it's just for slot detection
    // accounts[1..] map to the operate instruction accounts starting from signer
    for (i, acc) in accounts[1..].iter().enumerate() {
        let meta = if i == 0 {
            // signer — writable signer
            AccountMeta::writable_signer(acc.key())
        } else if acc.is_writable() {
            AccountMeta::writable(acc.key())
        } else {
            AccountMeta::readonly(acc.key())
        };
        metas[i].write(meta);
        infos[i].write(acc);
    }

    let metas_slice = unsafe { from_raw_parts(metas.as_ptr() as *const AccountMeta, total) };
    let infos_slice = unsafe { from_raw_parts(infos.as_ptr() as *const &AccountInfo, total) };

    slice_invoke_signed(
        &Instruction {
            program_id: &JUP_LEND_PROGRAM_ID,
            accounts: metas_slice,
            data: &data,
        },
        infos_slice,
        &[],
    )
}

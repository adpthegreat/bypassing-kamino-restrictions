use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod juplend;
pub mod kamino;

pub(crate) type CpiAccount<'a> = (&'a AccountInfo, AccountMeta<'a>);

pub(crate) fn invoke_signed_with_accounts<'a, const N: usize>(
    program_id: &Pubkey,
    accounts: [CpiAccount<'a>; N],
    data: &[u8],
    signers: &[Signer],
) -> ProgramResult {
    let mut metas: [MaybeUninit<AccountMeta<'a>>; N] =
        unsafe { MaybeUninit::uninit().assume_init() };
    let mut infos: [MaybeUninit<&'a AccountInfo>; N] =
        unsafe { MaybeUninit::uninit().assume_init() };

    for (count, (info, meta)) in accounts.into_iter().enumerate() {
        metas[count].write(meta);
        infos[count].write(info);
    }

    invoke_signed_with_count(program_id, &metas, &infos, N, data, signers)
}

#[inline(never)]
pub(crate) fn invoke_signed_with_count<'a, const N: usize>(
    program_id: &Pubkey,
    metas: &[MaybeUninit<AccountMeta<'a>>; N],
    infos: &[MaybeUninit<&'a AccountInfo>; N],
    count: usize,
    data: &[u8],
    signers: &[Signer],
) -> ProgramResult {
    if count > N {
        return Err(ProgramError::InvalidInstructionData);
    }

    let ix = Instruction {
        program_id,
        accounts: unsafe { from_raw_parts(metas.as_ptr() as *const AccountMeta<'a>, count) },
        data,
    };

    slice_invoke_signed(
        &ix,
        unsafe { from_raw_parts(infos.as_ptr() as *const &AccountInfo, count) },
        signers,
    )
}

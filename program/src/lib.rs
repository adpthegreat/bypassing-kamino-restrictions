#[cfg(feature = "idl")]
pub mod instructions;
pub mod protocols;
pub mod traits;

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

use core::mem::MaybeUninit;
use pinocchio::pubkey::Pubkey;

pub const ID: Pubkey = pinocchio_pubkey::pubkey!("Gr4ofKMU4AFW9hpR1dYxbVBHjvXDw9d6LYpCscTc3xMD");

pub(crate) const UNINIT_BYTE: MaybeUninit<u8> = MaybeUninit::<u8>::uninit();

#[inline(always)]
pub(crate) fn write_bytes(destination: &mut [MaybeUninit<u8>], source: &[u8]) {
    for (d, s) in destination.iter_mut().zip(source.iter()) {
        d.write(*s);
    }
}

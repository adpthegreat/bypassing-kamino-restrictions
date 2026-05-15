pub mod traits;
pub mod protocols;
#[cfg(feature = "idl")]
pub mod instructions;

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

use core::mem::MaybeUninit;

pub(crate) const UNINIT_BYTE: MaybeUninit<u8> = MaybeUninit::<u8>::uninit();

#[inline(always)]
pub(crate) fn write_bytes(destination: &mut [MaybeUninit<u8>], source: &[u8]) {
    for (d, s) in destination.iter_mut().zip(source.iter()) {
        d.write(*s);
    }
}

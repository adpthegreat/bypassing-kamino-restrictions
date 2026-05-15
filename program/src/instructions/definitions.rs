use shank::ShankInstruction;

#[repr(C, u8)]
#[derive(Clone, Debug, PartialEq, ShankInstruction)]
pub enum KaminoJuplendRefinanceInstruction {
    /// Repay Kamino debt, withdraw Kamino collateral, then deposit+borrow into Jupiter Lend.
    /// All amounts are implicitly u64::MAX (full position refinance).
    ///
    /// Data layout (10 bytes):
    ///   [0]     discriminant = 0
    ///   [1..3]  kamino_repay_account_count    u16 LE
    ///   [3..5]  kamino_withdraw_account_count u16 LE
    ///   [5..7]  juplend_account_count         u16 LE
    ///   [7..10] juplend_indices               [u8; 3]
    ///
    /// Account layout (flat, split by the three count fields):
    ///   [0..kamino_repay_count]                              Kamino repay accounts
    ///   [kamino_repay_count..+kamino_withdraw_count]         Kamino withdraw accounts
    ///   [kamino_repay_count+kamino_withdraw_count..]         Jupiter Lend operate accounts
    RefinanceKaminoToJupiter {
        kamino_repay_account_count: u16,
        kamino_withdraw_account_count: u16,
        juplend_account_count: u16,
        juplend_indices: [u8; 3],
    },

    /// Repay+withdraw Jupiter Lend, then deposit collateral and borrow from Kamino.
    /// All amounts are implicitly u64::MAX (full position refinance).
    ///
    /// Data layout (10 bytes):
    ///   [0]     discriminant = 1
    ///   [1..3]  juplend_account_count         u16 LE
    ///   [3..5]  kamino_deposit_account_count  u16 LE
    ///   [5..7]  kamino_borrow_account_count   u16 LE
    ///   [7..10] juplend_indices               [u8; 3]
    ///
    /// Account layout (flat, split by the three count fields):
    ///   [0..juplend_count]                               Jupiter Lend operate accounts
    ///   [juplend_count..+kamino_deposit_count]           Kamino deposit accounts
    ///   [juplend_count+kamino_deposit_count..]           Kamino borrow accounts
    RefinanceJupiterToKamino {
        juplend_account_count: u16,
        kamino_deposit_account_count: u16,
        kamino_borrow_account_count: u16,
        juplend_indices: [u8; 3],
    },
}

use shank::ShankInstruction;

#[repr(C, u8)]
#[derive(Clone, Debug, PartialEq, ShankInstruction)]
pub enum KaminoJuplendRefinanceInstruction {
    /// Repay Kamino debt, withdraw Kamino collateral, then deposit+borrow into Jupiter Lend.
    ///
    /// Data layout:
    ///   [0]     discriminant = 0
    ///   [1..9]   source_repay_amount                  u64 LE
    ///   [9..17]  source_withdraw_amount               u64 LE
    ///   [17..25] destination_deposit_amount           u64 LE
    ///   [25..33] destination_borrow_amount            u64 LE
    ///   [33]     kamino_has_collateral_or_borrow_flag u8
    ///   [34..36] jupiter_remaining_accounts_len       u16 LE
    ///   [36..39] juplend_indices                      [u8; 3]
    ///
    /// Account layout:
    ///   [0..36]                                  Jupiter Lend fixed operate accounts
    ///   [36..36+jupiter_remaining_accounts_len] Jupiter Lend remaining accounts
    ///   [36+jupiter_remaining_accounts_len..]   unified Kamino accounts
    RefinanceKaminoToJupiter {
        source_repay_amount: u64,
        source_withdraw_amount: u64,
        destination_deposit_amount: u64,
        destination_borrow_amount: u64,
        kamino_has_collateral_or_borrow_flag: u8,
        jupiter_remaining_accounts_len: u16,
        juplend_indices: [u8; 3],
    },

    /// Repay+withdraw Jupiter Lend, then deposit collateral and borrow from Kamino.
    ///
    /// Data layout:
    ///   [0]     discriminant = 1
    ///   [1..9]   source_repay_amount                  u64 LE
    ///   [9..17]  source_withdraw_amount               u64 LE
    ///   [17..25] destination_deposit_amount           u64 LE
    ///   [25..33] destination_borrow_amount            u64 LE
    ///   [33]     kamino_has_collateral_or_borrow_flag u8
    ///   [34..36] jupiter_remaining_accounts_len       u16 LE
    ///   [36..39] juplend_indices                      [u8; 3]
    ///
    /// Account layout:
    ///   [0..36]                                  Jupiter Lend fixed operate accounts
    ///   [36..36+jupiter_remaining_accounts_len] Jupiter Lend remaining accounts
    ///   [36+jupiter_remaining_accounts_len..]   unified Kamino accounts
    RefinanceJupiterToKamino {
        source_repay_amount: u64,
        source_withdraw_amount: u64,
        destination_deposit_amount: u64,
        destination_borrow_amount: u64,
        kamino_has_collateral_or_borrow_flag: u8,
        jupiter_remaining_accounts_len: u16,
        juplend_indices: [u8; 3],
    },
}

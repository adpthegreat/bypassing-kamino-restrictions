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
    ///   [34..37] juplend_indices                      [u8; 3]
    ///
    /// Account layout:
    ///   [0..36]              Jupiter Lend fixed operate accounts
    ///   [36..kamino_start]   Jupiter Lend remaining accounts
    ///   [kamino_start..]     unified Kamino accounts, starting with KLend program
    RefinanceKaminoToJupiter {
        source_repay_amount: u64,
        source_withdraw_amount: u64,
        destination_deposit_amount: u64,
        destination_borrow_amount: u64,
        kamino_has_collateral_or_borrow_flag: u8,
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
    ///   [34..37] juplend_indices                      [u8; 3]
    ///
    /// Account layout:
    ///   [0..36]              Jupiter Lend fixed operate accounts
    ///   [36..kamino_start]   Jupiter Lend remaining accounts
    ///   [kamino_start..]     unified Kamino accounts, starting with KLend program
    RefinanceJupiterToKamino {
        source_repay_amount: u64,
        source_withdraw_amount: u64,
        destination_deposit_amount: u64,
        destination_borrow_amount: u64,
        kamino_has_collateral_or_borrow_flag: u8,
        juplend_indices: [u8; 3],
    },
}

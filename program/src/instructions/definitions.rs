use shank::ShankInstruction;

/// On-chain instruction set for the Kamino <> Jupiter Lend refinance program.
///
/// Discriminants match the `u8` tags dispatched in `entrypoint.rs`. Accounts are
/// passed positionally (with protocol remaining accounts) and parsed by each
/// protocol's `try_from_slice`, so they are not annotated here.
#[repr(C, u8)]
#[derive(Clone, Debug, PartialEq, ShankInstruction)]
pub enum KaminoJuplendRefinanceInstruction {
    /// Initialize a Kamino obligation + farm state.
    ///
    /// Data layout:
    ///   [0]    discriminant = 0
    ///   [1]    mode u8 (0 = collateral farm, 1 = debt farm)
    InitKamino { mode: u8 } = 0,

    /// Initialize a Jupiter Lend position.
    ///
    /// Data layout:
    ///   [0]     discriminant = 1
    ///   [1..3]  vault_id          u16 LE
    ///   [3..7]  next_position_id  u32 LE
    InitJupiterLend {
        vault_id: u16,
        next_position_id: u32,
    } = 1,

    /// Deposit collateral into Kamino.
    ///
    /// Data layout:
    ///   [0]     discriminant = 2
    ///   [1..9]  amount u64 LE
    ///   [9]     flags  u8
    DepositKamino { amount: u64, flags: u8 } = 2,

    /// Borrow liquidity from Kamino.
    ///
    /// Data layout:
    ///   [0]     discriminant = 3
    ///   [1..9]  amount u64 LE
    ///   [9]     flags  u8
    BorrowKamino { amount: u64, flags: u8 } = 3,

    /// Repay Kamino debt.
    ///
    /// Data layout:
    ///   [0]     discriminant = 4
    ///   [1..9]  amount u64 LE
    ///   [9]     flags  u8
    RepayKamino { amount: u64, flags: u8 } = 4,

    /// Withdraw collateral from Kamino.
    ///
    /// Data layout:
    ///   [0]     discriminant = 5
    ///   [1..9]  amount u64 LE
    ///   [9]     flags  u8
    WithdrawKamino { amount: u64, flags: u8 } = 5,

    /// Combined Jupiter Lend deposit collateral + borrow debt via a single operate CPI.
    ///
    /// Data layout:
    ///   [0]      discriminant = 6
    ///   [1..9]   deposit_amount  u64 LE
    ///   [9..17]  borrow_amount   u64 LE
    ///   [17..20] juplend_indices [u8; 3]
    DepositAndBorrowJuplend {
        deposit_amount: u64,
        borrow_amount: u64,
        juplend_indices: [u8; 3],
    } = 6,

    /// Combined Jupiter Lend repay debt + withdraw collateral via a single operate CPI.
    ///
    /// Data layout:
    ///   [0]      discriminant = 7
    ///   [1..9]   withdraw_amount u64 LE
    ///   [9..17]  repay_amount    u64 LE
    ///   [17..20] juplend_indices [u8; 3]
    RepayAndWithdrawJuplend {
        withdraw_amount: u64,
        repay_amount: u64,
        juplend_indices: [u8; 3],
    } = 7,

    /// Repay Kamino debt, withdraw Kamino collateral, then deposit+borrow into Jupiter Lend.
    ///
    /// Data layout:
    ///   [0]     discriminant = 10
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
    } = 10,

    /// Repay+withdraw Jupiter Lend, then deposit collateral and borrow from Kamino.
    ///
    /// Data layout:
    ///   [0]     discriminant = 11
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
    } = 11,
}

# Bypassing Kamino Finance Restricted Programs 

So back in septemener 2025 jupiter launched their own lending money market called jupiter lend in partnership with fluid, basically a solana rewrite of fluid lend, then they introduced a feature called jupiter refinance which allowed you to one click migrate your loans from other lending protocols eg marginfi, kamino, including multiply positions to jupiter lend with the value proposition of having higher LTVs and APYs due to their better architecture and tick based liquidation design so your loans will perform better.

But where it gets interesting is the steps/actions kamino took against it, basically blocking transactions that involved jupiter lends borrow program in through the 
`RepayObligationLiquidityV2` instruction using the instruction sysvar program, but firstly what are sysvars in solana and what is the instruction sysvar in solana?

TLDR 

Explain the sysvar 

Basically the key to bypassing this restriction depends on the fact the instruction sysvar can ONLY iterate through the outer instructions in an instruction, and this is also the reason that most solana lending protocols that implement flashloans do not allow you to execute a flashloan instruction using CPI (except omnipair but thats a story for another thread)

Now lets take a look at the code 

To implement our program we follow blueshifts beethoven design architecture where every protocol action is generalized by a trait each with a method (or optionally two) one method for implementing the protcol specific action where we use PDA signing, or not

The kamino implementation was wayy stressful because their collateral and borrows need to be refreshed before every borrow or repay transaction 

Jupiter has a better and interesting design where every action is carried out through a single opearte instruction with two parameters - deposit amount and borrow amount, and the deltas of both these amounts represent the four fundamental lending actions - deposit, withdraw, borrow, repay with the ability to inserting u64::MAX to pay all the debt, withdraw all the collateral, etc 

So this program is deployed on mainnet at 

`ADP...................` i'll vanity grind the keypair later man
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'

export interface BuyTokenParams {
  mint: PublicKey
  amount: BN              // Exact token output amount
  maxLamports: BN         // Maximum SOL to spend
  user: PublicKey         // Transaction payer/signer
  destination?: PublicKey // Token recipient (defaults to user)
}

export interface SellTokenParams {
  mint: PublicKey
  inputAmount: BN         // Token amount to sell
  minOutputAmount: BN     // Minimum SOL to receive
  user: PublicKey         // Transaction payer/signer
  destination?: PublicKey // SOL recipient (defaults to user)
}

export type DexType = 'pumpfun' | 'pumpamm'

export interface TradeResult {
  instructions: TransactionInstruction[]
  dexType: DexType
}

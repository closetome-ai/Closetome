import { PublicKey } from '@solana/web3.js'

export const USDC_MINTS = {
  mainnet: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  devnet: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')
} as const

export const USDC_DECIMALS = 6

export const LAMPORTS_PER_SOL = 1_000_000_000

export function formatSol(lamports: number | bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(9)
}

export function formatUsdc(rawAmount: number | bigint): string {
  const usdc = Number(rawAmount) / Math.pow(10, USDC_DECIMALS)
  return usdc.toFixed(USDC_DECIMALS)
}

export function parseUsdc(amount: string): bigint {
  const parsed = parseFloat(amount)
  return BigInt(Math.floor(parsed * Math.pow(10, USDC_DECIMALS)))
}

export function parseSol(amount: string): number {
  const parsed = parseFloat(amount)
  return Math.floor(parsed * LAMPORTS_PER_SOL)
}

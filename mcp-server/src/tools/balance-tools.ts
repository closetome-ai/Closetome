import { z } from 'zod'
import { walletManager } from '../wallet/index.js'
import { getSolBalance, getUsdcBalance, getAllBalances } from '../solana/index.js'
import { config, type Network } from '../config.js'

const networkSchema = z.enum(['mainnet', 'devnet']).default('devnet')

export const balanceGetSolSchema = z.object({
  address: z.string().optional().describe('Solana address (defaults to active wallet)'),
  network: networkSchema.describe('Network to query')
})

export async function balanceGetSol(params: z.infer<typeof balanceGetSolSchema>) {
  let address = params.address

  if (!address) {
    const activeWallet = await walletManager.getActiveWallet()
    if (!activeWallet) {
      throw new Error('No address provided and no active wallet set')
    }
    address = activeWallet.publicKey
  }

  const network = params.network as Network
  const balance = await getSolBalance(address, network)

  return {
    address: balance.address,
    balanceLamports: balance.balanceLamports,
    balanceSol: balance.balanceSol,
    network: balance.network,
    message: `Balance: ${balance.balanceSol} SOL`
  }
}

export const balanceGetUsdcSchema = z.object({
  address: z.string().optional().describe('Solana address (defaults to active wallet)'),
  network: networkSchema.describe('Network to query')
})

export async function balanceGetUsdc(params: z.infer<typeof balanceGetUsdcSchema>) {
  let address = params.address

  if (!address) {
    const activeWallet = await walletManager.getActiveWallet()
    if (!activeWallet) {
      throw new Error('No address provided and no active wallet set')
    }
    address = activeWallet.publicKey
  }

  const network = params.network as Network
  const balance = await getUsdcBalance(address, network)

  return {
    address: balance.address,
    balanceRaw: balance.balanceRaw,
    balanceFormatted: balance.balanceFormatted,
    tokenAccount: balance.tokenAccount,
    network: balance.network,
    message: `USDC Balance: ${balance.balanceFormatted} USDC`
  }
}

export const balanceGetAllSchema = z.object({
  address: z.string().optional().describe('Solana address (defaults to active wallet)'),
  network: networkSchema.describe('Network to query')
})

export async function balanceGetAll(params: z.infer<typeof balanceGetAllSchema>) {
  let address = params.address

  if (!address) {
    const activeWallet = await walletManager.getActiveWallet()
    if (!activeWallet) {
      throw new Error('No address provided and no active wallet set')
    }
    address = activeWallet.publicKey
  }

  const network = params.network as Network
  const balances = await getAllBalances(address, network)

  const tokenSummary = balances.tokens.length > 0
    ? balances.tokens.map(t => `${t.balance} ${t.symbol || t.mint.slice(0, 8)}`).join(', ')
    : 'No tokens'

  return {
    address: balances.address,
    sol: balances.sol,
    tokens: balances.tokens,
    network: balances.network,
    message: `SOL: ${balances.sol.formatted} | Tokens: ${tokenSummary}`
  }
}

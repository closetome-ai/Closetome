import { z } from 'zod'
import { VersionedTransaction, Connection } from '@solana/web3.js'
import { walletManager } from '../wallet/index.js'
import { intentChecker } from '../transaction/index.js'
import { signTransaction } from '../transaction/signer.js'
import { transferSol, transferUsdc, getConnection } from '../solana/index.js'
import type { Network } from '../config.js'

const networkSchema = z.enum(['mainnet', 'devnet']).default('devnet')

export const transactionAnalyzeSchema = z.object({
  transaction: z.string().describe('Base64 encoded transaction'),
  network: networkSchema.describe('Network for context')
})

export async function transactionAnalyze(params: z.infer<typeof transactionAnalyzeSchema>) {
  const activeWallet = await walletManager.getActiveWallet()
  if (!activeWallet) {
    throw new Error('No active wallet set. Please set an active wallet first.')
  }

  const transactionBuffer = Buffer.from(params.transaction, 'base64')
  const transaction = VersionedTransaction.deserialize(transactionBuffer)

  const result = await intentChecker.analyzeTransaction(transaction, activeWallet.publicKey)
  const prompt = intentChecker.generateConfirmationPrompt(result)

  return {
    safe: result.safe,
    summary: prompt,
    warnings: result.warnings,
    errors: result.errors,
    details: {
      computeUnits: result.summary.computeUnits,
      estimatedFee: result.summary.estimatedFee,
      instructions: result.summary.instructions,
      tokenTransfers: result.summary.tokenTransfers
    }
  }
}

export const transactionSignSchema = z.object({
  transaction: z.string().describe('Base64 encoded transaction'),
  skipIntentCheck: z.boolean().default(false).describe('Skip safety check (dangerous!)'),
  network: networkSchema.describe('Network for context')
})

export async function transactionSign(params: z.infer<typeof transactionSignSchema>) {
  const keypair = await walletManager.getActiveKeypair()
  if (!keypair) {
    throw new Error('No active wallet unlocked. Please unlock a wallet first.')
  }

  const transactionBuffer = Buffer.from(params.transaction, 'base64')
  const transaction = VersionedTransaction.deserialize(transactionBuffer)

  const result = await signTransaction(transaction, keypair, params.skipIntentCheck)

  return {
    signedTransaction: result.signedTransaction,
    signature: result.signature,
    intentCheckPassed: result.intentCheckPassed,
    message: 'Transaction signed successfully.'
  }
}

export const transactionSendSchema = z.object({
  signedTransaction: z.string().describe('Base64 encoded signed transaction'),
  network: networkSchema.describe('Network to send to'),
  skipPreflight: z.boolean().default(false).describe('Skip preflight checks')
})

export async function transactionSend(params: z.infer<typeof transactionSendSchema>) {
  const network = params.network as Network
  const connection = getConnection(network)

  const transactionBuffer = Buffer.from(params.signedTransaction, 'base64')
  const transaction = VersionedTransaction.deserialize(transactionBuffer)

  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: params.skipPreflight,
    preflightCommitment: 'confirmed'
  })

  const latestBlockhash = await connection.getLatestBlockhash()
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  })

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
  }

  const cluster = network === 'mainnet' ? '' : `?cluster=${network}`
  const explorerUrl = `https://explorer.solana.com/tx/${signature}${cluster}`

  return {
    signature,
    status: 'confirmed',
    explorerUrl,
    message: `Transaction confirmed: ${signature}`
  }
}

export const transferSolSchema = z.object({
  to: z.string().describe('Recipient address'),
  amount: z.string().describe('Amount in SOL (e.g., "0.1")'),
  network: networkSchema.describe('Network to use')
})

export async function transferSolTool(params: z.infer<typeof transferSolSchema>) {
  const keypair = await walletManager.getActiveKeypair()
  if (!keypair) {
    throw new Error('No active wallet unlocked. Please unlock a wallet first.')
  }

  const network = params.network as Network
  const result = await transferSol(keypair, params.to, params.amount, network)

  return {
    signature: result.signature,
    from: result.from,
    to: result.to,
    amount: result.amount,
    explorerUrl: result.explorerUrl,
    message: `Sent ${result.amount} SOL to ${result.to.slice(0, 8)}...`
  }
}

export const transferUsdcSchema = z.object({
  to: z.string().describe('Recipient address'),
  amount: z.string().describe('Amount in USDC (e.g., "10.00")'),
  network: networkSchema.describe('Network to use')
})

export async function transferUsdcTool(params: z.infer<typeof transferUsdcSchema>) {
  const keypair = await walletManager.getActiveKeypair()
  if (!keypair) {
    throw new Error('No active wallet unlocked. Please unlock a wallet first.')
  }

  const network = params.network as Network
  const result = await transferUsdc(keypair, params.to, params.amount, network)

  return {
    signature: result.signature,
    from: result.from,
    to: result.to,
    amount: result.amount,
    createdATA: result.createdATA,
    explorerUrl: result.explorerUrl,
    message: `Sent ${result.amount} USDC to ${result.to.slice(0, 8)}...${result.createdATA ? ' (created token account)' : ''}`
  }
}

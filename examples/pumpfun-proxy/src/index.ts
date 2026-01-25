import express from 'express'
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import dotenv from 'dotenv'
import { PumpTrader } from './dex/index.js'
import { createPriorityFeeInstruction } from './utils/solana.js'

dotenv.config()

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY

if (!SERVER_PRIVATE_KEY) {
  console.error('SERVER_PRIVATE_KEY is required')
  process.exit(1)
}

const connection = new Connection(SOLANA_RPC_URL, 'confirmed')
const serverKeypair = Keypair.fromSecretKey(bs58.decode(SERVER_PRIVATE_KEY))
const trader = new PumpTrader(connection)

console.log('Server wallet:', serverKeypair.publicKey.toBase58())

// ============================================================================
// Express App
// ============================================================================

const app = express()
app.use(express.json())

// ============================================================================
// Types
// ============================================================================

interface BuyRequest {
  mint: string           // Token mint address
  userWallet: string     // User's wallet to receive tokens
  solAmount: string      // SOL amount to spend (in SOL, e.g., "0.1")
  slippageBps?: number   // Slippage tolerance in basis points (default 500 = 5%)
}

interface BuyResponse {
  success: boolean
  txHash?: string
  tokensReceived?: string
  dexUsed?: string
  error?: string
}

// ============================================================================
// X402 Payment Requirements
// ============================================================================

/**
 * Generate X402 payment requirements for buying tokens
 * User needs to pay SOL to server wallet
 */
function generatePaymentRequirements(solAmount: string, mint: string, userWallet: string) {
  const lamports = Math.floor(parseFloat(solAmount) * 1_000_000_000)

  return {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: 'solana',
      maxAmountRequired: lamports.toString(),
      resource: `/buy/${mint}`,
      description: `Buy tokens on Pumpfun/PumpAMM - ${solAmount} SOL`,
      mimeType: 'application/json',
      payTo: serverKeypair.publicKey.toBase58(),
      maxTimeoutSeconds: 300,
      asset: 'So11111111111111111111111111111111111111112', // Native SOL
      extra: {
        mint,
        userWallet,
        solAmount,
      }
    }]
  }
}

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * GET /quote/:mint
 * Get a quote for buying tokens with a specific SOL amount
 */
app.get('/quote/:mint', async (req, res) => {
  try {
    const { mint } = req.params
    const { solAmount = '0.01' } = req.query

    const mintPubkey = new PublicKey(mint)
    const dexType = await trader.detectDex(mintPubkey)

    res.json({
      mint,
      solAmount,
      dexType,
      serverWallet: serverKeypair.publicKey.toBase58(),
      message: `To buy tokens, send ${solAmount} SOL to ${serverKeypair.publicKey.toBase58()} via X402 payment`
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /buy
 * Buy tokens on Pumpfun/PumpAMM
 *
 * Flow:
 * 1. User sends SOL to server wallet (via X402 payment)
 * 2. Server executes buy trade on Pumpfun/PumpAMM
 * 3. Server transfers received tokens to user's wallet
 */
app.post('/buy', async (req, res) => {
  const { mint, userWallet, solAmount, slippageBps = 500 }: BuyRequest = req.body

  // Check for X-Payment header (X402 payment proof)
  const paymentHeader = req.headers['x-payment']

  if (!paymentHeader) {
    // Return 402 Payment Required with payment requirements
    return res.status(402).json(generatePaymentRequirements(solAmount, mint, userWallet))
  }

  try {
    // Parse payment proof
    const paymentData = JSON.parse(Buffer.from(paymentHeader as string, 'base64').toString())
    console.log('Payment received:', paymentData)

    // In production, verify the payment was actually received
    // For this example, we proceed with the trade

    const mintPubkey = new PublicKey(mint)
    const userPubkey = new PublicKey(userWallet)
    const lamports = Math.floor(parseFloat(solAmount) * 1_000_000_000)

    // Calculate token amount with slippage
    // For simplicity, we'll use a large maxLamports and let the DEX handle it
    const maxLamports = new BN(lamports)

    // We need to estimate token output - for now use a placeholder
    // In production, you'd query the bonding curve/pool for the exact amount
    const estimatedTokens = new BN(lamports).mul(new BN(1000)) // Placeholder calculation
    const minTokens = estimatedTokens.mul(new BN(10000 - slippageBps)).div(new BN(10000))

    console.log(`Buying tokens: ${mint}`)
    console.log(`  SOL amount: ${solAmount}`)
    console.log(`  User wallet: ${userWallet}`)
    console.log(`  Slippage: ${slippageBps / 100}%`)

    // Step 1: Execute buy trade (server buys tokens)
    const { instructions: buyInstructions, dexType } = await trader.createBuyInstructions({
      mint: mintPubkey,
      amount: minTokens,
      maxLamports,
      user: serverKeypair.publicKey,
      destination: serverKeypair.publicKey, // Tokens go to server first
    })

    console.log(`Using DEX: ${dexType}`)

    // Add priority fee
    const priorityInstructions = createPriorityFeeInstruction(1000000n, 200000)

    // Build transaction
    const { blockhash } = await connection.getLatestBlockhash()
    const messageV0 = new TransactionMessage({
      payerKey: serverKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [...priorityInstructions, ...buyInstructions]
    }).compileToV0Message()

    const buyTx = new VersionedTransaction(messageV0)
    buyTx.sign([serverKeypair])

    // Send buy transaction
    const buyTxHash = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    })

    console.log(`Buy transaction sent: ${buyTxHash}`)

    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash()
    await connection.confirmTransaction({
      signature: buyTxHash,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    })

    console.log('Buy transaction confirmed')

    // Step 2: Transfer tokens to user
    const serverTokenAccount = await getAssociatedTokenAddress(mintPubkey, serverKeypair.publicKey)
    const userTokenAccount = await getAssociatedTokenAddress(mintPubkey, userPubkey)

    // Get token balance
    const tokenAccountInfo = await getAccount(connection, serverTokenAccount)
    const tokenBalance = tokenAccountInfo.amount

    console.log(`Tokens received: ${tokenBalance.toString()}`)

    // Build transfer transaction
    const transferInstructions = []

    // Check if user's ATA exists, create if needed
    try {
      await getAccount(connection, userTokenAccount)
    } catch {
      transferInstructions.push(
        createAssociatedTokenAccountInstruction(
          serverKeypair.publicKey,
          userTokenAccount,
          userPubkey,
          mintPubkey
        )
      )
    }

    // Transfer tokens
    transferInstructions.push(
      createTransferInstruction(
        serverTokenAccount,
        userTokenAccount,
        serverKeypair.publicKey,
        tokenBalance
      )
    )

    const transferMessage = new TransactionMessage({
      payerKey: serverKeypair.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: transferInstructions
    }).compileToV0Message()

    const transferTx = new VersionedTransaction(transferMessage)
    transferTx.sign([serverKeypair])

    const transferTxHash = await connection.sendTransaction(transferTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    })

    console.log(`Transfer transaction sent: ${transferTxHash}`)

    // Wait for confirmation
    const transferBlockhash = await connection.getLatestBlockhash()
    await connection.confirmTransaction({
      signature: transferTxHash,
      blockhash: transferBlockhash.blockhash,
      lastValidBlockHeight: transferBlockhash.lastValidBlockHeight
    })

    console.log('Transfer transaction confirmed')

    const response: BuyResponse = {
      success: true,
      txHash: buyTxHash,
      tokensReceived: tokenBalance.toString(),
      dexUsed: dexType
    }

    res.json(response)

  } catch (error: any) {
    console.error('Buy error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    } as BuyResponse)
  }
})

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    serverWallet: serverKeypair.publicKey.toBase58(),
    rpcUrl: SOLANA_RPC_URL
  })
})

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`Pumpfun Proxy Server running on port ${PORT}`)
  console.log(`Server wallet: ${serverKeypair.publicKey.toBase58()}`)
  console.log('')
  console.log('Endpoints:')
  console.log(`  GET  /quote/:mint?solAmount=0.01  - Get quote for buying tokens`)
  console.log(`  POST /buy                          - Buy tokens (X402 payment required)`)
  console.log(`  GET  /health                       - Health check`)
})

import express from 'express'
import type { Request, Response } from 'express'
import { config } from 'dotenv'
import path from 'path'
import {
  createX402Middleware,
  defineRoute,
  prop,
  createTypedRoute,
  type EVMCallbackData,
  type CallbackTransaction,
  type EVMPaymentPayload
} from '../../sdk/src'
import { ethers } from 'ethers'

// =============================================================================
// BASE CHAIN X402 PAYMENT SERVER EXAMPLE
// =============================================================================
// This example demonstrates X402 payment-gated API using Base chain (EVM)
//
// IMPORTANT: This server uses Base Sepolia testnet for demonstration
// For production, change network to 'base' and use mainnet addresses
// =============================================================================

config({
  path: path.join(__dirname, '../.env'),
})
const app = express()
app.use(express.json())

// =============================================================================
// CONFIGURATION
// =============================================================================

// Server payment recipient address (EVM address)
const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '0xYourEVMAddressHere'

// Server EVM wallet for signing (if using atomic transactions in future)
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY || '0xYourPrivateKeyHere'

// Facilitator URL
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3010'

// Server port
const PORT = parseInt(process.env.PORT || '4001')

// NFT callback contract for atomic minting
const CALLBACK_CONTRACT = '0xa96E13218B654A3b1F09FE6081fc16643B320002'

// =============================================================================
// ROUTE 1: STANDARD X402 PAYMENT (Base Chain)
// =============================================================================
// Simple payment-gated endpoint
// - Client pays 1 USDC on Base Sepolia
// - No atomic operations, just payment verification
// =============================================================================

const standardRoute = {
  path: '/api/standard/protected',
  network: 'base-sepolia' as const,
  paymentRequirements: {
    maxAmountRequired: '100000', // 0.1 USDC (6 decimals)
    payTo: PAYMENT_RECIPIENT,
    description: 'Access to standard protected endpoint on Base'
  },
  autoSettle: true
}

// =============================================================================
// ROUTE 2: PREMIUM ATOMIC X402 WITH NFT MINTING (Base Chain)
// =============================================================================
// Atomic payment-gated endpoint with callback
// - Client pays based on tier (0.1-1 USDC) on Base Sepolia
// - Atomic operation: payment + NFT minting in single transaction
// - NFT contract: 0xa96E13218B654A3b1F09FE6081fc16643B320002
// - Mints amount equal to payment amount
// =============================================================================

interface PremiumInput {
  amount?: number
  tier?: 'basic' | 'premium' | 'enterprise'
}

interface PremiumOutput {
  message: string
  tier: string
  features: string[]
  paymentAmount: number
  nftMinted: boolean
}

const premiumRouteDefinition = defineRoute<PremiumInput, PremiumOutput>({
  method: 'GET',
  path: '/api/premium',
  atomic: true,      // Use atomic X402 for NFT minting
  autoSettle: true,
  discoverable: true,

  // Input schema for API documentation
  inputSchema: {
    amount: prop.number('Payment amount in microUSDC (optional, uses tier-based pricing if not provided)'),
    tier: prop.string('Service tier', { enum: ['basic', 'premium', 'enterprise'] })
  },

  // Output schema for API documentation
  outputSchema: {
    message: prop.string('Success message'),
    tier: prop.string('Selected tier'),
    features: prop.array(prop.string(), 'List of features included in tier'),
    paymentAmount: prop.number('Amount paid in microUSDC'),
    nftMinted: prop.boolean('Whether NFT was minted atomically')
  },

  // Dynamic payment requirements based on input
  paymentRequirements: ({ input }) => {
    // Tier-based pricing on Base
    const tierPricing = {
      basic: 100000, // 0.1 USDC
      premium: 500000, // 0.5 USDC
      enterprise: 1000000 // 1 USDC
    }

    const tier = input.tier || 'basic'
    const amount = input.amount || tierPricing[tier]

    return {
      maxAmountRequired: amount.toString(),
      payTo: PAYMENT_RECIPIENT,
      description: `Access to ${tier} tier features on Base with NFT minting`,
      extra: {
        tier,
        // Base-specific: gas settings (optional)
        gasLimit: 200000, // Increased for callback execution
        gasPrice: '1000000000' // 1 gwei
      }
    }
  },

  // Generate callback dynamically based on actual user payment
  onGenerateCallback: async (payment): Promise<CallbackTransaction> => {
    // Extract user address from payment
    // Type assertion: for EVM, payment will be EVMPaymentPayload
    const evmPayment = payment as EVMPaymentPayload
    const userAddress = evmPayment.userPay.from
    const paymentAmount = evmPayment.userPay.value

    // Encode mint(address to, uint256 amount) call
    const iface = new ethers.Interface([
      'function mint(address to, uint256 amount)'
    ])
    const mintCalldata = iface.encodeFunctionData('mint', [
      userAddress,      // Mint to actual user address
      paymentAmount     // Mint amount equal to payment
    ])

    const callbackData: EVMCallbackData = {
      target: CALLBACK_CONTRACT,
      calldata: mintCalldata
    }

    return {
      type: 'evm',
      data: callbackData
    }
  },

  // Handler
  handler: ({ input }) => {
    const tier = input.tier || 'basic'
    const features: Record<string, string[]> = {
      basic: ['API Access', '100 requests/day', '0.1 USDC NFT minted'],
      premium: ['API Access', '10,000 requests/day', 'Priority Support', '0.5 USDC NFT minted'],
      enterprise: ['API Access', 'Unlimited requests', 'Dedicated Support', 'SLA', '1 USDC NFT minted']
    }

    const tierPricing = {
      basic: 100000,
      premium: 500000,
      enterprise: 1000000
    }

    return {
      message: `Welcome to ${tier} tier! NFT minted atomically.`,
      tier,
      features: features[tier],
      paymentAmount: input.amount || tierPricing[tier],
      nftMinted: true
    }
  }
})

// =============================================================================
// ROUTE 3: PUBLIC ENDPOINT (No payment required)
// =============================================================================

app.get('/api/public/info', (req: Request, res: Response) => {
  res.json({
    message: 'Public endpoint - no payment required',
    network: 'base-sepolia',
    supportedChains: ['base', 'base-sepolia'],
    paymentToken: 'USDC',
    facilitator: FACILITATOR_URL,
    atomicCallbacks: {
      enabled: true,
      nftContract: CALLBACK_CONTRACT,
      description: 'Premium endpoints use atomic X402 with NFT minting'
    }
  })
})

// =============================================================================
// X402 MIDDLEWARE SETUP
// =============================================================================

// Convert typed route to RouteConfig with network
const premiumRoute = {
  ...createTypedRoute(premiumRouteDefinition),
  network: 'base-sepolia' as const
}

const x402Middleware = createX402Middleware({
  network: 'base-sepolia', // Base Sepolia testnet
  facilitatorUrl: FACILITATOR_URL,
  routes: [
    standardRoute,
    premiumRoute
  ],
  defaultPayTo: PAYMENT_RECIPIENT,
  serverWallet: {
    evm: {
      privateKey: SERVER_PRIVATE_KEY
    }
  }
})

// Apply X402 middleware to all routes
app.use(x402Middleware as any)

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

app.get('/api/standard/protected', (req: Request, res: Response) => {
  const x402Info = (req as any).x402

  res.json({
    message: 'Payment verified! Access granted.',
    paymentInfo: {
      network: 'base-sepolia',
      settled: x402Info?.settled,
      transactionHash: x402Info?.transactionHash
    },
    data: {
      secret: 'This is protected data on Base chain (standard payment)',
      timestamp: new Date().toISOString()
    }
  })
})

// Premium route handler - executes after middleware
app.get('/api/premium', (req: Request, res: Response) => {
  const x402Info = (req as any).x402
  const tier = (req.query.tier as 'basic' | 'premium' | 'enterprise') || 'basic'

  const tierPricing: Record<'basic' | 'premium' | 'enterprise', number> = {
    basic: 100000,
    premium: 500000,
    enterprise: 1000000
  }

  const features: Record<'basic' | 'premium' | 'enterprise', string[]> = {
    basic: ['API Access', '100 requests/day', '0.1 USDC NFT minted'],
    premium: ['API Access', '10,000 requests/day', 'Priority Support', '0.5 USDC NFT minted'],
    enterprise: ['API Access', 'Unlimited requests', 'Dedicated Support', 'SLA', '1 USDC NFT minted']
  }

  res.json({
    message: `Welcome to ${tier} tier! NFT minted atomically.`,
    tier,
    features: features[tier],
    paymentAmount: tierPricing[tier],
    nftMinted: true,
    paymentInfo: {
      network: 'base-sepolia',
      settled: x402Info?.settled,
      atomic: x402Info?.atomic,
      settlementTxHash: x402Info?.settlementTxHash,
      callbackTxHash: x402Info?.callbackTxHash
    }
  })
})

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(80))
  console.log('🟦 BASE CHAIN X402 SERVER STARTED (WITH ATOMIC CALLBACKS)')
  console.log('='.repeat(80))
  console.log(`\n📍 Server running on: http://localhost:${PORT}`)
  console.log(`🌐 Network: Base Sepolia (Testnet)`)
  console.log(`💰 Payment Token: USDC`)
  console.log(`📬 Payment Recipient: ${PAYMENT_RECIPIENT}`)
  console.log(`🔗 Facilitator: ${FACILITATOR_URL}`)
  console.log(`🎨 NFT Contract: ${CALLBACK_CONTRACT}`)
  console.log('\n📋 Available Endpoints:')
  console.log('  PUBLIC:')
  console.log(`    GET  http://localhost:${PORT}/api/public/info`)
  console.log('  \n  PAYMENT REQUIRED (Standard - No Callback):')
  console.log(`    GET  http://localhost:${PORT}/api/standard/protected (0.1 USDC)`)
  console.log('  \n  PAYMENT REQUIRED (Premium - Atomic with NFT Minting):')
  console.log(`    GET  http://localhost:${PORT}/api/premium?tier=basic (0.1 USDC + NFT)`)
  console.log(`    GET  http://localhost:${PORT}/api/premium?tier=premium (0.5 USDC + NFT)`)
  console.log(`    GET  http://localhost:${PORT}/api/premium?tier=enterprise (1 USDC + NFT)`)
  console.log('\n💡 Notes:')
  console.log('  - Standard endpoint: verify + settle (2 transactions)')
  console.log('  - Premium endpoint: atomic verify + settle + NFT mint (1 transaction)')
  console.log('  - NFT amount minted equals payment amount')
  console.log('  - All payments are in USDC on Base Sepolia testnet')
  console.log('  - Make sure facilitator supports Base and has proxy contract deployed')
  console.log('\n' + '='.repeat(80) + '\n')
})

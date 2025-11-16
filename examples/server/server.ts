/**
 * =============================================================================
 * X402 Payment Protocol - Complete Example Server
 * =============================================================================
 *
 * This server demonstrates both Standard and Atomic payment flows:
 *
 * 1. STANDARD X402 PAYMENTS (/api/standard/*)
 *    - Simple payment verification
 *    - Payment transferred to recipient only
 *    - Traditional two-step process (payment → access)
 *
 * 2. ATOMIC X402 PAYMENTS (/api/atomic/*)
 *    - Payment + callback instructions in single transaction
 *    - Type-safe with automatic schema generation
 *    - Interactive client experience with parameter discovery
 *
 * =============================================================================
 */

import express from 'express'
import type { Request, Response } from 'express'
import {
  createX402Middleware,
  defineRoute,
  createTypedRoute,
  createTypedHandlers,
  prop,
  serializeInstructions
} from '../../solana-sdk/src'
import {
  Keypair,
  PublicKey,
  TransactionInstruction
} from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from 'dotenv'
import path from 'path'

config({
  path: path.join(__dirname, '../.env'),
})

const app = express()
app.use(express.json())

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 4000
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3010'

// Server keypair for signing atomic transactions
const SERVER_ACCOUNT = process.env.SERVER_ACCOUNT_SECRET_KEY
  ? Keypair.fromSecretKey(bs58.decode(process.env.SERVER_ACCOUNT_SECRET_KEY))
  : Keypair.generate()

console.log('🔑 Server Account:', SERVER_ACCOUNT.publicKey.toBase58())

// Payment recipient (defaults to server account)
const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || SERVER_ACCOUNT.publicKey.toBase58()

// =============================================================================
// TYPE DEFINITIONS FOR ATOMIC ROUTES
// =============================================================================

interface AtomicPremiumInput {
  amount?: number
  message?: string
  premium?: 'true' | 'false'
}

interface AtomicPremiumOutput {
  message: string
  queryParams: {
    amount: string
    message: string
    premium: string
  }
  payment: {
    settlementTxHash: string
    callbackTxHash: string
    settled: boolean
    atomic: boolean
  }
}

// =============================================================================
// ROUTE 1: STANDARD X402 PAYMENT
// =============================================================================
// Simple payment verification without callback instructions
// Payment is transferred to recipient and access is granted

const standardRoute = {
  path: '/api/standard/protected',
  paymentRequirements: {
    maxAmountRequired: '1000000', // 1 USDC
    payTo: PAYMENT_RECIPIENT,
    description: 'Access to standard protected endpoint',
    resource: '/api/standard/protected'
  },
  autoSettle: true, // Automatically verify and settle

  onPaymentVerified: async (payment: any, req: any) => {
    console.log('✅ Standard payment verified:', req.path)
  },

  onPaymentSettled: async (payment: any, txHash: string, req: any) => {
    console.log('💰 Standard payment settled:', txHash)
  }
}

// =============================================================================
// ROUTE 2: ATOMIC X402 PAYMENT WITH TYPE-SAFE SCHEMA
// =============================================================================
// Payment + callback instructions executed atomically
// Includes automatic schema generation for interactive clients

const atomicPremiumRoute = defineRoute<AtomicPremiumInput, AtomicPremiumOutput>({
  method: 'GET',
  path: '/api/atomic/premium',
  atomic: true,      // Enable atomic verification (uses /atomic/verify endpoint)
  autoSettle: true,  // Automatically settle after verification

  // INPUT SCHEMA - Defines parameters that clients can provide
  // Used for API documentation and interactive parameter collection
  inputSchema: {
    amount: prop.number('Payment amount in microUSDC (e.g., 1000000 = 1 USDC)'),
    message: prop.string('Custom message to include in transaction memo'),
    premium: prop.string('Set to "true" for premium access', { enum: ['true', 'false'] })
  },

  // OUTPUT SCHEMA - Defines response structure
  // Used for API documentation
  outputSchema: {
    message: prop.string('Response message'),
    queryParams: prop.object({
      amount: prop.string('Amount parameter value'),
      message: prop.string('Message parameter value'),
      premium: prop.string('Premium parameter value')
    }, 'Echo of input parameters'),
    payment: prop.object({
      settlementTxHash: prop.string('Settlement transaction hash'),
      callbackTxHash: prop.string('Callback transaction hash (same as settlement in atomic)'),
      settled: prop.boolean('Whether payment was settled'),
      atomic: prop.boolean('Whether this was an atomic transaction')
    }, 'Payment information')
  },

  // PAYMENT REQUIREMENTS GENERATOR
  // Called when client requests 402 response
  // Input parameters are type-checked based on AtomicPremiumInput
  paymentRequirements: ({ input }) => {
    // Dynamic pricing based on input
    const amount = input.amount || 1000000
    const customMessage = input.message || 'Default atomic payment'

    // CREATE CALLBACK INSTRUCTIONS
    // These will be executed atomically with the payment
    const callbackInstructions = []

    // Add memo with custom message
    const memoInstruction = new TransactionInstruction({
      keys: [{
        pubkey: SERVER_ACCOUNT.publicKey,
        isSigner: true,  // Server will sign this
        isWritable: false
      }],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from(`X402 Atomic: ${customMessage}`)
    })
    callbackInstructions.push(memoInstruction)

    // Conditional callback based on premium flag
    if (input.premium === 'true') {
      const premiumMemo = new TransactionInstruction({
        keys: [{
          pubkey: SERVER_ACCOUNT.publicKey,
          isSigner: true,
          isWritable: false
        }],
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from('PREMIUM ACCESS GRANTED')
      })
      callbackInstructions.push(premiumMemo)
    }

    // Return payment requirements with callback instructions
    return {
      maxAmountRequired: amount.toString(),
      payTo: PAYMENT_RECIPIENT,
      description: `Atomic Premium API - ${customMessage}`,
      resource: '/api/atomic/premium',
      extra: {
        // Serialize instructions for transmission
        callbackInstructions: serializeInstructions(callbackInstructions)
      }
    }
  },

  // REQUEST HANDLER
  // Called after payment is verified and settled
  // Input and output types are enforced by TypeScript
  handler: ({ input, req }) => {
    const x402Info = (req as any).x402

    return {
      message: 'Atomic payment successful!',
      queryParams: {
        amount: input.amount?.toString() || '',
        message: input.message || '',
        premium: input.premium || ''
      },
      payment: {
        settlementTxHash: x402Info?.settlementTxHash || '',
        callbackTxHash: x402Info?.callbackTxHash || '',
        settled: x402Info?.settled || false,
        atomic: x402Info?.atomic || false
      }
    }
  }
})

// =============================================================================
// MIDDLEWARE CONFIGURATION
// =============================================================================

// Convert typed routes to RouteConfig
const routes = [
  standardRoute,                      // Standard X402 payment
  createTypedRoute(atomicPremiumRoute) // Atomic X402 payment
]

// Create X402 middleware
const x402Middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: FACILITATOR_URL,
  routes: routes,
  defaultPayTo: PAYMENT_RECIPIENT,
  serverWallet: {
    svm: {
      keypair: bs58.encode(SERVER_ACCOUNT.secretKey) // Required for atomic transactions
    }
  },
  onPaymentFailed: async (error, req) => {
    console.error('❌ Payment failed:', req.path, error.message)
  }
})

// Apply middleware to all routes
app.use(x402Middleware as any)

// =============================================================================
// ENDPOINT HANDLERS
// =============================================================================

// Health check (no payment required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    serverAccount: SERVER_ACCOUNT.publicKey.toBase58(),
    paymentRecipient: PAYMENT_RECIPIENT,
    facilitator: FACILITATOR_URL,
    features: {
      standardPayments: true,
      atomicPayments: true,
      typeSafety: true,
      schemaGeneration: true
    }
  })
})

// Standard protected endpoint
app.get('/api/standard/protected', (_req, res) => {
  const paymentInfo = (res.req as any).x402

  res.json({
    success: true,
    message: 'Successfully accessed standard protected endpoint',
    payment: {
      settled: paymentInfo?.settled,
      transactionHash: paymentInfo?.transactionHash
    }
  })
})

// Atomic premium endpoint (type-safe handler)
const atomicHandlers = createTypedHandlers(atomicPremiumRoute)
app.get('/api/atomic/premium', atomicHandlers.handler as any)

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           X402 Payment Protocol - Example Server              ║
╚════════════════════════════════════════════════════════════════╝

🚀 Server running on: http://localhost:${PORT}

📍 ENDPOINTS:

  PUBLIC:
  └─ GET  /health
      Health check endpoint (no payment required)

  STANDARD X402 PAYMENTS:
  └─ GET  /api/standard/protected
      Simple payment verification (1 USDC)
      • Traditional payment flow
      • Payment transferred to recipient
      • No callback instructions

  ATOMIC X402 PAYMENTS:
  └─ GET  /api/atomic/premium?amount=1000000&message=Hello&premium=true
      Type-safe atomic payment with callback instructions
      • Payment + callback executed atomically
      • Dynamic pricing based on parameters
      • Automatic schema generation
      • Interactive parameter discovery

💳 PAYMENT CONFIGURATION:
   Network:      solana-devnet
   Recipient:    ${PAYMENT_RECIPIENT}
   Facilitator:  ${FACILITATOR_URL}

📚 TESTING:

   1. Standard Payment:
      node examples/client/client.ts

   2. Atomic Payment (Interactive):
      node examples/client/atomic-client.ts

🔗 LEARN MORE:
   • Standard X402:  Simple payment verification
   • Atomic X402:    Payment + callback in single transaction
   • Type Safety:    Full TypeScript support with schema
   • Schema:         Automatic API documentation generation

`)
})

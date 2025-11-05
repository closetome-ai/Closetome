import express from 'express'
import dotenv from 'dotenv'
import { createX402Middleware } from '../../solana-sdk/src'

// Load environment variables
dotenv.config()

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 4000
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3010'
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '4GPbxQ4LwAwWyRZosfk3FoEA6orsvU2MDmzBSiDdqcnN'

// Create X402 middleware with a single protected route
const x402Middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: FACILITATOR_URL,
  routes: [
    {
      path: '/api/protected',
      paymentRequirements: {
        maxAmountRequired: '1000000', // 1 USDC
        payTo: WALLET_ADDRESS,
        description: 'Access to protected API endpoint'
      },
      autoSettle: true, // Automatically verify and settle
      onPaymentVerified: async (payment, req) => {
        console.log('✅ Payment verified for:', req.path)
        console.log('   Payment:', payment)
      },
      onPaymentSettled: async (payment, txHash, req) => {
        console.log('💰 Payment settled for:', req.path)
        console.log('   Transaction hash:', txHash)
      }
    }
  ],
  onPaymentFailed: async (error, req) => {
    console.error('❌ Payment failed for:', req.path)
    console.error('   Error:', error.message)
  }
})

// Apply the middleware (cast to any to avoid Express type issues)
app.use(x402Middleware as any)

// Simple health check endpoint (not protected)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' })
})

// Protected endpoint - requires payment
app.get('/api/protected', (req, res) => {
  // This will only be reached if payment is verified and settled
  const paymentInfo = (req as any).x402

  console.log('🎯 Protected endpoint accessed successfully')

  res.json({
    success: true,
    message: 'Successfully accessed protected endpoint',
    payment: {
      settled: paymentInfo?.settled,
      transactionHash: paymentInfo?.transactionHash
    }
  })
})

// Start the server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║       X402 Example Server - Minimal Setup         ║
╚════════════════════════════════════════════════════╝

🚀 Server running on: http://localhost:${PORT}

📍 Endpoints:
   - GET /health          → Health check (no payment required)
   - GET /api/protected   → Protected endpoint (1 USDC payment required)

💳 Payment Configuration:
   - Network: solana-devnet
   - Amount: 1 USDC
   - Wallet: ${WALLET_ADDRESS}
   - Facilitator: ${FACILITATOR_URL}

📝 Testing:
   To test the protected endpoint, send a request with the X-X402-Payment header
   containing a valid payment payload.

   Example:
   curl -H "X-X402-Payment: <base64-payment>" http://localhost:${PORT}/api/protected
`)
})
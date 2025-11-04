import express from 'express'
import { createX402Middleware, X402Middleware } from '../src'

const app = express()
app.use(express.json())

// Example 1: Configure middleware with multiple routes, each with different payment requirements
const x402Middleware = createX402Middleware(
  {
    network: 'solana-devnet',
    facilitatorUrl: 'http://localhost:3000',
    defaultPayTo: 'YOUR_DEFAULT_WALLET_ADDRESS', // Optional default for all routes
    routes: [
      {
        path: '/api/premium/*',
        paymentRequirements: {
          maxAmountRequired: '1000000', // 1 USDC
          payTo: 'PREMIUM_WALLET_ADDRESS',
          description: 'Premium API Access'
        },
        autoSettle: true,
        onPaymentVerified: async (payment, req) => {
          console.log('Premium payment verified:', payment, 'for path:', req.path)
        },
        onPaymentSettled: async (payment, txHash, req) => {
          console.log('Premium payment settled:', txHash, 'for path:', req.path)
          // Could log to database, send notifications, etc.
        }
      },
      {
        path: '/api/pro/*',
        paymentRequirements: {
          maxAmountRequired: '5000000', // 5 USDC
          payTo: 'PRO_WALLET_ADDRESS',
          description: 'Pro API Access - Advanced Features'
        },
        autoSettle: true
      },
      {
        path: /^\/api\/data\/\d+$/, // Regex for /api/data/123
        paymentRequirements: {
          maxAmountRequired: '500000', // 0.5 USDC
          description: 'Data Access Fee'
          // Uses defaultPayTo from config
        },
        autoSettle: false // Only verify, don't settle
      },
      {
        path: '/api/atomic/*',
        paymentRequirements: {
          maxAmountRequired: '3000000', // 3 USDC
          description: 'Atomic Transaction with Callback'
        },
        atomicSettle: true, // Use atomic settlement
        onGenerateCallback: async (payment, req) => {
          // Generate callback transaction based on payment and request
          console.log('Generating callback for atomic settlement:', req.path)

          // Example: Return instructions/transaction to execute atomically
          return {
            type: 'solana' as const,
            data: [] // Your actual instructions here
          }
        },
        onPaymentSettled: async (payment, txHash, req) => {
          console.log('Atomic payment settled:', txHash)
        }
      }
    ],
    onPaymentFailed: async (error, req) => {
      console.error('Payment failed for', req.path, ':', error.message)
    }
  },
  {
    bypassOnError: false, // Block requests if facilitator is unavailable
    customHeaders: {
      'X-Payment-Provider': 'ClosetomeSDK'
    }
  }
)

// Apply middleware globally - it will only handle configured routes
app.use(x402Middleware)

// Protected endpoints - different payment requirements
app.get('/api/premium/features', (req, res) => {
  const paymentInfo = (req as any).x402
  res.json({
    message: 'Premium features accessed',
    transactionHash: paymentInfo?.transactionHash
  })
})

// Atomic settlement endpoint
app.get('/api/atomic/action', (req, res) => {
  const paymentInfo = (req as any).x402
  res.json({
    message: 'Atomic action executed',
    settlementTxHash: paymentInfo?.settlementTxHash,
    callbackTxHash: paymentInfo?.callbackTxHash,
    atomic: paymentInfo?.atomic
  })
})

app.get('/api/pro/analytics', (req, res) => {
  const paymentInfo = (req as any).x402
  res.json({
    message: 'Pro analytics accessed',
    transactionHash: paymentInfo?.transactionHash
  })
})

app.get('/api/data/:id', (req, res) => {
  const paymentInfo = (req as any).x402
  res.json({
    message: `Data ${req.params.id} accessed`,
    verified: paymentInfo?.verified,
    settled: paymentInfo?.settled
  })
})

// Example 2: Using X402Middleware class for more control
const x402Instance = new X402Middleware({
  network: 'base-sepolia',
  facilitatorUrl: 'http://localhost:3000',
  routes: [
    {
      path: '/api/manual/*',
      paymentRequirements: {
        maxAmountRequired: '2000000',
        payTo: 'MANUAL_WALLET_ADDRESS',
        description: 'Manual Payment Processing'
      }
    }
  ]
})

// Manual payment verification and settlement
app.post('/api/manual-payment', async (req, res) => {
  try {
    const payment = req.body.payment
    const routePath = '/api/manual/process'

    // Manual verification for specific route
    const isValid = await x402Instance.verifyPayment(payment, routePath)

    if (!isValid) {
      return res.status(402).json({ error: 'Invalid payment' })
    }

    // Do some processing...
    console.log('Processing payment for route:', routePath)

    // Manual settlement for specific route
    const settleResult = await x402Instance.settlePayment(payment, routePath)

    if (!settleResult.success) {
      return res.status(402).json({ error: 'Settlement failed' })
    }

    res.json({
      success: true,
      transactionHash: settleResult.transactionHash
    })
  } catch (error) {
    res.status(500).json({ error: 'Payment processing failed' })
  }
})

// Example 3: Sequential verify and settle (non-atomic)
app.post('/api/verify-and-settle', async (req, res) => {
  try {
    const payment = req.body.payment
    const routePath = '/api/manual/process'

    const result = await x402Instance.verifyAndSettle(payment, routePath)

    if (!result.verified || !result.settled) {
      return res.status(402).json({
        error: result.error || 'Payment failed'
      })
    }

    res.json({
      success: true,
      transactionHash: result.transactionHash
    })
  } catch (error) {
    res.status(500).json({ error: 'Payment processing failed' })
  }
})

// Example 3B: Atomic settlement with callback transaction
app.post('/api/atomic-payment', async (req, res) => {
  try {
    const payment = req.body.payment
    const routePath = '/api/manual/atomic'

    // Define callback transaction generator
    // For Solana: generate instructions to execute after payment settles
    // For EVM: generate transaction data to execute after payment settles
    const callbackGenerator = async (payment: any) => {
      // Example: Generate callback to update user balance in your system
      if (x402Instance.config.network.startsWith('solana')) {
        // Return Solana instructions array
        return {
          type: 'solana' as const,
          data: [
            // Your custom Solana instructions here
            // e.g., update user account, mint NFT, etc.
          ]
        }
      } else {
        // Return EVM transaction data
        return {
          type: 'evm' as const,
          data: {
            to: '0xYourContractAddress',
            data: '0x...', // Encoded function call
            value: '0'
          }
        }
      }
    }

    const result = await x402Instance.atomicSettle(
      payment,
      routePath,
      callbackGenerator
    )

    if (!result.success) {
      return res.status(402).json({
        error: result.error || 'Atomic payment failed'
      })
    }

    res.json({
      success: true,
      settlementTxHash: result.settlementTxHash,
      callbackTxHash: result.callbackTxHash
    })
  } catch (error) {
    res.status(500).json({ error: 'Atomic payment processing failed' })
  }
})

// Example 4: Dynamic route management
app.post('/api/admin/add-route', (req, res) => {
  const { path, maxAmount, payTo, description } = req.body

  x402Instance.addRoute({
    path: path,
    paymentRequirements: {
      maxAmountRequired: maxAmount,
      payTo: payTo,
      description: description
    },
    autoSettle: true
  })

  res.json({ message: 'Route added successfully' })
})

app.delete('/api/admin/remove-route/:path', (req, res) => {
  x402Instance.removeRoute(req.params.path)
  res.json({ message: 'Route removed successfully' })
})

// Unprotected endpoint
app.get('/api/public/info', (req, res) => {
  res.json({ message: 'This is public information, no payment required' })
})

// Start server
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`X402 Example Server running on port ${PORT}`)
  console.log('Protected endpoints with different payment requirements:')
  console.log('  - GET /api/premium/features (1 USDC, auto-settle)')
  console.log('  - GET /api/pro/analytics (5 USDC, auto-settle)')
  console.log('  - GET /api/data/:id (0.5 USDC, verify only)')
  console.log('  - POST /api/manual-payment (2 USDC, manual control)')
  console.log('  - POST /api/atomic-payment (2 USDC, atomic)')
  console.log('Public endpoint:')
  console.log('  - GET /api/public/info (no payment required)')
})
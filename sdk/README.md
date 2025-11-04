# @closetome/x402-sdk

Server-side SDK for integrating X402 payment protocol into Express applications. Supports multiple routes with different payment requirements.

## Installation

```bash
npm install @closetome/x402-sdk
# or
yarn add @closetome/x402-sdk
```

## Quick Start

```typescript
import express from 'express'
import { createX402Middleware } from '@closetome/x402-sdk'

const app = express()

// Create X402 middleware with multiple route configurations
const x402Middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3000',
  defaultPayTo: 'DEFAULT_WALLET_ADDRESS', // Optional default
  routes: [
    {
      path: '/api/premium/*',
      paymentRequirements: {
        maxAmountRequired: '1000000', // 1 USDC
        payTo: 'PREMIUM_WALLET_ADDRESS',
        description: 'Premium API Access'
      },
      autoSettle: true
    },
    {
      path: '/api/pro/*',
      paymentRequirements: {
        maxAmountRequired: '5000000', // 5 USDC
        payTo: 'PRO_WALLET_ADDRESS',
        description: 'Pro Features'
      },
      autoSettle: true
    }
  ]
})

app.use(x402Middleware)

// Protected endpoints - automatically require payment
app.get('/api/premium/data', (req, res) => {
  res.json({ message: 'Premium data accessed' })
})

app.get('/api/pro/analytics', (req, res) => {
  res.json({ message: 'Pro analytics accessed' })
})
```

## Configuration

### X402Config

Main configuration object for the SDK:

```typescript
interface X402Config {
  network: 'solana' | 'solana-devnet' | 'base' | 'base-sepolia'
  facilitatorUrl: string
  routes: RouteConfig[]
  defaultPayTo?: string // Optional default payTo for all routes
  onPaymentFailed?: (error: Error, req: any) => Promise<void>
}
```

### RouteConfig

Configuration for each protected route:

```typescript
interface RouteConfig {
  path: string | RegExp  // Route path pattern
  paymentRequirements: {
    maxAmountRequired?: string
    payTo?: string       // Overrides defaultPayTo
    description?: string
    resource?: string
    // ... other requirements
  }
  autoSettle?: boolean   // Auto-settle after verification
  atomicSettle?: boolean // Use atomic settlement with callback
  onPaymentVerified?: (payment: any, req: any) => Promise<void>
  onPaymentSettled?: (payment: any, txHash: string, req: any) => Promise<void>
  onGenerateCallback?: (payment: any, req: any) => Promise<CallbackTransaction>
}
```

### X402MiddlewareOptions

Options for middleware behavior:

```typescript
interface X402MiddlewareOptions {
  bypassOnError?: boolean    // Continue if facilitator unavailable
  customHeaders?: Record<string, string>
}
```

## Usage Patterns

### 1. Multiple Routes with Different Requirements

Configure different payment amounts for different API tiers:

```typescript
const x402Middleware = createX402Middleware({
  network: 'solana',
  facilitatorUrl: 'http://localhost:3000',
  routes: [
    {
      path: '/api/basic/*',
      paymentRequirements: {
        maxAmountRequired: '100000',  // 0.1 USDC
        payTo: 'BASIC_WALLET',
        description: 'Basic Access'
      },
      autoSettle: true
    },
    {
      path: '/api/premium/*',
      paymentRequirements: {
        maxAmountRequired: '1000000', // 1 USDC
        payTo: 'PREMIUM_WALLET',
        description: 'Premium Access'
      },
      autoSettle: true,
      onPaymentSettled: async (payment, txHash, req) => {
        // Log premium access to database
        await logPremiumAccess(req.user, txHash)
      }
    },
    {
      path: /^\/api\/data\/\d+$/, // Regex pattern
      paymentRequirements: {
        maxAmountRequired: '500000',  // 0.5 USDC per item
        description: 'Data Access'
      },
      autoSettle: false // Verify only, settle later
    }
  ]
})
```

### 2. Manual Control with Route-Specific Payment

Use the X402Middleware class directly for more control:

```typescript
import { X402Middleware } from '@closetome/x402-sdk'

const x402 = new X402Middleware({
  network: 'base-sepolia',
  facilitatorUrl: 'http://localhost:3000',
  routes: [
    {
      path: '/api/service/*',
      paymentRequirements: {
        maxAmountRequired: '2000000',
        payTo: 'SERVICE_WALLET'
      }
    }
  ]
})

// Manual verification and settlement for specific route
app.post('/api/process-payment', async (req, res) => {
  const payment = req.body.payment
  const routePath = '/api/service/action'

  // Verify payment for specific route
  const isValid = await x402.verifyPayment(payment, routePath)
  if (!isValid) {
    return res.status(402).json({ error: 'Invalid payment' })
  }

  // Process the service...
  const result = await processService()

  // Settle payment after successful processing
  const settlement = await x402.settlePayment(payment, routePath)

  res.json({
    result,
    transactionHash: settlement.transactionHash
  })
})
```

### 3. Dynamic Route Management

Add or remove payment-protected routes at runtime:

```typescript
const x402 = new X402Middleware({
  network: 'solana',
  facilitatorUrl: 'http://localhost:3000',
  routes: [] // Start with no routes
})

// Add a new protected route
x402.addRoute({
  path: '/api/new-feature',
  paymentRequirements: {
    maxAmountRequired: '3000000',
    payTo: 'FEATURE_WALLET',
    description: 'New Feature Access'
  },
  autoSettle: true
})

// Remove a route
x402.removeRoute('/api/old-feature')
```

### 4. Atomic Settlement with Callback

Execute custom logic atomically with payment settlement:

```typescript
const routes = [
  {
    path: '/api/atomic-action',
    paymentRequirements: {
      maxAmountRequired: '3000000',
      description: 'Atomic Operation'
    },
    atomicSettle: true,
    onGenerateCallback: async (payment, req) => {
      // Generate callback transaction to execute atomically with settlement
      if (network === 'solana') {
        // Return Solana instructions
        return {
          type: 'solana',
          data: [
            // Your custom instructions (e.g., update account, mint NFT)
          ]
        }
      } else {
        // Return EVM transaction
        return {
          type: 'evm',
          data: {
            to: '0xContractAddress',
            data: '0x...', // Encoded function call
            value: '0'
          }
        }
      }
    }
  }
]
```

Manual atomic settlement:

```typescript
const x402 = new X402Middleware(config)

// Define custom callback generator
const callbackGenerator = async (payment) => {
  // Generate transaction/instructions based on payment
  return {
    type: 'solana',
    data: [...] // Your instructions
  }
}

// Execute atomic settlement
const result = await x402.atomicSettle(
  payment,
  '/api/service',
  callbackGenerator
)

console.log('Settlement TX:', result.settlementTxHash)
console.log('Callback TX:', result.callbackTxHash)
```

### 5. Verify-Only Pattern

For cases where you want to verify payment but settle later:

```typescript
const routes = [
  {
    path: '/api/download/*',
    paymentRequirements: {
      maxAmountRequired: '1000000',
      description: 'Download Access'
    },
    autoSettle: false // Only verify, don't settle yet
  }
]

app.get('/api/download/file', async (req, res) => {
  const paymentInfo = (req as any).x402

  if (!paymentInfo?.verified) {
    return res.status(402).json({ error: 'Payment required' })
  }

  // Start download...
  const stream = await getFileStream()

  // Settle payment after successful download
  stream.on('end', async () => {
    await x402.settlePayment(paymentInfo.payment, req.path)
  })

  stream.pipe(res)
})
```

## Payment Header Format

Clients should send payment in the `X-X402-Payment` header:

```
X-X402-Payment: <base64-encoded-payment-payload>
```

## Request Context

After successful payment verification, payment info is added to the request:

```typescript
app.get('/api/protected', (req, res) => {
  const x402Info = (req as any).x402
  // Standard settlement:
  // {
  //   payment: <payment-payload>,
  //   route: '/api/protected',
  //   verified: true,
  //   settled: true|false,
  //   atomic: false,
  //   transactionHash?: 'tx-hash'
  // }

  // Atomic settlement:
  // {
  //   payment: <payment-payload>,
  //   route: '/api/protected',
  //   settled: true,
  //   atomic: true,
  //   settlementTxHash?: 'settlement-tx-hash',
  //   callbackTxHash?: 'callback-tx-hash'
  // }
})
```

## Network Support

| Network | Chain | Token | Status |
|---------|-------|-------|--------|
| solana | Solana Mainnet | USDC | ✅ Supported |
| solana-devnet | Solana Devnet | USDC | ✅ Supported |
| base | Base Mainnet | USDC | ✅ Supported |
| base-sepolia | Base Sepolia | USDC | ✅ Supported |

## Error Handling

Configure error handling and bypass options:

```typescript
const x402Middleware = createX402Middleware(
  {
    network: 'solana',
    facilitatorUrl: 'http://localhost:3000',
    routes: [...],
    onPaymentFailed: async (error, req) => {
      console.error(`Payment failed for ${req.path}:`, error)
      // Send alert, log to monitoring service, etc.
    }
  },
  {
    bypassOnError: true, // Continue if facilitator is down
    customHeaders: {
      'X-Payment-Provider': 'MyApp'
    }
  }
)
```

## Examples

See the [examples](./examples) directory for complete working examples:

- `basic-server.ts` - Complete Express server with multiple payment tiers

## Development

```bash
# Install dependencies
yarn install

# Build the SDK
yarn build

# Run example server
yarn example

# Development mode
yarn dev
```

## License

MIT
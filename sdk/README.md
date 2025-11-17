# X402 SDK

TypeScript SDK for integrating X402 payments into your applications, supporting both Solana (SVM) and EVM chains (Base, etc.) with server-side middleware and client-side payments.

## Installation

```bash
yarn add @closetome/x402-sdk
```

## Features

- 🔧 Server-side Express middleware
- 💳 Client-side payment creation
- 🚀 Atomic transaction support (Solana & EVM)
- 🎯 Dynamic callback generation (EVM atomic)
- 📝 Type-safe route definitions
- 🤖 Automatic schema generation
- 🌐 Multi-chain support (Solana, Base)
- ⚡ EIP-3009 gasless payments (EVM)

## Server Usage

### Basic Setup (Solana)

```typescript
import { createX402Middleware } from '@closetome/x402-sdk'

const middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3010',
  routes: [{
    path: '/api/protected',
    paymentRequirements: async (req) => ({
      maxAmountRequired: '1000000', // 1 USDC (6 decimals)
      payTo: WALLET_ADDRESS
    }),
    autoSettle: true
  }],
  serverWallet: {
    svm: { secretKey: SERVER_SECRET_KEY }
  }
})

app.use(middleware)
```

### EVM Setup (Base Chain)

```typescript
import { createX402Middleware } from '@closetome/x402-sdk'

const middleware = createX402Middleware({
  network: 'base-sepolia',
  facilitatorUrl: 'http://localhost:3010',
  routes: [{
    path: '/api/protected',
    paymentRequirements: async (req) => ({
      maxAmountRequired: '100000', // 0.1 USDC (6 decimals)
      payTo: WALLET_ADDRESS
    }),
    autoSettle: true
  }],
  serverWallet: {
    evm: { privateKey: SERVER_PRIVATE_KEY }
  }
})

app.use(middleware)
```

### Atomic X402 with Callbacks (EVM)

```typescript
import { defineRoute, createTypedRoute } from '@closetome/x402-sdk'
import { ethers } from 'ethers'

interface PremiumInput {
  tier: 'basic' | 'premium' | 'enterprise'
}

const premiumRoute = defineRoute<PremiumInput>({
  method: 'GET',
  path: '/api/premium',
  atomic: true,      // Enable atomic settlement
  autoSettle: true,

  paymentRequirements: ({ input }) => {
    const tierPricing = {
      basic: 100000,      // 0.1 USDC
      premium: 500000,    // 0.5 USDC
      enterprise: 1000000 // 1 USDC
    }

    return {
      maxAmountRequired: tierPricing[input.tier || 'basic'].toString(),
      payTo: PAYMENT_RECIPIENT,
      description: `Access to ${input.tier} tier with NFT minting`
    }
  },

  // Generate callback dynamically based on actual payment
  onGenerateCallback: async (payment) => {
    const evmPayment = payment as EVMPaymentPayload
    const userAddress = evmPayment.userPay.from
    const paymentAmount = evmPayment.userPay.value

    // Encode NFT mint function call
    const iface = new ethers.Interface([
      'function mint(address to, uint256 amount)'
    ])
    const mintCalldata = iface.encodeFunctionData('mint', [
      userAddress,   // Mint to user's address
      paymentAmount  // Mint amount equal to payment
    ])

    return {
      type: 'evm',
      data: {
        target: NFT_CONTRACT_ADDRESS,
        calldata: mintCalldata
      }
    }
  },

  handler: ({ input }) => ({
    message: `Welcome to ${input.tier} tier!`,
    nftMinted: true
  })
})

const middleware = createX402Middleware({
  network: 'base-sepolia',
  facilitatorUrl: 'http://localhost:3010',
  routes: [createTypedRoute(premiumRoute)],
  serverWallet: {
    evm: { privateKey: SERVER_PRIVATE_KEY }
  }
})

// Register Express route handler
app.get('/api/premium', (req, res) => {
  const x402Info = req.x402
  res.json({
    message: x402Info.atomic ? 'Atomic payment successful' : 'Payment successful',
    transactionHash: x402Info.settlementTxHash,
    callbackTxHash: x402Info.callbackTxHash
  })
})
```

## Client Usage

### Solana Client

```typescript
import { X402Client, Keypair } from '@closetome/x402-sdk'

const keypair = Keypair.fromSecretKey(SECRET_KEY)

const client = new X402Client({
  serverUrl: 'http://localhost:4000',
  wallet: {
    svm: { keypair }
  }
})

// Standard payment
const result = await client.requestWithPayment('/api/protected')

// Atomic payment
const result = await client.requestWithAtomicPayment('/api/atomic')
```

### EVM Client (Base)

```typescript
import { X402Client } from '@closetome/x402-sdk'

const client = new X402Client({
  serverUrl: 'http://localhost:4000',
  wallet: {
    evm: { privateKey: PRIVATE_KEY }
  }
})

// Standard payment (verify + settle, 2 transactions)
const result = await client.requestWithPayment('/api/protected')

// Atomic payment (1 transaction with callback)
const result = await client.requestWithPayment('/api/premium?tier=basic')
```

## Key Concepts

### X-Payment Header Format

All payments use the `X-Payment` header with this structure:

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base-sepolia",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x...",
      "to": "0x...",
      "value": "100000",
      "validAfter": "1234567890",
      "validBefore": "1234567890",
      "nonce": "0x..."
    }
  }
}
```

### EVM Atomic Flow

1. **Client** creates EIP-3009 `transferWithAuthorization` signature
2. **Server** middleware generates `feePay` signature and callback
3. **Facilitator** executes proxy contract in single transaction:
   - User pays server (userPay)
   - Server pays facilitator fee (feePay)
   - Execute callback (e.g., mint NFT)

### Callback Generation

The `onGenerateCallback` function receives payment data and returns callback transaction:

```typescript
onGenerateCallback: async (payment: PaymentPayload, req: Request) => {
  return {
    type: 'evm',
    data: {
      target: CONTRACT_ADDRESS,
      calldata: ENCODED_FUNCTION_CALL
    }
  }
}
```

## API Reference

### Server

- `createX402Middleware(config)` - Create Express middleware
- `defineRoute<TInput, TOutput>(definition)` - Define type-safe route
- `createTypedRoute(definition)` - Convert to RouteConfig

**Route Definition Options:**
- `path` - Route path (string or RegExp)
- `atomic` - Enable atomic settlement (boolean)
- `autoSettle` - Auto-settle after verification (boolean)
- `paymentRequirements` - Function to generate payment requirements
- `onGenerateCallback` - Generate callback for atomic transactions (EVM)
- `handler` - Route handler function

### Client

- `X402Client` - Main client class
  - `getPaymentRequirements(endpoint, params?)` - Get 402 response
  - `createPaymentTransaction(requirements)` - Create payment (EVM/SVM)
  - `requestWithPayment(endpoint, options?)` - Make payment and request
  - `requestWithAtomicPayment(endpoint, options?)` - Atomic payment (Solana)

### Types

```typescript
interface EVMPaymentPayload {
  userPay: EVMPayAuth
}

interface EVMCallbackData {
  target: string    // Contract address
  calldata: string  // Encoded function call
}

interface CallbackTransaction {
  type: 'evm' | 'solana'
  data: EVMCallbackData | SolanaCallbackData
}
```

## Supported Networks

- **Solana**: `solana`, `solana-devnet`
- **Base**: `base`, `base-sepolia`

## Examples

See the `examples/` directory for complete working examples:
- `examples/server/base-server.ts` - Base chain server with atomic callbacks
- `examples/client/base-client.ts` - Base chain client

## License

MIT

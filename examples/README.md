# X402 Payment Protocol - Examples

This directory contains complete examples demonstrating both **Standard** and **Atomic** X402 payment flows on Solana.

## 📁 Directory Structure

```
examples/
├── server/
│   └── server.ts          # Complete server with both Standard & Atomic routes
├── client/
│   ├── client.ts          # Standard X402 client example
│   └── atomic-client.ts   # Interactive atomic payment client
└── README.md             # This file
```

## 🚀 Quick Start

### 1. Setup Environment

Create `.env` file in the `examples/server` directory:

```bash
# Server configuration
PORT=4000
FACILITATOR_URL=http://localhost:3010

# Server keypair for signing atomic transactions (base58 encoded)
SERVER_ACCOUNT_SECRET_KEY=your_server_secret_key_here

# Optional: Override payment recipient
PAYMENT_RECIPIENT=your_wallet_address_here
```

Create `.env` file in the `examples/client` directory:

```bash
# Client configuration
SERVER_URL=http://localhost:4000

# Payer wallet (must have devnet USDC)
PAYER_SECRET_KEY=your_payer_secret_key_here
```

### 2. Start the Facilitator

```bash
cd facilitator
yarn start
```

### 3. Start the Example Server

```bash
cd examples/server
yarn start
```

### 4. Run Clients

**Standard Payment:**
```bash
cd examples/client
node client.ts
```

**Atomic Payment (Interactive):**
```bash
cd examples/client
node atomic-client.ts
```

## 📖 Payment Flows

### Standard X402 Payment

Traditional two-step payment flow:

1. **Client requests endpoint** → Server returns 402 with payment requirements
2. **Client creates payment transaction** → Transfers USDC to recipient
3. **Client sends payment proof** → Server verifies and grants access

**Endpoint:** `GET /api/standard/protected`

**Features:**
- Simple payment verification
- Payment transferred directly to recipient
- No additional on-chain operations

**Example:**
```typescript
// Server route configuration
{
  path: '/api/standard/protected',
  paymentRequirements: {
    maxAmountRequired: '1000000', // 1 USDC
    payTo: WALLET_ADDRESS,
    description: 'Access to protected endpoint'
  },
  autoSettle: true
}
```

### Atomic X402 Payment

Advanced payment flow with callback instructions:

1. **Client discovers schema** → Server returns 402 with input/output schema
2. **Client collects inputs** → Interactive parameter collection
3. **Client requests final requirements** → With user-provided parameters
4. **Client creates atomic transaction** → Payment + callback instructions
5. **Server signs transaction** → Signs callback instructions
6. **Facilitator settles** → Single atomic transaction on-chain

**Endpoint:** `GET /api/atomic/premium?amount=1000000&message=Hello&premium=true`

**Features:**
- ✅ Type-safe with TypeScript interfaces
- ✅ Automatic schema generation
- ✅ Interactive parameter discovery
- ✅ Dynamic pricing based on inputs
- ✅ Payment + callback in single transaction
- ✅ Atomic execution (both succeed or both fail)

**Example:**
```typescript
// Define input/output types
interface PremiumInput {
  amount?: number
  message?: string
  premium?: 'true' | 'false'
}

interface PremiumOutput {
  message: string
  queryParams: { ... }
  payment: { ... }
}

// Create type-safe route
const route = defineRoute<PremiumInput, PremiumOutput>({
  method: 'GET',
  path: '/api/atomic/premium',
  atomic: true,
  autoSettle: true,

  // Schema for API documentation
  inputSchema: {
    amount: prop.number('Payment amount in microUSDC'),
    message: prop.string('Custom message'),
    premium: prop.string('Premium flag', { enum: ['true', 'false'] })
  },

  // Dynamic payment requirements
  paymentRequirements: ({ input }) => {
    const amount = input.amount || 1000000
    // Create callback instructions...
    return { maxAmountRequired: amount.toString(), ... }
  },

  // Type-safe handler
  handler: ({ input, req }) => {
    return { message: 'Success', ... }
  }
})
```

## 🔑 Key Differences

| Feature | Standard X402 | Atomic X402 |
|---------|---------------|-------------|
| **Transaction Count** | 1 (payment only) | 1 (payment + callbacks) |
| **On-chain Operations** | Transfer USDC | Transfer + Callback instructions |
| **Type Safety** | Basic | Full TypeScript support |
| **Schema** | Manual | Auto-generated |
| **Dynamic Pricing** | Static | Based on request params |
| **Parameter Discovery** | Manual | Interactive |
| **Use Cases** | Simple paywalls | Complex workflows, NFT minting, state updates |

## 🎯 Use Cases

### Standard X402
- Simple API paywalls
- Content access gates
- Basic subscription checks
- Pay-per-use services

### Atomic X402
- NFT minting with payment
- Subscription activation with on-chain record
- Game item purchases with instant delivery
- Multi-step operations requiring atomicity
- Any scenario requiring payment + on-chain action together

## 🛠️ Development

### Server Implementation

```typescript
import { createX402Middleware, defineRoute, prop } from '@solana-sdk'

// Standard route
const standardRoute = {
  path: '/api/protected',
  paymentRequirements: {
    maxAmountRequired: '1000000',
    payTo: WALLET_ADDRESS
  },
  autoSettle: true
}

// Atomic route (type-safe)
const atomicRoute = defineRoute<Input, Output>({
  method: 'GET',
  path: '/api/atomic',
  atomic: true,
  autoSettle: true,
  inputSchema: { /* ... */ },
  outputSchema: { /* ... */ },
  paymentRequirements: ({ input }) => { /* ... */ },
  handler: ({ input, req }) => { /* ... */ }
})

// Create middleware
const middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3010',
  routes: [standardRoute, createTypedRoute(atomicRoute)],
  serverKeypair: '...' // Required for atomic
})
```

### Client Implementation

**Standard:**
```typescript
import { X402Client } from '@solana-sdk'

const client = new X402Client({
  serverUrl: 'http://localhost:4000',
  payerKeypair: keypair
})

const result = await client.requestWithPayment('/api/protected', {
  method: 'GET'
})
```

**Atomic (Interactive):**
```typescript
// 1. Discover schema
const requirements = await client.getPaymentRequirements('/api/atomic')
const inputSchema = requirements.outputSchema.input

// 2. Collect user inputs
const inputs = await collectInputFromSchema(inputSchema.properties)

// 3. Get final requirements
const finalReqs = await client.getPaymentRequirements(`/api/atomic?${params}`)

// 4. Execute atomic payment
const result = await client.requestWithAtomicPayment(`/api/atomic?${params}`)
```

## 📚 Learn More

- **Standard X402**: See `client/client.ts` for complete example
- **Atomic X402**: See `client/atomic-client.ts` for interactive flow
- **Server Setup**: See `server/server.ts` for both implementations
- **Type Safety**: Check `route-schema.ts` for type system details

## ⚠️ Security Notes

### For Atomic Transactions

1. **Server Keypair**: Keep `SERVER_ACCOUNT_SECRET_KEY` secure
2. **Callback Validation**: Client validates callback instructions don't contain user wallet
3. **Compute Limit**: Facilitator enforces `maxComputeUnitLimitAtomic` (default 400k)
4. **Signer Requirements**: Callback instructions must include server as signer

### Best Practices

- Always validate callback instructions on client side
- Use enum types for limited option sets
- Set appropriate compute unit limits
- Test thoroughly on devnet before mainnet
- Keep server keypair secure and separate from payment recipient

## 🐛 Troubleshooting

**Problem:** Client gets 402 but can't find outputSchema
**Solution:** Make sure server route has `inputSchema` and `outputSchema` defined

**Problem:** Atomic transaction fails with "invalid signer"
**Solution:** Ensure callback instructions mark server account as `isSigner: true`

**Problem:** Transaction exceeds compute limit
**Solution:** Reduce number of callback instructions or adjust `maxComputeUnitLimitAtomic`

**Problem:** Client validation fails for callback
**Solution:** Check that callback instructions don't reference user's wallet address

## 🤝 Contributing

Feel free to extend these examples with:
- POST request handling
- More complex atomic operations
- Different callback instruction types
- Error handling improvements
- Additional validation logic

## 📝 License

MIT

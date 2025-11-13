# X402 Payment Protocol - Solana & Base Implementation

A complete implementation of the X402 Payment Protocol supporting both **Standard** and **Atomic** payment flows on Solana and Base networks.

## 🌟 Overview

The X402 Payment Protocol enables HTTP servers to require cryptocurrency payments for API access. This implementation adds advanced **Atomic Transaction** support, allowing payment and callback operations to execute atomically in a single blockchain transaction.

## 📦 Project Structure

```
closetome-facilitator/
├── facilitator/          # Payment verification and settlement service
├── solana-sdk/          # TypeScript SDK for X402 integration
└── examples/            # Complete working examples
    ├── server/          # Example servers (Standard + Atomic)
    └── client/          # Example clients with interactive flows
```

## ✨ Features

### Standard X402 Payments
- ✅ Simple payment verification
- ✅ Automatic settlement
- ✅ Multi-network support (Solana, Base)
- ✅ Compute budget validation
- ✅ On-chain account verification

### Atomic X402 Payments (NEW!)
- 🚀 **Payment + Callback in single transaction**
- 🔒 **Atomic execution** - both succeed or both fail
- 📝 **Type-safe with TypeScript**
- 🤖 **Automatic schema generation**
- 🎯 **Interactive parameter discovery**
- 💰 **Dynamic pricing based on params**
- ⚡ **Server-side transaction signing**

## 🚀 Quick Start

### 1. Install Dependencies

\`\`\`bash
# Install root dependencies
yarn install

# Install facilitator dependencies
cd facilitator && yarn install

# Install SDK dependencies
cd ../solana-sdk && yarn install

# Install example dependencies
cd ../examples/server && yarn install
cd ../examples/client && yarn install
\`\`\`

### 2. Start the Facilitator

\`\`\`bash
cd facilitator
yarn start
\`\`\`

The facilitator will start on \`http://localhost:3010\`

### 3. Run Example Server

\`\`\`bash
cd examples/server
yarn start
\`\`\`

The server will start on \`http://localhost:4000\` with both Standard and Atomic endpoints.

### 4. Test with Clients

**Standard Payment Flow:**
\`\`\`bash
cd examples/client
node client.ts
\`\`\`

**Atomic Payment Flow (Interactive):**
\`\`\`bash
cd examples/client
node atomic-client.ts
\`\`\`

## 📚 Documentation

### Core Components

- **[Facilitator](./facilitator/README.md)** - Payment verification and settlement service
- **[Solana SDK](./solana-sdk/README.md)** - TypeScript SDK for server and client integration
- **[Examples](./examples/README.md)** - Complete working examples with both payment flows

## 🔑 Key Differences

| Feature | Standard X402 | Atomic X402 |
|---------|---------------|-------------|
| Transactions | 1 (payment only) | 1 (payment + callbacks) |
| Type Safety | Basic | Full TypeScript |
| Schema | Manual | Auto-generated |
| Pricing | Static | Dynamic |
| On-chain Actions | Transfer only | Transfer + Custom |
| Parameter Discovery | None | Interactive |

## 💻 Usage Examples

### Server-Side (Standard)

\`\`\`typescript
import { createX402Middleware } from '@solana-sdk'

const middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3010',
  routes: [{
    path: '/api/protected',
    paymentRequirements: {
      maxAmountRequired: '1000000', // 1 USDC
      payTo: WALLET_ADDRESS
    },
    autoSettle: true
  }]
})

app.use(middleware)
\`\`\`

### Server-Side (Atomic + Type-Safe)

\`\`\`typescript
import { defineRoute, createTypedRoute, prop } from '@solana-sdk'

interface PremiumInput {
  amount?: number
  message?: string
}

const route = defineRoute<PremiumInput, PremiumOutput>({
  method: 'GET',
  path: '/api/premium',
  atomic: true,
  autoSettle: true,

  inputSchema: {
    amount: prop.number('Payment amount'),
    message: prop.string('Custom message')
  },

  paymentRequirements: ({ input }) => {
    // Dynamic pricing!
    const amount = input.amount || 1000000

    // Create callback instructions
    const callbacks = [/* ... */]

    return {
      maxAmountRequired: amount.toString(),
      payTo: WALLET_ADDRESS,
      extra: { callbackInstructions: serialize(callbacks) }
    }
  },

  handler: ({ input, req }) => {
    return { success: true, message: input.message }
  }
})
\`\`\`

### Client-Side

\`\`\`typescript
import { X402Client } from '@solana-sdk'

const client = new X402Client({
  serverUrl: 'http://localhost:4000',
  payerKeypair: keypair
})

// Standard payment
const result = await client.requestWithPayment('/api/protected')

// Atomic payment
const result = await client.requestWithAtomicPayment('/api/premium?amount=2000000')
\`\`\`

## 🛠️ Development

### Prerequisites

- Node.js >= 16
- Yarn
- Solana CLI (for devnet testing)
- TypeScript

### Building

\`\`\`bash
# Build facilitator
cd facilitator && yarn build

# Build SDK
cd solana-sdk && yarn build
\`\`\`

### Testing

\`\`\`bash
# Test facilitator
cd facilitator && yarn test

# Test SDK
cd solana-sdk && yarn test

# Run examples
cd examples/server && yarn start
cd examples/client && node atomic-client.ts
\`\`\`

## 🔒 Security

### Atomic Transactions

- ✅ Client validates callback instructions don't contain user wallet
- ✅ Facilitator enforces \`maxComputeUnitLimitAtomic\` (default 400k)
- ✅ Server keypair required for signing (kept secure)
- ✅ Position-based instruction validation
- ✅ Signer account handling for decompiled transactions

### Best Practices

- Keep server keypair separate from payment recipient
- Validate all callback instructions client-side
- Set appropriate compute limits
- Test thoroughly on devnet
- Use enum types for limited options
- Implement rate limiting on server

## 🌐 Networks

- **Solana Mainnet**: Full support
- **Solana Devnet**: Full support (testing)
- **Base**: Planned
- **Base Sepolia**: Planned

## 📖 Learn More

- **[Facilitator Documentation](./facilitator/README.md)** - Verification service details
- **[SDK Documentation](./solana-sdk/README.md)** - Integration guide
- **[Examples](./examples/README.md)** - Working code examples

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

MIT

---

**Need help?** Check out the [examples](./examples/) directory for complete working implementations of both Standard and Atomic payment flows.

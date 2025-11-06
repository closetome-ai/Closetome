# X402 Solana SDK

TypeScript SDK for integrating X402 payments into your applications, supporting both server-side middleware and client-side payments.

## Installation

\`\`\`bash
yarn add @closetome/x402-solana-sdk
\`\`\`

## Features

- 🔧 Server-side Express middleware
- 💳 Client-side payment creation
- 🚀 Atomic transaction support
- 📝 Type-safe route definitions
- 🤖 Automatic schema generation
- 🎯 Interactive parameter discovery

## Server Usage

### Standard X402

\`\`\`typescript
import { createX402Middleware } from '@closetome/x402-solana-sdk'

const middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3010',
  routes: [{
    path: '/api/protected',
    paymentRequirements: {
      maxAmountRequired: '1000000',
      payTo: WALLET_ADDRESS
    },
    autoSettle: true
  }]
})

app.use(middleware)
\`\`\`

### Atomic X402 (Type-Safe)

\`\`\`typescript
import { defineRoute, createTypedRoute, prop } from '@closetome/x402-solana-sdk'

interface Input {
  amount?: number
  message?: string
}

const route = defineRoute<Input, Output>({
  method: 'GET',
  path: '/api/atomic',
  atomic: true,
  autoSettle: true,
  
  inputSchema: {
    amount: prop.number('Payment amount'),
    message: prop.string('Custom message')
  },
  
  paymentRequirements: ({ input }) => ({
    maxAmountRequired: (input.amount || 1000000).toString(),
    payTo: WALLET_ADDRESS,
    extra: { callbackInstructions: [...] }
  }),
  
  handler: ({ input }) => ({ success: true })
})

const middleware = createX402Middleware({
  network: 'solana-devnet',
  facilitatorUrl: 'http://localhost:3010',
  routes: [createTypedRoute(route)],
  serverKeypair: SERVER_SECRET_KEY // Required for atomic
})
\`\`\`

## Client Usage

\`\`\`typescript
import { X402Client } from '@closetome/x402-solana-sdk'

const client = new X402Client({
  serverUrl: 'http://localhost:4000',
  payerKeypair: keypair,
  network: 'solana-devnet'
})

// Standard payment
const result = await client.requestWithPayment('/api/protected')

// Atomic payment
const result = await client.requestWithAtomicPayment('/api/atomic?amount=2000000')
\`\`\`

## API Reference

### Server

- \`createX402Middleware(config)\` - Create Express middleware
- \`defineRoute<TInput, TOutput>(definition)\` - Define type-safe route
- \`createTypedRoute(definition)\` - Convert to RouteConfig
- \`prop.string(desc, options)\` - Schema property builders
- \`prop.number(desc)\`
- \`prop.boolean(desc)\`
- \`prop.object(props, desc)\`

### Client

- \`X402Client\` - Main client class
  - \`getPaymentRequirements(endpoint)\` - Get 402 response
  - \`createPaymentTransaction(requirements)\` - Create payment tx
  - \`createAtomicPaymentTransaction(requirements)\` - Create atomic tx
  - \`requestWithPayment(endpoint, options)\` - Standard flow
  - \`requestWithAtomicPayment(endpoint, options)\` - Atomic flow

## License

MIT

# X402 Example Server

Complete example server demonstrating both Standard and Atomic X402 payment flows.

## Features

- ✅ Standard X402 payment endpoint
- ✅ Atomic X402 payment with type safety
- ✅ Dynamic pricing based on parameters
- ✅ Automatic schema generation
- ✅ Server-side transaction signing

## Quick Start

```bash
yarn install
yarn start
```

Server will start on `http://localhost:4000`

## Endpoints

### GET /health
Health check endpoint (no payment required)

### GET /api/standard/protected
Standard X402 payment (1 USDC fixed)

### GET /api/atomic/premium
Atomic X402 payment with parameters:
- `amount` - Payment amount in microUSDC
- `message` - Custom message for transaction memo  
- `premium` - Set to "true" for premium access

## Configuration

Create `.env` file:

```
PORT=4000
FACILITATOR_URL=http://localhost:3010
SERVER_ACCOUNT_SECRET_KEY=your_server_keypair_base58
PAYMENT_RECIPIENT=your_wallet_address
```

## Code Structure

- Standard route: Simple static payment requirements
- Atomic route: Type-safe with dynamic requirements and callback instructions
- Type definitions: TypeScript interfaces for input/output
- Handlers: Type-checked request handlers

## License

MIT

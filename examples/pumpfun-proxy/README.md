# Pumpfun Proxy Server - X402 Payment Example

This example demonstrates an X402 payment proxy for Pumpfun/PumpAMM trading. Users pay SOL to the server via X402, and the server executes the trade and transfers tokens to the user's wallet.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Workflow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User requests to buy tokens                                 │
│     POST /buy { mint, userWallet, solAmount }                   │
│                        │                                        │
│                        ▼                                        │
│  2. Server returns 402 Payment Required                         │
│     { payTo: SERVER_WALLET, amount: SOL_AMOUNT }                │
│                        │                                        │
│                        ▼                                        │
│  3. User sends SOL payment to server wallet                     │
│     (via X402 payment header)                                   │
│                        │                                        │
│                        ▼                                        │
│  4. Server executes trade on Pumpfun/PumpAMM                    │
│     - Auto-detects which DEX to use                             │
│     - Buys tokens with received SOL                             │
│                        │                                        │
│                        ▼                                        │
│  5. Server transfers tokens to user's wallet                    │
│     - Creates ATA if needed                                     │
│     - Transfers all received tokens                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Automatic DEX Detection**: Automatically selects Pumpfun (bonding curve) or PumpAMM based on token status
- **X402 Payment Integration**: Standard X402 payment flow for SOL payments
- **Token Transfer**: Automatically transfers purchased tokens to user's wallet
- **ATA Management**: Creates Associated Token Account if needed

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Set your server private key in `.env`:
```
SERVER_PRIVATE_KEY=your_base58_private_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PORT=3000
```

4. Build and run:
```bash
npm run build
npm start
```

Or for development:
```bash
npm run dev
```

## API Endpoints

### GET /quote/:mint

Get a quote for buying tokens.

**Parameters:**
- `mint` (path) - Token mint address
- `solAmount` (query) - SOL amount to spend (default: 0.01)

**Response:**
```json
{
  "mint": "...",
  "solAmount": "0.01",
  "dexType": "pumpfun | pumpamm",
  "serverWallet": "...",
  "message": "To buy tokens, send 0.01 SOL to ..."
}
```

### POST /buy

Buy tokens on Pumpfun/PumpAMM.

**Request Body:**
```json
{
  "mint": "TokenMintAddress",
  "userWallet": "UserWalletAddress",
  "solAmount": "0.1",
  "slippageBps": 500
}
```

**Without X-Payment Header:**
Returns 402 Payment Required:
```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana",
    "maxAmountRequired": "100000000",
    "payTo": "ServerWalletAddress",
    "description": "Buy tokens on Pumpfun/PumpAMM - 0.1 SOL"
  }]
}
```

**With X-Payment Header:**
Returns success response:
```json
{
  "success": true,
  "txHash": "...",
  "tokensReceived": "1000000000",
  "dexUsed": "pumpfun"
}
```

### GET /health

Health check endpoint.

## DEX Selection Logic

The server automatically selects the correct DEX based on token status:

1. **Check PumpAMM Pool**: If an AMM pool exists, use PumpAMM
2. **Check Bonding Curve**: If bonding curve exists and is not complete, use Pumpfun
3. **Graduated Tokens**: If bonding curve is complete, use PumpAMM

## Security Considerations

1. **Server Wallet**: The server wallet holds funds temporarily. Ensure it's properly secured.
2. **Slippage**: Default slippage is 5% (500 bps). Adjust based on market conditions.
3. **Payment Verification**: In production, verify X402 payments through the facilitator service.
4. **Rate Limiting**: Consider adding rate limiting for production use.

## Example Usage with cURL

```bash
# Get quote
curl "http://localhost:3000/quote/YourTokenMint?solAmount=0.1"

# Buy tokens (requires X-Payment header in production)
curl -X POST http://localhost:3000/buy \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "YourTokenMint",
    "userWallet": "YourWalletAddress",
    "solAmount": "0.1",
    "slippageBps": 500
  }'
```

## Pumpfun vs PumpAMM

| Feature | Pumpfun (Bonding Curve) | PumpAMM |
|---------|------------------------|---------|
| Program ID | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Curve Type | Bonding curve | Constant product (x*y=k) |
| Quote Token | SOL (direct) | wSOL (wrapped) |
| Stage | Pre-graduation | Post-graduation |
| Fee Recipient | `CebN5WGQ4jvEPvsVU4...` | `7hTckgnGnLQR6sdH7Yk...` |

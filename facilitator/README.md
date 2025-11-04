# X402 Facilitator Server

A facilitator server implementation for the X402 payment protocol, supporting Solana and Base networks.

## Features

- **GET /supported** - Returns the list of supported payment networks
- **POST /verify** - Verifies a payment payload against requirements
- **POST /settle** - Settles (submits) a payment to the blockchain

## Supported Networks

- Solana (mainnet and devnet)
- Base (mainnet and sepolia testnet)

## Installation

```bash
# Install dependencies
yarn install

# Build the project
yarn build
```

## Running the Server

```bash
# Development mode with hot reload
yarn dev

# Production mode
yarn start
```

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
PORT=3000
NODE_ENV=development
```

## API Endpoints

### GET /supported

Returns the list of supported payment networks.

**Response:**
```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "solana-devnet",
      "extra": {
        "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"
      }
    },
    // ... other networks
  ]
}
```

### POST /verify

Verifies a payment payload against requirements.

**Request:**
```json
{
  "x402Version": 1,
  "paymentPayload": {},
  "paymentRequirements": {
    "x402Version": 1,
    "scheme": "exact",
    "network": "solana",
    "amount": "1000000",
    "recipient": "..."
  }
}
```

**Response:**
```json
{
  "isValid": true
}
```

### POST /settle

Settles (submits) a payment to the blockchain.

**Request:**
```json
{
  "x402Version": 1,
  "paymentPayload": {},
  "paymentRequirements": {
    "x402Version": 1,
    "scheme": "exact",
    "network": "solana",
    "amount": "1000000",
    "recipient": "..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "..."
}
```

## Development

The project structure:

```
src/
├── index.ts           # Main server file
├── types/            # TypeScript type definitions
├── routes/           # API endpoint handlers
└── services/         # Blockchain service implementations
```

## License

MIT
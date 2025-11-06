# X402 Facilitator - Payment Verification Service

The facilitator service handles payment verification and settlement for the X402 protocol, supporting both Standard and Atomic payment flows.

## Features

- ✅ Standard payment verification and settlement
- ✅ Atomic transaction verification with callback instructions
- ✅ Compute budget validation
- ✅ On-chain account verification
- ✅ Position-based instruction validation
- ✅ Support for Solana (mainnet & devnet)

## Quick Start

\`\`\`bash
yarn install
yarn start
\`\`\`

The service will start on \`http://localhost:3010\`

## API Endpoints

### GET /supported
Returns supported payment methods and extra configuration

### POST /verify
Verifies a standard payment transaction

### POST /settle
Settles a verified payment transaction

### POST /atomic/verify
Verifies an atomic payment transaction with callback instructions

### POST /atomic/settle
Settles an atomic payment transaction

## Configuration

Edit \`src/config.ts\` to configure:
- Networks (Solana mainnet/devnet, Base)
- RPC endpoints
- Compute limits
- Fee payer settings

## Security

- Validates compute budget instructions
- Checks for ATA creation patterns  
- Verifies on-chain account states
- Enforces max compute unit limits for atomic transactions
- Position-based instruction validation
- Handles signer account differences in decompiled transactions

## License

MIT

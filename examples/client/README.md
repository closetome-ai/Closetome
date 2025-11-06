# X402 Example Clients

Example clients demonstrating Standard and Atomic X402 payment flows.

## Files

- \`client.ts\` - Standard X402 payment flow
- \`atomic-client.ts\` - Interactive atomic payment flow

## Quick Start

\`\`\`bash
yarn install

# Standard flow
node client.ts

# Atomic flow (interactive)
node atomic-client.ts
\`\`\`

## Configuration

Create \`.env\` file:

\`\`\`
SERVER_URL=http://localhost:4000
PAYER_SECRET_KEY=your_payer_keypair_base58
\`\`\`

## Standard Client (client.ts)

Simple payment flow:
1. Request endpoint → Get 402
2. Create payment transaction
3. Send payment → Get access

## Atomic Client (atomic-client.ts)

Interactive schema-driven flow:
1. Discover API schema from 402 response
2. Collect user inputs interactively
3. Request with params → Get final requirements
4. Create and send atomic transaction

### Interactive Features

- Automatic parameter discovery from \`outputSchema\`
- Type validation (string, number, boolean)
- Enum option validation
- Required field checking
- Optional field skipping (press Enter)
- User confirmation before payment

## License

MIT

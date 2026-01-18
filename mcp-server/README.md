# Solana Wallet MCP Server

A Model Context Protocol (MCP) server for managing Solana wallets locally with Claude clients.

## Features

- **Wallet Management**: Create, import (private key/mnemonic), export, list, and delete wallets
- **Encrypted Storage**: AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Balance Queries**: Get SOL and USDC balances for any address
- **Transaction Intent Checking**: Security validation before signing
  - Validates callback instructions don't contain user's wallet
  - Enforces compute unit limits (max 1,000,000)
  - Human-readable transaction summaries
- **Transaction Signing**: Sign transactions with intent verification
- **Transfers**: Send SOL and USDC with automatic ATA creation

## Installation

```bash
npm install
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "solana-wallet": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

### Wallet Management
- `wallet_create` - Create a new wallet
- `wallet_import_private_key` - Import from base58 private key
- `wallet_import_mnemonic` - Import from BIP39 mnemonic
- `wallet_export` - Export wallet private key (requires confirmation)
- `wallet_list` - List all wallets
- `wallet_set_active` - Set active wallet and unlock
- `wallet_lock` - Lock all wallets
- `wallet_delete` - Delete a wallet

### Balance Queries
- `balance_get_sol` - Get SOL balance
- `balance_get_usdc` - Get USDC balance
- `balance_get_all` - Get all token balances

### Transactions
- `transaction_analyze` - Analyze transaction safety
- `transaction_sign` - Sign a transaction
- `transaction_send` - Send signed transaction
- `transfer_sol` - Send SOL
- `transfer_usdc` - Send USDC

## Security

- Private keys are encrypted at rest using AES-256-GCM
- Passwords are never stored; keys derived using PBKDF2
- Transaction intent checking prevents malicious operations
- Compute unit limits protect against gas drain attacks
- Wallet files are stored with 0600 permissions

## Networks

Supports both Mainnet and Devnet (default: Devnet for safety).

## Storage Location

Wallet data is stored at: `~/.solana-mcp-wallet/wallets.json`

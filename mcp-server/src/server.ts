import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  walletCreateSchema, walletCreate,
  walletImportPrivateKeySchema, walletImportPrivateKey,
  walletImportMnemonicSchema, walletImportMnemonic,
  walletExportSchema, walletExport,
  walletListSchema, walletList,
  walletSetActiveSchema, walletSetActive,
  walletLockSchema, walletLock,
  walletDeleteSchema, walletDelete
} from './tools/wallet-tools.js'
import {
  balanceGetSolSchema, balanceGetSol,
  balanceGetUsdcSchema, balanceGetUsdc,
  balanceGetAllSchema, balanceGetAll
} from './tools/balance-tools.js'
import {
  transactionAnalyzeSchema, transactionAnalyze,
  transactionSignSchema, transactionSign,
  transactionSendSchema, transactionSend,
  transferSolSchema, transferSolTool,
  transferUsdcSchema, transferUsdcTool
} from './tools/transaction-tools.js'
import { walletManager } from './wallet/index.js'

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'solana-wallet',
    version: '1.0.0'
  })

  // Wallet Management Tools
  server.tool(
    'wallet_create',
    'Create a new Solana wallet with encrypted storage',
    walletCreateSchema.shape,
    async (params) => {
      const result = await walletCreate(walletCreateSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_import_private_key',
    'Import an existing wallet using a base58 encoded private key',
    walletImportPrivateKeySchema.shape,
    async (params) => {
      const result = await walletImportPrivateKey(walletImportPrivateKeySchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_import_mnemonic',
    'Import a wallet using a BIP39 mnemonic phrase',
    walletImportMnemonicSchema.shape,
    async (params) => {
      const result = await walletImportMnemonic(walletImportMnemonicSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_export',
    'Export a wallet private key. SECURITY: Only use in secure contexts.',
    walletExportSchema.shape,
    async (params) => {
      const result = await walletExport(walletExportSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_list',
    'List all managed wallets',
    walletListSchema.shape,
    async (params) => {
      const result = await walletList(walletListSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_set_active',
    'Set the active wallet for signing transactions',
    walletSetActiveSchema.shape,
    async (params) => {
      const result = await walletSetActive(walletSetActiveSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_lock',
    'Lock all wallets, removing decrypted keys from memory',
    walletLockSchema.shape,
    async (params) => {
      const result = await walletLock(walletLockSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'wallet_delete',
    'Delete a wallet from storage',
    walletDeleteSchema.shape,
    async (params) => {
      const result = await walletDelete(walletDeleteSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  // Balance Query Tools
  server.tool(
    'balance_get_sol',
    'Get SOL balance for an address',
    balanceGetSolSchema.shape,
    async (params) => {
      const result = await balanceGetSol(balanceGetSolSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'balance_get_usdc',
    'Get USDC balance for an address',
    balanceGetUsdcSchema.shape,
    async (params) => {
      const result = await balanceGetUsdc(balanceGetUsdcSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'balance_get_all',
    'Get all token balances for an address',
    balanceGetAllSchema.shape,
    async (params) => {
      const result = await balanceGetAll(balanceGetAllSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  // Transaction Tools
  server.tool(
    'transaction_analyze',
    'Analyze a transaction for safety before signing. Shows human-readable summary.',
    transactionAnalyzeSchema.shape,
    async (params) => {
      const result = await transactionAnalyze(transactionAnalyzeSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'transaction_sign',
    'Sign a transaction after intent verification. Requires active unlocked wallet.',
    transactionSignSchema.shape,
    async (params) => {
      const result = await transactionSign(transactionSignSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'transaction_send',
    'Send a signed transaction to the network',
    transactionSendSchema.shape,
    async (params) => {
      const result = await transactionSend(transactionSendSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'transfer_sol',
    'Send SOL to an address. Creates, signs, and sends transaction.',
    transferSolSchema.shape,
    async (params) => {
      const result = await transferSolTool(transferSolSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'transfer_usdc',
    'Send USDC to an address. Creates ATA if needed.',
    transferUsdcSchema.shape,
    async (params) => {
      const result = await transferUsdcTool(transferUsdcSchema.parse(params))
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  // Resources
  server.resource(
    'wallet://active',
    'Current active wallet information',
    async () => {
      const wallet = await walletManager.getActiveWallet()
      if (!wallet) {
        return {
          contents: [{
            uri: 'wallet://active',
            mimeType: 'application/json',
            text: JSON.stringify({ active: false, message: 'No active wallet' })
          }]
        }
      }

      return {
        contents: [{
          uri: 'wallet://active',
          mimeType: 'application/json',
          text: JSON.stringify({
            active: true,
            id: wallet.id,
            name: wallet.name,
            publicKey: wallet.publicKey,
            isUnlocked: walletManager.isWalletUnlocked(wallet.id)
          })
        }]
      }
    }
  )

  server.resource(
    'wallet://list',
    'List of all managed wallets',
    async () => {
      const wallets = await walletManager.listWallets()
      return {
        contents: [{
          uri: 'wallet://list',
          mimeType: 'application/json',
          text: JSON.stringify({
            wallets: wallets.map(w => ({
              id: w.id,
              name: w.name,
              publicKey: w.publicKey,
              isActive: w.isActive,
              isUnlocked: walletManager.isWalletUnlocked(w.id)
            })),
            count: wallets.length
          })
        }]
      }
    }
  )

  return server
}

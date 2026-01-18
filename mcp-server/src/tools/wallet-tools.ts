import { z } from 'zod'
import { walletManager } from '../wallet/index.js'

export const walletCreateSchema = z.object({
  name: z.string().min(1).describe('A friendly name for the wallet'),
  password: z.string().min(8).describe('Password for encrypting the wallet (min 8 characters)')
})

export async function walletCreate(params: z.infer<typeof walletCreateSchema>) {
  const wallet = await walletManager.createWallet(params.name, params.password)
  return {
    walletId: wallet.id,
    publicKey: wallet.publicKey,
    name: wallet.name,
    message: `Wallet "${wallet.name}" created successfully. Public key: ${wallet.publicKey}`
  }
}

export const walletImportPrivateKeySchema = z.object({
  privateKey: z.string().describe('Base58 encoded private key'),
  name: z.string().min(1).describe('A friendly name for the wallet'),
  password: z.string().min(8).describe('Password for encrypting the wallet')
})

export async function walletImportPrivateKey(params: z.infer<typeof walletImportPrivateKeySchema>) {
  const wallet = await walletManager.importFromPrivateKey(params.privateKey, params.name, params.password)
  return {
    walletId: wallet.id,
    publicKey: wallet.publicKey,
    name: wallet.name,
    message: `Wallet "${wallet.name}" imported successfully. Public key: ${wallet.publicKey}`
  }
}

export const walletImportMnemonicSchema = z.object({
  mnemonic: z.string().describe('12 or 24 word mnemonic phrase'),
  name: z.string().min(1).describe('A friendly name for the wallet'),
  password: z.string().min(8).describe('Password for encrypting the wallet')
})

export async function walletImportMnemonic(params: z.infer<typeof walletImportMnemonicSchema>) {
  const wallet = await walletManager.importFromMnemonic(params.mnemonic, params.name, params.password)
  return {
    walletId: wallet.id,
    publicKey: wallet.publicKey,
    name: wallet.name,
    message: `Wallet "${wallet.name}" imported from mnemonic. Public key: ${wallet.publicKey}`
  }
}

export const walletExportSchema = z.object({
  walletId: z.string().describe('ID of the wallet to export'),
  password: z.string().describe('Wallet password for decryption'),
  confirmExport: z.literal(true).describe('Must be true to confirm export')
})

export async function walletExport(params: z.infer<typeof walletExportSchema>) {
  const result = await walletManager.exportWallet(params.walletId, params.password)
  return {
    privateKey: result.privateKey,
    warning: 'SECURITY WARNING: Keep this private key secure. Anyone with this key can access your funds. Never share it.'
  }
}

export const walletListSchema = z.object({})

export async function walletList(_params: z.infer<typeof walletListSchema>) {
  const wallets = await walletManager.listWallets()
  return {
    wallets: wallets.map(w => ({
      id: w.id,
      name: w.name,
      publicKey: w.publicKey,
      isActive: w.isActive,
      isUnlocked: walletManager.isWalletUnlocked(w.id)
    })),
    count: wallets.length
  }
}

export const walletSetActiveSchema = z.object({
  walletId: z.string().describe('ID of the wallet to make active'),
  password: z.string().describe('Wallet password to unlock')
})

export async function walletSetActive(params: z.infer<typeof walletSetActiveSchema>) {
  const wallet = await walletManager.setActiveWallet(params.walletId, params.password)
  return {
    success: true,
    activeWallet: {
      id: wallet.id,
      name: wallet.name,
      publicKey: wallet.publicKey
    },
    message: `Wallet "${wallet.name}" is now active and unlocked.`
  }
}

export const walletLockSchema = z.object({})

export async function walletLock(_params: z.infer<typeof walletLockSchema>) {
  await walletManager.lockAllWallets()
  return {
    success: true,
    message: 'All wallets have been locked. You will need to provide passwords to use them again.'
  }
}

export const walletDeleteSchema = z.object({
  walletId: z.string().describe('ID of the wallet to delete'),
  confirmDelete: z.literal(true).describe('Must be true to confirm deletion')
})

export async function walletDelete(params: z.infer<typeof walletDeleteSchema>) {
  await walletManager.deleteWallet(params.walletId)
  return {
    success: true,
    message: 'Wallet deleted successfully.'
  }
}

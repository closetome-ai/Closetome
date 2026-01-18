import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { randomUUID } from 'crypto'
import { WalletStorage } from './storage.js'
import { encrypt, decrypt } from './crypto.js'
import type { ManagedWallet, EncryptedWalletData } from './types.js'

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'"

export class WalletManager {
  private storage: WalletStorage
  private unlockedKeypairs: Map<string, Keypair> = new Map()

  constructor() {
    this.storage = new WalletStorage()
  }

  async createWallet(name: string, password: string): Promise<ManagedWallet> {
    const keypair = Keypair.generate()
    return this.saveKeypair(keypair, name, password)
  }

  async importFromPrivateKey(privateKey: string, name: string, password: string): Promise<ManagedWallet> {
    let keypair: Keypair
    try {
      const secretKey = bs58.decode(privateKey)
      keypair = Keypair.fromSecretKey(secretKey)
    } catch (error) {
      throw new Error('Invalid private key format. Expected base58 encoded secret key.')
    }

    return this.saveKeypair(keypair, name, password)
  }

  async importFromMnemonic(mnemonic: string, name: string, password: string): Promise<ManagedWallet> {
    const trimmedMnemonic = mnemonic.trim().toLowerCase()

    if (!bip39.validateMnemonic(trimmedMnemonic)) {
      throw new Error('Invalid mnemonic phrase')
    }

    const seed = bip39.mnemonicToSeedSync(trimmedMnemonic)
    const derivedSeed = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex')).key
    const keypair = Keypair.fromSeed(derivedSeed)

    return this.saveKeypair(keypair, name, password)
  }

  private async saveKeypair(keypair: Keypair, name: string, password: string): Promise<ManagedWallet> {
    const id = randomUUID()
    const publicKey = keypair.publicKey.toBase58()
    const privateKeyBase58 = bs58.encode(keypair.secretKey)

    const encryptedData = encrypt(privateKeyBase58, password)

    const walletData: EncryptedWalletData = {
      id,
      name,
      publicKey,
      encryptedPrivateKey: encryptedData.encrypted,
      salt: encryptedData.salt,
      iv: encryptedData.iv,
      authTag: encryptedData.authTag,
      createdAt: new Date().toISOString()
    }

    await this.storage.addWallet(walletData)

    this.unlockedKeypairs.set(id, keypair)

    return {
      id,
      name,
      publicKey,
      createdAt: walletData.createdAt,
      isActive: true
    }
  }

  async exportWallet(walletId: string, password: string): Promise<{ privateKey: string }> {
    const wallet = await this.storage.getWallet(walletId)
    if (!wallet) {
      throw new Error(`Wallet with id ${walletId} not found`)
    }

    try {
      const privateKey = decrypt({
        encrypted: wallet.encryptedPrivateKey,
        salt: wallet.salt,
        iv: wallet.iv,
        authTag: wallet.authTag
      }, password)

      return { privateKey }
    } catch (error) {
      throw new Error('Invalid password')
    }
  }

  async listWallets(): Promise<ManagedWallet[]> {
    const wallets = await this.storage.getAllWallets()
    const activeId = await this.storage.getActiveWalletId()

    return wallets.map(w => ({
      id: w.id,
      name: w.name,
      publicKey: w.publicKey,
      createdAt: w.createdAt,
      isActive: w.id === activeId
    }))
  }

  async setActiveWallet(walletId: string, password: string): Promise<ManagedWallet> {
    const wallet = await this.storage.getWallet(walletId)
    if (!wallet) {
      throw new Error(`Wallet with id ${walletId} not found`)
    }

    await this.unlockWallet(walletId, password)
    await this.storage.setActiveWallet(walletId)

    return {
      id: wallet.id,
      name: wallet.name,
      publicKey: wallet.publicKey,
      createdAt: wallet.createdAt,
      isActive: true
    }
  }

  async unlockWallet(walletId: string, password: string): Promise<void> {
    if (this.unlockedKeypairs.has(walletId)) {
      return
    }

    const wallet = await this.storage.getWallet(walletId)
    if (!wallet) {
      throw new Error(`Wallet with id ${walletId} not found`)
    }

    try {
      const privateKey = decrypt({
        encrypted: wallet.encryptedPrivateKey,
        salt: wallet.salt,
        iv: wallet.iv,
        authTag: wallet.authTag
      }, password)

      const secretKey = bs58.decode(privateKey)
      const keypair = Keypair.fromSecretKey(secretKey)
      this.unlockedKeypairs.set(walletId, keypair)
    } catch (error) {
      throw new Error('Invalid password')
    }
  }

  async lockAllWallets(): Promise<void> {
    this.unlockedKeypairs.clear()
  }

  async deleteWallet(walletId: string): Promise<void> {
    this.unlockedKeypairs.delete(walletId)
    await this.storage.deleteWallet(walletId)
  }

  async getActiveKeypair(): Promise<Keypair | null> {
    const activeId = await this.storage.getActiveWalletId()
    if (!activeId) {
      return null
    }

    const keypair = this.unlockedKeypairs.get(activeId)
    if (!keypair) {
      return null
    }

    return keypair
  }

  async getActiveWallet(): Promise<ManagedWallet | null> {
    const activeId = await this.storage.getActiveWalletId()
    if (!activeId) {
      return null
    }

    const wallet = await this.storage.getWallet(activeId)
    if (!wallet) {
      return null
    }

    return {
      id: wallet.id,
      name: wallet.name,
      publicKey: wallet.publicKey,
      createdAt: wallet.createdAt,
      isActive: true
    }
  }

  isWalletUnlocked(walletId: string): boolean {
    return this.unlockedKeypairs.has(walletId)
  }
}

export const walletManager = new WalletManager()

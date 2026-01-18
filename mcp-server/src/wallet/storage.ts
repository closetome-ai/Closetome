import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { config } from '../config.js'
import type { EncryptedWalletData, WalletStorageData } from './types.js'

const STORAGE_VERSION = 1
const WALLETS_FILE = 'wallets.json'

export class WalletStorage {
  private storagePath: string
  private walletsFile: string

  constructor() {
    this.storagePath = config.storagePath
    this.walletsFile = join(this.storagePath, WALLETS_FILE)
  }

  private ensureStorageDir(): void {
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true, mode: 0o700 })
    }
  }

  private getEmptyStorage(): WalletStorageData {
    return {
      version: STORAGE_VERSION,
      wallets: [],
      activeWalletId: null
    }
  }

  async load(): Promise<WalletStorageData> {
    this.ensureStorageDir()

    if (!existsSync(this.walletsFile)) {
      return this.getEmptyStorage()
    }

    try {
      const data = readFileSync(this.walletsFile, 'utf8')
      const parsed = JSON.parse(data) as WalletStorageData

      if (parsed.version !== STORAGE_VERSION) {
        console.warn(`Storage version mismatch: ${parsed.version} !== ${STORAGE_VERSION}`)
      }

      return parsed
    } catch (error) {
      console.error('Failed to load wallet storage:', error)
      return this.getEmptyStorage()
    }
  }

  async save(data: WalletStorageData): Promise<void> {
    this.ensureStorageDir()

    const content = JSON.stringify(data, null, 2)
    writeFileSync(this.walletsFile, content, { encoding: 'utf8', mode: 0o600 })
  }

  async addWallet(wallet: EncryptedWalletData): Promise<void> {
    const data = await this.load()

    const existing = data.wallets.find(w => w.id === wallet.id)
    if (existing) {
      throw new Error(`Wallet with id ${wallet.id} already exists`)
    }

    data.wallets.push(wallet)

    if (data.wallets.length === 1) {
      data.activeWalletId = wallet.id
    }

    await this.save(data)
  }

  async getWallet(walletId: string): Promise<EncryptedWalletData | null> {
    const data = await this.load()
    return data.wallets.find(w => w.id === walletId) || null
  }

  async getAllWallets(): Promise<EncryptedWalletData[]> {
    const data = await this.load()
    return data.wallets
  }

  async deleteWallet(walletId: string): Promise<void> {
    const data = await this.load()
    const index = data.wallets.findIndex(w => w.id === walletId)

    if (index === -1) {
      throw new Error(`Wallet with id ${walletId} not found`)
    }

    data.wallets.splice(index, 1)

    if (data.activeWalletId === walletId) {
      data.activeWalletId = data.wallets.length > 0 ? data.wallets[0].id : null
    }

    await this.save(data)
  }

  async setActiveWallet(walletId: string): Promise<void> {
    const data = await this.load()
    const wallet = data.wallets.find(w => w.id === walletId)

    if (!wallet) {
      throw new Error(`Wallet with id ${walletId} not found`)
    }

    data.activeWalletId = walletId
    await this.save(data)
  }

  async getActiveWalletId(): Promise<string | null> {
    const data = await this.load()
    return data.activeWalletId
  }
}

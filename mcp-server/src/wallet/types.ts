export interface ManagedWallet {
  id: string
  name: string
  publicKey: string
  createdAt: string
  isActive: boolean
}

export interface EncryptedWalletData {
  id: string
  name: string
  publicKey: string
  encryptedPrivateKey: string
  salt: string
  iv: string
  authTag: string
  createdAt: string
}

export interface WalletStorageData {
  version: number
  wallets: EncryptedWalletData[]
  activeWalletId: string | null
}

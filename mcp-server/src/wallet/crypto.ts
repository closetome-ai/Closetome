import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const SALT_LENGTH = 32
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

export interface EncryptedData {
  encrypted: string
  salt: string
  iv: string
  authTag: string
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

export function encrypt(data: string, password: string): EncryptedData {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  }
}

export function decrypt(encryptedData: EncryptedData, password: string): string {
  const salt = Buffer.from(encryptedData.salt, 'hex')
  const iv = Buffer.from(encryptedData.iv, 'hex')
  const authTag = Buffer.from(encryptedData.authTag, 'hex')
  const key = deriveKey(password, salt)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

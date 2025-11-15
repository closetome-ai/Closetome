// Network types
export type Network = 'solana' | 'solana-devnet' | 'base' | 'base-sepolia'
export type Scheme = 'exact'
export type X402Version = 1

// Validation regexes
export const EvmAddressRegex = /^0x[a-fA-F0-9]{40}$/
export const EvmSignatureRegex = /^0x[a-fA-F0-9]{130}$/
export const SvmAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export const Base64EncodedRegex = /^[A-Za-z0-9+/]+=*$/
export const HexEncoded64ByteRegex = /^0x[a-fA-F0-9]{128}$/

// EVM Payment Types
export interface ExactEvmPayloadAuthorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}

export interface ExactEvmPayload {
  signature: string
  authorization: ExactEvmPayloadAuthorization
}

// Solana (SVM) Payment Types
export interface ExactSvmPayload {
  transaction: string // Base64 encoded transaction
}

// EVM Atomic Payment Types (EIP-3009)
export interface EVMPayAuth {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  v: number
  r: string
  s: string
}

export interface EVMAtomicPaymentPayload {
  userPay: EVMPayAuth
  feePay: EVMPayAuth
  target: string      // Callback contract address
  callback: string    // Encoded callback data
  proxyContract: string
  network: string
}

// Combined Payment Payload type
export type PaymentPayload = ExactEvmPayload | ExactSvmPayload | EVMAtomicPaymentPayload

// Helper type guards
export function isEvmPayload(payload: PaymentPayload): payload is ExactEvmPayload {
  return 'signature' in payload && 'authorization' in payload
}

export function isSvmPayload(payload: PaymentPayload): payload is ExactSvmPayload {
  return 'transaction' in payload
}

export function isEVMAtomicPayload(payload: PaymentPayload): payload is EVMAtomicPaymentPayload {
  return 'userPay' in payload && 'feePay' in payload && 'proxyContract' in payload
}

// API Types
export interface SupportedPaymentKind {
  x402Version: X402Version
  scheme: Scheme
  network: Network
  extra?: {
    feePayer?: string
    computeUnitPrice?: number
    computeUnitLimit?: number
    maxComputeUnitLimitAtomic?: number // Maximum compute unit limit for atomic transactions to prevent malicious servers from burning user's gas
    [key: string]: any
  }
}

export interface SupportedPaymentKindsResponse {
  kinds?: SupportedPaymentKind[]
}

// Serialized instruction format for cross-language compatibility
export interface SerializedInstruction {
  programId: string // Base58 encoded public key
  keys: Array<{
    pubkey: string // Base58 encoded public key
    isSigner: boolean
    isWritable: boolean
  }>
  data: string // Base64 encoded instruction data
}

// Payment Requirements
export interface PaymentRequirements {
  x402Version?: X402Version
  scheme: Scheme
  network: Network
  maxAmountRequired: string
  resource: string
  description?: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: {
    feePayer?: string
    computeUnitPrice?: number
    computeUnitLimit?: number
    maxComputeUnitLimitAtomic?: number // Maximum compute unit limit for atomic transactions
    callbackInstructions?: SerializedInstruction[]
    [key: string]: any
  }
}

// Verify endpoint types
export interface VerifyRequest {
  x402Version: X402Version
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
}

export interface VerifyResponse {
  isValid: boolean
  error?: string
}

// Atomic Verify endpoint types
export interface AtomicVerifyRequest {
  x402Version: X402Version
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
  serverAccount: string // Not used in current implementation but kept for compatibility
}

export interface AtomicVerifyResponse {
  isValid: boolean
  error?: string
}

// Settle endpoint types
export interface SettleRequest {
  x402Version: X402Version
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
}

export interface SettleResponse {
  success: boolean
  transactionHash?: string
  error?: string
}

// Atomic Settle endpoint types
export interface AtomicSettleRequest {
  x402Version: X402Version
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
  serverAccount: string // Not used in current implementation but kept for compatibility
}

export interface AtomicSettleResponse {
  success: boolean
  transactionHash?: string
  error?: string
}

// Supported networks configuration
export type SupportedNetwork = 'solana' | 'solana-devnet' | 'base' | 'base-sepolia'

export const SUPPORTED_NETWORKS: Record<SupportedNetwork, SupportedPaymentKind> = {
  'solana-devnet': {
    x402Version: 1,
    scheme: 'exact',
    network: 'solana-devnet',
  },
  'solana': {
    x402Version: 1,
    scheme: 'exact',
    network: 'solana',
  },
  'base-sepolia': {
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
  },
  'base': {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
  },
}

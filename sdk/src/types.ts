// X402 SDK Types

export type Network = 'solana' | 'solana-devnet' | 'base' | 'base-sepolia'
export type Scheme = 'exact'
export type X402Version = 1

export interface PaymentRequirements {
  scheme: Scheme
  network: Network
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: {
    feePayer?: string
    [key: string]: any
  }
}

export interface X402Response {
  x402Version: X402Version
  error?: string
  accepts?: PaymentRequirements[]
  payer?: string
}

export interface VerifyRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
}

export interface VerifyResponse {
  isValid: boolean
  error?: string
}

export interface SettleRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
}

export interface SettleResponse {
  success: boolean
  transactionHash?: string
  error?: string
}

// Atomic operation types - combines settlement with callback execution
export interface AtomicSettleRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
  callback: CallbackTransaction
}

export interface CallbackTransaction {
  // For EVM: encoded transaction data
  // For Solana: array of instructions
  type: 'evm' | 'solana'
  data: any // This will be more specifically typed once facilitator defines the format
}

export interface AtomicSettleResponse {
  success: boolean
  settlementTxHash?: string
  callbackTxHash?: string
  error?: string
}

// Route configuration for different paths
export interface RouteConfig {
  path: string | RegExp
  paymentRequirements: Partial<PaymentRequirements>
  autoSettle?: boolean
  atomicSettle?: boolean // Use atomic settlement with callback
  onPaymentVerified?: (payment: any, req: any) => Promise<void>
  onPaymentSettled?: (payment: any, txHash: string, req: any) => Promise<void>
  // For atomic operations: generate callback transaction/instructions
  onGenerateCallback?: (payment: any, req: any) => Promise<CallbackTransaction>
}

// Main SDK configuration
export interface X402Config {
  network: Network
  facilitatorUrl: string
  routes: RouteConfig[]
  defaultPayTo?: string // Optional default payTo address for all routes
  onPaymentFailed?: (error: Error, req: any) => Promise<void>
}

// Middleware creation options
export interface X402MiddlewareOptions {
  bypassOnError?: boolean // Continue if facilitator is unavailable
  customHeaders?: Record<string, string>
}
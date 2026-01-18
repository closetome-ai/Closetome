export interface SerializedInstruction {
  programId: string
  keys: Array<{
    pubkey: string
    isSigner: boolean
    isWritable: boolean
  }>
  data: string
}

export interface InstructionSummary {
  program: string
  type: string
  description: string
}

export interface TokenTransferInfo {
  from: string
  to: string
  amount: string
  mint?: string
}

export interface TransactionSummary {
  type: 'payment' | 'transfer' | 'atomic_payment' | 'unknown'
  computeUnits: number
  computeUnitPrice: number
  estimatedFee: string
  instructions: InstructionSummary[]
  tokenTransfers: TokenTransferInfo[]
}

export interface IntentCheckResult {
  safe: boolean
  warnings: string[]
  errors: string[]
  summary: TransactionSummary
}

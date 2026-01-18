import { VersionedTransaction } from '@solana/web3.js'
import { config } from '../config.js'
import { transactionParser } from './parser.js'
import { formatSol } from '../solana/constants.js'
import type { SerializedInstruction, IntentCheckResult, TransactionSummary, InstructionSummary, TokenTransferInfo } from './types.js'

export class IntentChecker {
  private maxComputeUnitLimit: number

  constructor() {
    this.maxComputeUnitLimit = config.maxComputeUnitLimitAtomic
  }

  /**
   * Validate callback instructions don't contain user's wallet
   * Port from SDK client.ts lines 304-319
   */
  validateCallbackInstructions(
    callbackInstructions: SerializedInstruction[],
    userWallet: string
  ): { valid: boolean; error?: string } {
    for (const instruction of callbackInstructions) {
      for (const key of instruction.keys) {
        if (key.pubkey === userWallet) {
          return {
            valid: false,
            error: `Security violation: Callback instruction contains user's wallet as an account. ` +
                   `This could allow the server to access your funds. Transaction rejected.`
          }
        }
      }
    }
    return { valid: true }
  }

  /**
   * Analyze a transaction for security and intent
   */
  async analyzeTransaction(
    transaction: VersionedTransaction,
    userWallet: string
  ): Promise<IntentCheckResult> {
    const warnings: string[] = []
    const errors: string[] = []

    const instructions = transactionParser.decompileTransaction(transaction)

    if (instructions.length === 0) {
      return {
        safe: false,
        warnings: [],
        errors: ['Failed to decompile transaction instructions'],
        summary: this.getEmptySummary()
      }
    }

    let computeUnits = 0
    let computeUnitPrice = 0
    let hasComputeLimit = false
    let hasComputePrice = false
    const instructionSummaries: InstructionSummary[] = []
    const tokenTransfers: TokenTransferInfo[] = []

    for (const ix of instructions) {
      const parsed = transactionParser.parseInstruction(ix)
      instructionSummaries.push(parsed)

      if (transactionParser.isSetComputeUnitLimit(ix)) {
        hasComputeLimit = true
        computeUnits = transactionParser.getComputeUnitLimit(ix)

        if (computeUnits > this.maxComputeUnitLimit) {
          errors.push(
            `Compute unit limit ${computeUnits.toLocaleString()} exceeds maximum allowed ` +
            `${this.maxComputeUnitLimit.toLocaleString()}. This could drain your SOL.`
          )
        }
      }

      if (transactionParser.isSetComputeUnitPrice(ix)) {
        hasComputePrice = true
        computeUnitPrice = transactionParser.getComputeUnitPrice(ix)
      }

      if (transactionParser.isTokenTransferInstruction(ix)) {
        const details = transactionParser.parseTokenTransferInstruction(ix)
        if (details) {
          tokenTransfers.push({
            from: details.source?.toBase58() || 'unknown',
            to: details.destination?.toBase58() || 'unknown',
            amount: details.amount.toString()
          })
        }
      }

      if (transactionParser.isSystemTransfer(ix)) {
        const details = transactionParser.parseSystemTransfer(ix)
        if (details) {
          tokenTransfers.push({
            from: details.from.toBase58(),
            to: details.to.toBase58(),
            amount: details.lamports.toString(),
            mint: 'SOL'
          })
        }
      }

      for (const key of ix.keys) {
        if (key.pubkey.toBase58() === userWallet && key.isSigner && key.isWritable) {
          if (!transactionParser.isTokenTransferInstruction(ix) &&
              !transactionParser.isSystemTransfer(ix) &&
              !transactionParser.isATACreationInstruction(ix)) {
            warnings.push(
              `Unknown instruction requires your wallet as a writable signer. ` +
              `Program: ${transactionParser.identifyProgram(ix.programId)}`
            )
          }
        }
      }
    }

    if (hasComputePrice && !hasComputeLimit) {
      warnings.push('Transaction has compute unit price but no limit set')
    }

    const estimatedFee = hasComputeLimit && hasComputePrice
      ? (computeUnits * computeUnitPrice) / 1_000_000
      : 0

    const transactionType = this.determineTransactionType(instructions)

    const summary: TransactionSummary = {
      type: transactionType,
      computeUnits,
      computeUnitPrice,
      estimatedFee: formatSol(Math.floor(estimatedFee * 1_000_000_000)),
      instructions: instructionSummaries,
      tokenTransfers
    }

    return {
      safe: errors.length === 0,
      warnings,
      errors,
      summary
    }
  }

  private determineTransactionType(instructions: ReturnType<typeof transactionParser.decompileTransaction>): TransactionSummary['type'] {
    let hasTransfer = false
    let hasATA = false
    let hasCallback = false

    for (const ix of instructions) {
      if (transactionParser.isTokenTransferInstruction(ix) || transactionParser.isSystemTransfer(ix)) {
        hasTransfer = true
      }
      if (transactionParser.isATACreationInstruction(ix)) {
        hasATA = true
      }
      if (!transactionParser.isComputeBudgetInstruction(ix) &&
          !transactionParser.isTokenTransferInstruction(ix) &&
          !transactionParser.isATACreationInstruction(ix) &&
          !transactionParser.isSystemTransfer(ix)) {
        hasCallback = true
      }
    }

    if (hasTransfer && hasCallback) {
      return 'atomic_payment'
    }
    if (hasTransfer) {
      return 'transfer'
    }
    return 'unknown'
  }

  private getEmptySummary(): TransactionSummary {
    return {
      type: 'unknown',
      computeUnits: 0,
      computeUnitPrice: 0,
      estimatedFee: '0',
      instructions: [],
      tokenTransfers: []
    }
  }

  /**
   * Generate human-readable summary for user confirmation
   */
  generateConfirmationPrompt(result: IntentCheckResult): string {
    const lines: string[] = []

    lines.push('=== Transaction Analysis ===')
    lines.push('')

    if (result.summary.tokenTransfers.length > 0) {
      lines.push('Transfers:')
      for (const transfer of result.summary.tokenTransfers) {
        const tokenType = transfer.mint === 'SOL' ? 'SOL' : 'tokens'
        lines.push(`  - ${transfer.amount} ${tokenType} to ${transfer.to.slice(0, 8)}...`)
      }
      lines.push('')
    }

    lines.push(`Estimated fee: ${result.summary.estimatedFee} SOL`)
    lines.push(`Compute units: ${result.summary.computeUnits.toLocaleString()}`)
    lines.push('')

    if (result.errors.length > 0) {
      lines.push('ERRORS:')
      for (const error of result.errors) {
        lines.push(`  ! ${error}`)
      }
      lines.push('')
    }

    if (result.warnings.length > 0) {
      lines.push('Warnings:')
      for (const warning of result.warnings) {
        lines.push(`  * ${warning}`)
      }
      lines.push('')
    }

    lines.push(`Safety: ${result.safe ? 'PASSED' : 'FAILED'}`)

    return lines.join('\n')
  }
}

export const intentChecker = new IntentChecker()

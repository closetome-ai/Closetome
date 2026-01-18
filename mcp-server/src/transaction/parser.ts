import {
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import { USDC_MINTS, formatUsdc, formatSol } from '../solana/constants.js'
import type { InstructionSummary, TokenTransferInfo } from './types.js'

const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111')

export class TransactionParser {
  isComputeBudgetInstruction(instruction: TransactionInstruction): boolean {
    return instruction.programId.equals(ComputeBudgetProgram.programId)
  }

  isSetComputeUnitLimit(instruction: TransactionInstruction): boolean {
    if (!this.isComputeBudgetInstruction(instruction)) return false
    return instruction.data.length >= 1 && instruction.data[0] === 2
  }

  isSetComputeUnitPrice(instruction: TransactionInstruction): boolean {
    if (!this.isComputeBudgetInstruction(instruction)) return false
    return instruction.data.length >= 1 && instruction.data[0] === 3
  }

  getComputeUnitLimit(instruction: TransactionInstruction): number {
    if (!this.isSetComputeUnitLimit(instruction)) return 0
    return instruction.data.readUInt32LE(1)
  }

  getComputeUnitPrice(instruction: TransactionInstruction): number {
    if (!this.isSetComputeUnitPrice(instruction)) return 0
    return instruction.data.readUInt32LE(1)
  }

  isATACreationInstruction(instruction: TransactionInstruction): boolean {
    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      return false
    }
    if (instruction.data.length === 0 ||
        (instruction.data.length === 1 && (instruction.data[0] === 0 || instruction.data[0] === 1))) {
      return true
    }
    return false
  }

  parseATACreationInstruction(instruction: TransactionInstruction): {
    payer: PublicKey
    ata: PublicKey
    owner: PublicKey
    mint: PublicKey
    isIdempotent: boolean
  } | null {
    if (!this.isATACreationInstruction(instruction)) return null
    if (instruction.keys.length < 6) return null

    const isIdempotent = instruction.data.length > 0 && instruction.data[0] === 1

    return {
      payer: instruction.keys[0].pubkey,
      ata: instruction.keys[1].pubkey,
      owner: instruction.keys[2].pubkey,
      mint: instruction.keys[3].pubkey,
      isIdempotent
    }
  }

  isTokenTransferInstruction(instruction: TransactionInstruction): boolean {
    if (!instruction.programId.equals(TOKEN_PROGRAM_ID)) {
      return false
    }
    if (instruction.data.length >= 1) {
      const discriminator = instruction.data[0]
      return discriminator === 3 || discriminator === 12
    }
    return false
  }

  parseTokenTransferInstruction(instruction: TransactionInstruction): {
    source: PublicKey | null
    destination: PublicKey | null
    amount: bigint
  } | null {
    if (!this.isTokenTransferInstruction(instruction)) return null

    const discriminator = instruction.data[0]

    if (discriminator === 3) {
      if (instruction.data.length < 9) return null
      const amount = instruction.data.readBigUInt64LE(1)
      if (instruction.keys.length < 3) return null
      return {
        source: instruction.keys[0]?.pubkey || null,
        destination: instruction.keys[1]?.pubkey || null,
        amount
      }
    } else if (discriminator === 12) {
      if (instruction.data.length < 10) return null
      const amount = instruction.data.readBigUInt64LE(1)
      if (instruction.keys.length < 4) return null
      return {
        source: instruction.keys[0]?.pubkey || null,
        destination: instruction.keys[2]?.pubkey || null,
        amount
      }
    }

    return null
  }

  isSystemTransfer(instruction: TransactionInstruction): boolean {
    if (!instruction.programId.equals(SYSTEM_PROGRAM_ID)) {
      return false
    }
    if (instruction.data.length >= 4) {
      const instructionType = instruction.data.readUInt32LE(0)
      return instructionType === 2
    }
    return false
  }

  parseSystemTransfer(instruction: TransactionInstruction): {
    from: PublicKey
    to: PublicKey
    lamports: bigint
  } | null {
    if (!this.isSystemTransfer(instruction)) return null
    if (instruction.keys.length < 2) return null
    if (instruction.data.length < 12) return null

    const lamports = instruction.data.readBigUInt64LE(4)
    return {
      from: instruction.keys[0].pubkey,
      to: instruction.keys[1].pubkey,
      lamports
    }
  }

  identifyProgram(programId: PublicKey): string {
    if (programId.equals(ComputeBudgetProgram.programId)) return 'Compute Budget'
    if (programId.equals(TOKEN_PROGRAM_ID)) return 'Token Program'
    if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return 'Associated Token Program'
    if (programId.equals(SYSTEM_PROGRAM_ID)) return 'System Program'
    return programId.toBase58().slice(0, 8) + '...'
  }

  parseInstruction(instruction: TransactionInstruction): InstructionSummary {
    const program = this.identifyProgram(instruction.programId)

    if (this.isSetComputeUnitPrice(instruction)) {
      const price = this.getComputeUnitPrice(instruction)
      return {
        program,
        type: 'SetComputeUnitPrice',
        description: `Set compute unit price: ${price} microLamports`
      }
    }

    if (this.isSetComputeUnitLimit(instruction)) {
      const limit = this.getComputeUnitLimit(instruction)
      return {
        program,
        type: 'SetComputeUnitLimit',
        description: `Set compute unit limit: ${limit.toLocaleString()} units`
      }
    }

    if (this.isATACreationInstruction(instruction)) {
      const details = this.parseATACreationInstruction(instruction)
      if (details) {
        return {
          program,
          type: 'CreateAssociatedTokenAccount',
          description: `Create ATA for ${details.owner.toBase58().slice(0, 8)}...`
        }
      }
    }

    if (this.isTokenTransferInstruction(instruction)) {
      const details = this.parseTokenTransferInstruction(instruction)
      if (details) {
        return {
          program,
          type: 'TokenTransfer',
          description: `Transfer ${formatUsdc(details.amount)} tokens to ${details.destination?.toBase58().slice(0, 8)}...`
        }
      }
    }

    if (this.isSystemTransfer(instruction)) {
      const details = this.parseSystemTransfer(instruction)
      if (details) {
        return {
          program,
          type: 'SystemTransfer',
          description: `Transfer ${formatSol(details.lamports)} SOL to ${details.to.toBase58().slice(0, 8)}...`
        }
      }
    }

    return {
      program,
      type: 'Unknown',
      description: `Unknown instruction (${instruction.data.length} bytes)`
    }
  }

  decompileTransaction(transaction: VersionedTransaction): TransactionInstruction[] {
    try {
      const messageV0 = TransactionMessage.decompile(transaction.message)
      return messageV0.instructions
    } catch (error) {
      console.error('Failed to decompile transaction:', error)
      return []
    }
  }

  generateSummary(transaction: VersionedTransaction): string {
    const instructions = this.decompileTransaction(transaction)
    if (instructions.length === 0) {
      return 'Failed to parse transaction'
    }

    const lines: string[] = ['Transaction Summary:']
    let computeUnits = 0
    let computePrice = 0
    const transfers: string[] = []

    for (const ix of instructions) {
      const parsed = this.parseInstruction(ix)

      if (this.isSetComputeUnitLimit(ix)) {
        computeUnits = this.getComputeUnitLimit(ix)
      }
      if (this.isSetComputeUnitPrice(ix)) {
        computePrice = this.getComputeUnitPrice(ix)
      }

      lines.push(`  - ${parsed.description}`)

      if (this.isTokenTransferInstruction(ix)) {
        const details = this.parseTokenTransferInstruction(ix)
        if (details) {
          transfers.push(`${formatUsdc(details.amount)} tokens`)
        }
      }
      if (this.isSystemTransfer(ix)) {
        const details = this.parseSystemTransfer(ix)
        if (details) {
          transfers.push(`${formatSol(details.lamports)} SOL`)
        }
      }
    }

    const estimatedFee = (computeUnits * computePrice) / 1_000_000
    lines.push(`  Estimated priority fee: ~${estimatedFee.toFixed(6)} SOL`)

    return lines.join('\n')
  }
}

export const transactionParser = new TransactionParser()

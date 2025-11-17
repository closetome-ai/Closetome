import { TransactionInstruction, PublicKey } from '@solana/web3.js'
import { SerializedInstruction } from './types'

/**
 * Serialize a Solana TransactionInstruction to a format that can be JSON stringified
 */
export function serializeInstruction(instruction: TransactionInstruction): SerializedInstruction {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map(key => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable
    })),
    data: instruction.data.toString('base64')
  }
}

/**
 * Deserialize a SerializedInstruction back to TransactionInstruction
 */
export function deserializeInstruction(serialized: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(serialized.programId),
    keys: serialized.keys.map(key => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable
    })),
    data: Buffer.from(serialized.data, 'base64')
  })
}

/**
 * Serialize an array of TransactionInstructions
 */
export function serializeInstructions(instructions: TransactionInstruction[]): SerializedInstruction[] {
  return instructions.map(serializeInstruction)
}

/**
 * Deserialize an array of SerializedInstructions
 */
export function deserializeInstructions(serialized: SerializedInstruction[]): TransactionInstruction[] {
  return serialized.map(deserializeInstruction)
}

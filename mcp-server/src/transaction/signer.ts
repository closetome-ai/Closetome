import { Keypair, VersionedTransaction } from '@solana/web3.js'
import { intentChecker } from './intent-checker.js'
import { config } from '../config.js'

export interface SignResult {
  signedTransaction: string
  signature: string
  intentCheckPassed: boolean
}

export async function signTransaction(
  transaction: VersionedTransaction,
  keypair: Keypair,
  skipIntentCheck: boolean = false
): Promise<SignResult> {
  const userWallet = keypair.publicKey.toBase58()

  if (!skipIntentCheck && config.requireIntentCheckForSigning) {
    const intentResult = await intentChecker.analyzeTransaction(transaction, userWallet)

    if (!intentResult.safe) {
      throw new Error(
        `Transaction failed safety check:\n${intentResult.errors.join('\n')}`
      )
    }

    if (intentResult.warnings.length > 0) {
      console.warn('Transaction warnings:', intentResult.warnings)
    }
  }

  transaction.sign([keypair])

  const serialized = Buffer.from(transaction.serialize()).toString('base64')

  const signature = Buffer.from(transaction.signatures[0]).toString('base64')

  return {
    signedTransaction: serialized,
    signature,
    intentCheckPassed: true
  }
}

import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError
} from '@solana/spl-token'
import { getConnection } from './connection.js'
import { USDC_MINTS, parseSol, parseUsdc } from './constants.js'
import type { Network } from '../config.js'

export interface TransferResult {
  signature: string
  from: string
  to: string
  amount: string
  explorerUrl: string
}

function getExplorerUrl(signature: string, network: Network): string {
  const cluster = network === 'mainnet' ? '' : `?cluster=${network}`
  return `https://explorer.solana.com/tx/${signature}${cluster}`
}

export async function transferSol(
  fromKeypair: Keypair,
  toAddress: string,
  amount: string,
  network: Network
): Promise<TransferResult> {
  const connection = getConnection(network)
  const toPubkey = new PublicKey(toAddress)
  const lamports = parseSol(amount)

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey,
      lamports
    })
  )

  const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair])

  return {
    signature,
    from: fromKeypair.publicKey.toBase58(),
    to: toAddress,
    amount,
    explorerUrl: getExplorerUrl(signature, network)
  }
}

export async function transferUsdc(
  fromKeypair: Keypair,
  toAddress: string,
  amount: string,
  network: Network
): Promise<TransferResult & { createdATA: boolean }> {
  const connection = getConnection(network)
  const toPubkey = new PublicKey(toAddress)
  const usdcMint = USDC_MINTS[network]
  const rawAmount = parseUsdc(amount)

  const fromATA = await getAssociatedTokenAddress(usdcMint, fromKeypair.publicKey)
  const toATA = await getAssociatedTokenAddress(usdcMint, toPubkey)

  const transaction = new Transaction()
  let createdATA = false

  try {
    await getAccount(connection, toATA)
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          fromKeypair.publicKey,
          toATA,
          toPubkey,
          usdcMint
        )
      )
      createdATA = true
    } else {
      throw error
    }
  }

  transaction.add(
    createTransferInstruction(
      fromATA,
      toATA,
      fromKeypair.publicKey,
      rawAmount
    )
  )

  const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair])

  return {
    signature,
    from: fromKeypair.publicKey.toBase58(),
    to: toAddress,
    amount,
    createdATA,
    explorerUrl: getExplorerUrl(signature, network)
  }
}

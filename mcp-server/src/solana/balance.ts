import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from '@solana/spl-token'
import { getConnection } from './connection.js'
import { USDC_MINTS, formatSol, formatUsdc } from './constants.js'
import type { Network } from '../config.js'

export interface SolBalance {
  address: string
  balanceLamports: string
  balanceSol: string
  network: Network
}

export interface UsdcBalance {
  address: string
  balanceRaw: string
  balanceFormatted: string
  tokenAccount: string | null
  network: Network
}

export async function getSolBalance(address: string, network: Network): Promise<SolBalance> {
  const connection = getConnection(network)
  const publicKey = new PublicKey(address)
  const balance = await connection.getBalance(publicKey)

  return {
    address,
    balanceLamports: balance.toString(),
    balanceSol: formatSol(balance),
    network
  }
}

export async function getUsdcBalance(address: string, network: Network): Promise<UsdcBalance> {
  const connection = getConnection(network)
  const publicKey = new PublicKey(address)
  const usdcMint = USDC_MINTS[network]

  const tokenAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

  try {
    const account = await getAccount(connection, tokenAccount)
    return {
      address,
      balanceRaw: account.amount.toString(),
      balanceFormatted: formatUsdc(account.amount),
      tokenAccount: tokenAccount.toBase58(),
      network
    }
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return {
        address,
        balanceRaw: '0',
        balanceFormatted: '0.000000',
        tokenAccount: null,
        network
      }
    }
    throw error
  }
}

export interface TokenBalance {
  mint: string
  symbol?: string
  balance: string
  decimals: number
}

export interface AllBalances {
  address: string
  sol: {
    lamports: string
    formatted: string
  }
  tokens: TokenBalance[]
  network: Network
}

export async function getAllBalances(address: string, network: Network): Promise<AllBalances> {
  const connection = getConnection(network)
  const publicKey = new PublicKey(address)

  const solBalance = await connection.getBalance(publicKey)

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  })

  const tokens: TokenBalance[] = tokenAccounts.value.map(account => {
    const info = account.account.data.parsed.info
    const mint = info.mint as string
    const usdcMintMainnet = USDC_MINTS.mainnet.toBase58()
    const usdcMintDevnet = USDC_MINTS.devnet.toBase58()

    let symbol: string | undefined
    if (mint === usdcMintMainnet || mint === usdcMintDevnet) {
      symbol = 'USDC'
    }

    return {
      mint,
      symbol,
      balance: info.tokenAmount.uiAmountString || '0',
      decimals: info.tokenAmount.decimals as number
    }
  })

  return {
    address,
    sol: {
      lamports: solBalance.toString(),
      formatted: formatSol(solBalance)
    },
    tokens,
    network
  }
}

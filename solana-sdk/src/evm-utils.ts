import { ethers } from 'ethers'
import { PaymentRequirements, EVMNetwork, EVMPayAuth } from './types'

// USDC contract addresses for different EVM networks
const USDC_ADDRESSES: Record<EVMNetwork, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
}

// RPC URLs for different networks
const RPC_URLS: Record<EVMNetwork, string> = {
  'base': 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org'
}

// EIP-712 Domain names for USDC contracts on different networks
// Testnet USDC contracts often use "USDC" while mainnet uses "USD Coin"
const USDC_DOMAIN_NAMES: Record<EVMNetwork, string> = {
  'base': 'USD Coin',           // Mainnet official USDC
  'base-sepolia': 'USDC'        // Testnet USDC
}

// EIP-712 Domain versions for USDC contracts
const USDC_DOMAIN_VERSIONS: Record<EVMNetwork, string> = {
  'base': '2',
  'base-sepolia': '2'
}

// ERC20 Transfer ABI
const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

export interface EVMTransactionBuilder {
  /**
   * Create an EVM payment transaction (USDC transfer)
   */
  createPaymentTransaction(
    requirements: PaymentRequirements,
    privateKey: string
  ): Promise<string>

  /**
   * Get provider for a specific network
   */
  getProvider(network: EVMNetwork): ethers.JsonRpcProvider

  /**
   * Get wallet from private key
   */
  getWallet(privateKey: string, network: EVMNetwork): ethers.Wallet
}

export class EVMTransactionBuilderImpl implements EVMTransactionBuilder {
  private providers: Map<EVMNetwork, ethers.JsonRpcProvider> = new Map()

  getProvider(network: EVMNetwork): ethers.JsonRpcProvider {
    if (!this.providers.has(network)) {
      const rpcUrl = RPC_URLS[network]
      this.providers.set(network, new ethers.JsonRpcProvider(rpcUrl))
    }
    return this.providers.get(network)!
  }

  getWallet(privateKey: string, network: EVMNetwork): ethers.Wallet {
    // Remove 0x prefix if present
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
    const provider = this.getProvider(network)
    return new ethers.Wallet(cleanKey, provider)
  }

  async createPaymentTransaction(
    requirements: PaymentRequirements,
    privateKey: string
  ): Promise<string> {
    const network = requirements.network as EVMNetwork
    const wallet = this.getWallet(privateKey, network)

    // Get USDC contract address
    const usdcAddress = requirements.asset || USDC_ADDRESSES[network]
    if (!usdcAddress) {
      throw new Error(`USDC address not found for network ${network}`)
    }

    const amount = requirements.maxAmountRequired
    const recipient = requirements.payTo

    if (!recipient) {
      throw new Error('Missing payTo address in payment requirements')
    }

    // Generate EIP-3009 transferWithAuthorization signature
    // This is gasless - facilitator will execute the transfer
    const now = Math.floor(Date.now() / 1000)
    const validAfter = now - 60 // Valid from 1 minute ago to account for clock skew

    // Use maxTimeoutSeconds from requirements, with fallback to 1 hour
    const timeoutSeconds = requirements.maxTimeoutSeconds || 3600
    const validBefore = now + timeoutSeconds

    // Generate random nonce
    const nonce = ethers.hexlify(ethers.randomBytes(32))

    // Sign the authorization
    const payAuth = await this.signTransferAuthorization(
      wallet.address,  // from: user's address
      recipient,       // to: payment recipient
      amount,          // value: payment amount
      validAfter,
      validBefore,
      nonce,
      privateKey,
      network
    )

    // Return in the format facilitator expects: { signature, authorization }
    const payload = {
      signature: `0x${payAuth.r.slice(2)}${payAuth.s.slice(2)}${payAuth.v.toString(16).padStart(2, '0')}`,
      authorization: {
        from: payAuth.from,
        to: payAuth.to,
        value: payAuth.value,
        validAfter: payAuth.validAfter,
        validBefore: payAuth.validBefore,
        nonce: payAuth.nonce
      }
    }

    return JSON.stringify(payload)
  }

  /**
   * Sign EIP-3009 transferWithAuthorization
   * Generates signature for USDC transferWithAuthorization function
   */
  async signTransferAuthorization(
    from: string,
    to: string,
    value: string,
    validAfter: number,
    validBefore: number,
    nonce: string,
    privateKey: string,
    network: EVMNetwork
  ): Promise<EVMPayAuth> {
    const wallet = this.getWallet(privateKey, network)
    const usdcAddress = USDC_ADDRESSES[network]

    if (!usdcAddress) {
      throw new Error(`USDC address not found for network ${network}`)
    }

    // EIP-712 domain for USDC contract
    // Use network-specific domain name (testnets often use different names)
    const domain = {
      name: USDC_DOMAIN_NAMES[network],
      version: USDC_DOMAIN_VERSIONS[network],
      chainId: await this.getChainId(network),
      verifyingContract: usdcAddress
    }

    // EIP-712 types for transferWithAuthorization
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    }

    // Message to sign
    const message = {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce
    }

    // Sign the typed data
    const signature = await wallet.signTypedData(domain, types, message)
    const sig = ethers.Signature.from(signature)

    return {
      from,
      to,
      value,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      v: sig.v,
      r: sig.r,
      s: sig.s
    }
  }

  /**
   * Get chain ID for network
   */
  private async getChainId(network: EVMNetwork): Promise<number> {
    const chainIds: Record<EVMNetwork, number> = {
      'base': 8453,
      'base-sepolia': 84532
    }
    return chainIds[network]
  }

  /**
   * Generate random nonce for EIP-3009
   */
  generateNonce(): string {
    return ethers.hexlify(ethers.randomBytes(32))
  }
}

// Export singleton instance
export const evmTransactionBuilder = new EVMTransactionBuilderImpl()

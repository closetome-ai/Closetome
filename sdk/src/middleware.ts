import { Request, Response, NextFunction, RequestHandler } from 'express'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { ethers } from 'ethers'
import {
  X402Config,
  X402MiddlewareOptions,
  X402Response,
  PaymentRequirements,
  VerifyRequest,
  AtomicSettleRequest,
  X402Version,
  RouteConfig,
  RoutePaymentRequirements,
  WalletConfig,
  Network,
  getChainType,
  EVMNetwork,
  EVMPayAuth,
  EVMAtomicPaymentPayload
} from './types'
import { FacilitatorClient } from './facilitator-client'
import { EVMTransactionBuilderImpl } from './evm-utils'
import * as path from 'path'
import * as fs from 'fs'

// Load EVM proxy ABI
const evmProxyABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../public/evmProxy.json'), 'utf-8')
)

export class X402Middleware {
  private config: X402Config
  private facilitatorClient: FacilitatorClient
  private options: X402MiddlewareOptions
  private extraCache?: Record<string, any>
  private extraFetched: boolean = false

  // Wallet instances for signing atomic transactions
  private svmWallet?: Keypair // Solana Keypair
  private evmWallet?: ethers.Wallet // EVM Wallet
  private evmTxBuilder: EVMTransactionBuilderImpl

  constructor(config: X402Config, options: X402MiddlewareOptions = {}) {
    this.config = config
    this.options = {
      bypassOnError: options.bypassOnError ?? false,
      customHeaders: options.customHeaders || {}
    }

    // Initialize facilitator client
    this.facilitatorClient = new FacilitatorClient(config.facilitatorUrl)

    // Initialize EVM transaction builder
    this.evmTxBuilder = new EVMTransactionBuilderImpl()

    // Load server wallets if provided (for atomic transactions)
    if (config.serverWallet) {
      this.loadServerWallets(config.serverWallet)
    }
  }

  /**
   * Load server wallets from configuration
   */
  private loadServerWallets(walletConfig: WalletConfig): void {
    // Load SVM wallet (Solana)
    if (walletConfig.svm) {
      try {
        this.svmWallet = Keypair.fromSecretKey(bs58.decode(walletConfig.svm.keypair))
        console.log('[X402] Loaded SVM wallet:', this.svmWallet.publicKey.toBase58())
      } catch (error) {
        console.error('Failed to load SVM wallet:', error)
        throw new Error('Invalid SVM keypair for atomic transactions')
      }
    }

    // Load EVM wallet
    if (walletConfig.evm) {
      try {
        const privateKey = walletConfig.evm.privateKey.startsWith('0x')
          ? walletConfig.evm.privateKey.slice(2)
          : walletConfig.evm.privateKey
        this.evmWallet = new ethers.Wallet(privateKey)
        console.log('[X402] Loaded EVM wallet:', this.evmWallet.address)
      } catch (error) {
        console.error('Failed to load EVM wallet:', error)
        throw new Error('Invalid EVM private key for atomic transactions')
      }
    }
  }

  /**
   * Get the appropriate wallet for a given network
   */
  private getWalletForNetwork(network: Network): Keypair | ethers.Wallet | null {
    const chainType = getChainType(network)

    if (chainType === 'svm') {
      return this.svmWallet || null
    } else {
      return this.evmWallet || null
    }
  }

  /**
   * Read proxy contract configuration (feeReceiver and feeBps)
   */
  private async readProxyConfig(proxyContract: string, network: EVMNetwork): Promise<{
    feeReceiver: string
    feeBps: bigint
  }> {
    const provider = this.evmTxBuilder.getProvider(network)
    const proxy = new ethers.Contract(proxyContract, evmProxyABI, provider)

    const [feeReceiver, feeBps] = await Promise.all([
      proxy.feeReceiver(),
      proxy.feeBps()
    ])

    return { feeReceiver, feeBps }
  }

  /**
   * Generate feePay signature for EVM atomic payment
   * Server pays fee to facilitator based on userPay amount and proxy's feeBps
   */
  private async generateEVMFeePay(
    userPay: EVMPayAuth,
    proxyContract: string,
    network: EVMNetwork
  ): Promise<EVMPayAuth> {
    if (!this.evmWallet) {
      throw new Error('EVM wallet not configured for atomic transactions')
    }

    // Read proxy contract configuration
    const { feeReceiver, feeBps } = await this.readProxyConfig(proxyContract, network)

    // Calculate fee: floor(userPay.value * feeBps / 10000)
    const userValue = BigInt(userPay.value)
    const feeAmount = (userValue * feeBps) / BigInt(10000)

    // Server is the recipient of userPay
    const serverAddress = userPay.to

    // Generate nonce for feePay
    const nonce = this.evmTxBuilder.generateNonce()

    // Set validity window - start from 60 seconds ago to account for clock skew
    const now = Math.floor(Date.now() / 1000)
    const validAfter = now - 60 // Account for clock skew
    const validBefore = now + 300 // 5 minutes from now

    // Sign feePay authorization: server → feeReceiver
    const feePay = await this.evmTxBuilder.signTransferAuthorization(
      serverAddress,           // from: server
      feeReceiver,             // to: facilitator's feeReceiver
      feeAmount.toString(),    // value: calculated fee
      validAfter,
      validBefore,
      nonce,
      this.evmWallet.privateKey,
      network
    )

    return feePay
  }

  /**
   * Fetch extra fields from facilitator's supported endpoint
   */
  private async ensureExtraFields(): Promise<void> {
    // Only fetch once
    if (this.extraFetched) {
      return
    }

    this.extraFetched = true

    try {
      const supported = await this.facilitatorClient.getSupported()
      if (supported?.kinds) {
        const networkInfo = supported.kinds.find((k: any) => k.network === this.config.network)
        if (networkInfo?.extra) {
          this.extraCache = networkInfo.extra
        }
      }
    } catch (error) {
      console.error('Failed to fetch extra fields from facilitator:', error)
    }
  }

  /**
   * Create the Express middleware
   */
  middleware(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Find matching route config for this path
      const routeConfig = this.findRouteConfig(req.path)

      if (!routeConfig) {
        // No route configured for this path, continue
        return next()
      }

      // Check if payment header is present (X-Payment as per X402 spec)
      const paymentHeader = req.headers['x-payment']

      if (!paymentHeader) {
        // No payment provided, return 402 with route-specific requirements
        return await this.send402Response(res, routeConfig, undefined, req)
      }

      try {
        // Parse payment from header (base64 decode if needed)
        let paymentMessage: any
        if (typeof paymentHeader === 'string') {
          try {
            // Try to parse as base64 first
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8')
            paymentMessage = JSON.parse(decoded)
          } catch {
            // Fall back to direct JSON parse
            paymentMessage = JSON.parse(paymentHeader)
          }
        } else {
          paymentMessage = paymentHeader
        }

        // Extract payload from X402 payment message
        // X-Payment header format: { x402Version, scheme, network, payload }
        let payment = paymentMessage.payload || paymentMessage

        // Ensure extra fields are fetched before building requirements
        await this.ensureExtraFields()

        // Build payment requirements for this route
        const requirements = await this.buildPaymentRequirements(routeConfig, req)

        // Handle atomic transactions differently
        if (routeConfig.atomic) {
          // Determine which network to use (route-specific or global)
          const network = routeConfig.network || this.config.network
          const wallet = this.getWalletForNetwork(network)

          // Atomic transaction flow
          if (!wallet) {
            const chainType = getChainType(network)
            return await this.send402Response(
              res,
              routeConfig,
              `Server ${chainType.toUpperCase()} wallet not configured for atomic transactions on network ${network}`,
              req
            )
          }

          // Step 1: Verify atomic payment with facilitator
          const chainType = getChainType(network)
          let verifyResult: { isValid: boolean; error?: string }

          if (chainType === 'svm') {
            // Solana atomic verification
            const atomicVerifyRequest = {
              x402Version: 1 as const,
              paymentPayload: payment,
              paymentRequirements: requirements
            }
            verifyResult = await this.facilitatorClient.atomicVerify(atomicVerifyRequest)
          } else {
            // EVM atomic verification (just validates payment format, feePay will be generated by server)
            // Client sends either { userPay } or { signature, authorization }
            if (!payment.userPay && !payment.signature) {
              return await this.send402Response(res, routeConfig, 'EVM atomic payment missing userPay or signature', req)
            }
            verifyResult = { isValid: true }
          }

          if (!verifyResult.isValid) {
            return await this.send402Response(res, routeConfig, `Atomic payment verification failed: ${verifyResult.error}`, req)
          }

          // Step 2: Handle chain-specific atomic payment processing
          try {
            const chainType = getChainType(network)

            if (chainType === 'svm') {
              // Solana atomic: Sign transaction with server wallet
              const { VersionedTransaction } = require('@solana/web3.js')
              const txBuffer = Buffer.from(payment.transaction, 'base64')
              const transaction = VersionedTransaction.deserialize(txBuffer)
              transaction.sign([wallet as Keypair])
              payment.transaction = Buffer.from(transaction.serialize()).toString('base64')
            } else {
              // EVM atomic: Convert client's payment to EVMPayAuth and build complete payload
              const evmNetwork = network as EVMNetwork

              // Client sends { signature, authorization }, we need to convert to EVMPayAuth
              let userPay: EVMPayAuth
              if ('userPay' in payment) {
                // Already in EVMPayAuth format (shouldn't happen from client)
                userPay = payment.userPay as EVMPayAuth
              } else if ('signature' in payment && 'authorization' in payment) {
                // Convert from client format { signature, authorization } to EVMPayAuth
                const sig = ethers.Signature.from(payment.signature)
                userPay = {
                  from: payment.authorization.from,
                  to: payment.authorization.to,
                  value: payment.authorization.value,
                  validAfter: payment.authorization.validAfter,
                  validBefore: payment.authorization.validBefore,
                  nonce: payment.authorization.nonce,
                  v: sig.v,
                  r: sig.r,
                  s: sig.s
                }
              } else {
                throw new Error('Invalid EVM payment format. Expected { signature, authorization }')
              }

              // Get proxy contract from facilitator's /supported endpoint (stored in extraCache)
              const proxyContract = this.extraCache?.proxyContract
              if (!proxyContract) {
                throw new Error(`Proxy contract not configured for network ${evmNetwork}. Check facilitator /supported endpoint.`)
              }

              // Generate feePay signature
              const feePay = await this.generateEVMFeePay(userPay, proxyContract, evmNetwork)

              // Generate callback if route has onGenerateCallback
              let callbackTarget = ethers.ZeroAddress
              let callbackData = '0x'

              if (routeConfig.onGenerateCallback) {
                // Pass payment in EVMPaymentPayload format for callback generation
                const paymentForCallback: any = { userPay }
                const callbackTx = await routeConfig.onGenerateCallback(paymentForCallback, req)
                if (callbackTx.type === 'evm' && 'target' in callbackTx.data && 'calldata' in callbackTx.data) {
                  callbackTarget = callbackTx.data.target
                  callbackData = callbackTx.data.calldata
                }
              }

              // Build complete EVM atomic payment payload
              // Note: proxyContract field is kept for compatibility but facilitator will use its own configured address
              const evmAtomicPayload: EVMAtomicPaymentPayload = {
                userPay,
                feePay,
                target: callbackTarget,
                callback: callbackData,
                proxyContract, // Kept for compatibility, facilitator uses its own configured address
                network: evmNetwork
              }

              // Replace payment payload with complete EVM atomic payload
              payment = evmAtomicPayload
            }
          } catch (error) {
            console.error('Failed to process atomic payment:', error)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            return await this.send402Response(res, routeConfig, `Atomic payment processing failed: ${errorMessage}`, req)
          }

          // Call route-specific verification callback
          if (routeConfig.onPaymentVerified) {
            await routeConfig.onPaymentVerified(payment, req)
          }

          // Step 3: Settle if autoSettle is enabled
          if (routeConfig.autoSettle) {
            // Use unified atomic settle endpoint (network-based routing on facilitator side)
            const atomicSettleRequest: AtomicSettleRequest = {
              x402Version: 1,
              paymentPayload: payment,
              paymentRequirements: requirements,
              callback: { type: 'solana', data: { instructions: [] } } // Only used for SVM, ignored for EVM
            }

            const atomicSettleResponse = await this.facilitatorClient.atomicSettle(atomicSettleRequest)

            if (!atomicSettleResponse.success) {
              return await this.send402Response(res, routeConfig, `Atomic settlement failed: ${atomicSettleResponse.error}`, req)
            }

            const settlementTxHash = atomicSettleResponse.settlementTxHash
            const callbackTxHash = atomicSettleResponse.callbackTxHash

            // Call route-specific settlement callback
            if (routeConfig.onPaymentSettled && settlementTxHash) {
              await routeConfig.onPaymentSettled(payment, settlementTxHash, req)
            }

            // Add transaction info to request for downstream use
            (req as any).x402 = {
              settlementTxHash,
              callbackTxHash,
              payment: payment,
              route: req.path,
              settled: true,
              atomic: true,
              network
            }
          } else {
            // Just verify, no settlement
            (req as any).x402 = {
              payment: payment,
              route: req.path,
              verified: true,
              settled: false,
              atomic: true,
              network
            }
          }
        } else {
          // Regular (non-atomic) transaction flow
          const verifyRequest: VerifyRequest = {
            x402Version: 1,
            paymentPayload: payment,
            paymentRequirements: requirements
          }

          const verifyResponse = await this.facilitatorClient.verify(verifyRequest)

          if (!verifyResponse.isValid) {
            return await this.send402Response(res, routeConfig, 'Payment verification failed', req)
          }

          // Call route-specific verification callback
          if (routeConfig.onPaymentVerified) {
            await routeConfig.onPaymentVerified(payment, req)
          }

          if (routeConfig.autoSettle) {
            // Regular auto-settle
            const settleResponse = await this.facilitatorClient.settle({
              x402Version: 1,
              paymentPayload: payment,
              paymentRequirements: requirements
            })

            if (!settleResponse.success) {
              return await this.send402Response(res, routeConfig, 'Payment settlement failed', req)
            }

            // Call route-specific settlement callback
            if (routeConfig.onPaymentSettled && settleResponse.transactionHash) {
              await routeConfig.onPaymentSettled(payment, settleResponse.transactionHash, req)
            }

            // Add transaction info to request for downstream use
            (req as any).x402 = {
              transactionHash: settleResponse.transactionHash,
              payment: payment,
              route: req.path,
              settled: true,
              atomic: false
            }
          } else {
            // Just verify, no settlement
            (req as any).x402 = {
              payment: payment,
              route: req.path,
              verified: true,
              settled: false,
              atomic: false
            }
          }
        }

        // Payment successful, continue to next middleware
        next()
      } catch (error) {
        console.error('X402 Middleware error:', error)

        // Call global error handler if provided
        if (this.config.onPaymentFailed) {
          await this.config.onPaymentFailed(error as Error, req)
        }

        // Check if we should bypass on error
        if (this.options.bypassOnError) {
          console.warn('Bypassing 402 due to error (bypassOnError=true)')
          return next()
        }

        return await this.send402Response(res, routeConfig, 'Payment processing error', req)
      }
    }
  }

  /**
   * Find matching route configuration for the given path
   */
  private findRouteConfig(path: string): RouteConfig | null {
    for (const route of this.config.routes) {
      if (route.path instanceof RegExp) {
        if (route.path.test(path)) {
          return route
        }
      } else if (typeof route.path === 'string') {
        // Support wildcards like '/api/premium/*'
        if (route.path.endsWith('/*')) {
          const basePath = route.path.slice(0, -2)
          if (path === basePath || path.startsWith(basePath + '/')) {
            return route
          }
        } else if (path === route.path) {
          return route
        }
      }
    }
    return null
  }

  /**
   * Send 402 Payment Required response with route-specific requirements
   */
  private async send402Response(res: Response, routeConfig: RouteConfig, error?: string, req?: Request): Promise<void> {
    // Ensure extra fields are fetched before building requirements
    await this.ensureExtraFields()

    const requirements = await this.buildPaymentRequirements(routeConfig, req)

    const response: X402Response = {
      x402Version: 1,
      error: error,
      accepts: [requirements]
    }

    // Set custom headers if configured
    Object.entries(this.options.customHeaders || {}).forEach(([key, value]) => {
      res.setHeader(key, value)
    })

    res.status(402).json(response)
  }

  /**
   * Build payment requirements for a specific route
   * Supports both static and dynamic requirements
   */
  private async buildPaymentRequirements(routeConfig: RouteConfig, req?: Request): Promise<PaymentRequirements> {
    // Check if paymentRequirements is a function (dynamic)
    let routeReqs: RoutePaymentRequirements
    if (typeof routeConfig.paymentRequirements === 'function') {
      // Dynamic requirements based on request
      routeReqs = await routeConfig.paymentRequirements(req)
    } else {
      // Static requirements
      routeReqs = routeConfig.paymentRequirements
    }

    // Determine network: route-specific overrides global
    const network = routeConfig.network || this.config.network

    // Start with route's extra field if defined
    let extra = routeReqs.extra || {}

    // Merge with cached extra fields from facilitator
    if (this.extraCache) {
      extra = {
        ...this.extraCache,  // Facilitator's extra fields (feePayer, computeUnitPrice, computeUnitLimit, etc.)
        ...extra             // Route's extra fields override facilitator's if specified
      }
    }

    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: network,
      maxAmountRequired: routeReqs.maxAmountRequired || '1000000',
      resource: routeReqs.resource || routeConfig.path.toString(),
      description: routeReqs.description || 'API Access',
      mimeType: routeReqs.mimeType || 'application/json',
      payTo: routeReqs.payTo || this.config.defaultPayTo || '',
      maxTimeoutSeconds: routeReqs.maxTimeoutSeconds || 300,
      asset: routeReqs.asset || this.getAssetAddress(network),
      outputSchema: routeReqs.outputSchema,
      extra: Object.keys(extra).length > 0 ? extra : undefined
    }

    return requirements
  }

  /**
   * Get asset address based on network
   */
  private getAssetAddress(network: Network): string {
    switch (network) {
      case 'solana':
        return 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mainnet
      case 'solana-devnet':
        return 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' // USDC devnet
      case 'base':
        return '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
      case 'base-sepolia':
        return '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC on Base Sepolia
      default:
        return ''
    }
  }

  /**
   * Manually verify payment for a specific route
   */
  async verifyPayment(paymentPayload: any, routePath: string, req?: any): Promise<boolean> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = await this.buildPaymentRequirements(routeConfig, req)

    const request: VerifyRequest = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements
    }

    const response = await this.facilitatorClient.verify(request)
    return response.isValid
  }

  /**
   * Manually settle payment for a specific route
   */
  async settlePayment(paymentPayload: any, routePath: string, req?: any): Promise<{ success: boolean; transactionHash?: string }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = await this.buildPaymentRequirements(routeConfig, req)

    const request = {
      x402Version: 1 as X402Version,
      paymentPayload,
      paymentRequirements: requirements
    }

    const response = await this.facilitatorClient.settle(request)

    return {
      success: response.success,
      transactionHash: response.transactionHash
    }
  }

  /**
   * Manual verify and settle for a specific route (non-atomic)
   */
  async verifyAndSettle(paymentPayload: any, routePath: string, req?: any): Promise<{
    verified: boolean
    settled: boolean
    transactionHash?: string
    error?: string
  }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = await this.buildPaymentRequirements(routeConfig, req)

    const request: VerifyRequest = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements
    }

    return await this.facilitatorClient.verifyAndSettle(request)
  }

  /**
   * Atomic settle with callback for a specific route
   * Executes settlement and callback transaction atomically
   */
  async atomicSettle(
    paymentPayload: any,
    routePath: string,
    callbackGenerator?: (payment: any) => Promise<any>,
    req?: any
  ): Promise<{
    success: boolean
    settlementTxHash?: string
    callbackTxHash?: string
    error?: string
  }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    // Use provided callback generator or route's default
    const generateCallback = callbackGenerator || routeConfig.onGenerateCallback
    if (!generateCallback) {
      throw new Error('No callback generator provided for atomic settlement')
    }

    const requirements = await this.buildPaymentRequirements(routeConfig, req)

    // Generate callback transaction
    const callback = await generateCallback(paymentPayload, { path: routePath })

    const response = await this.facilitatorClient.atomicSettle({
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements,
      callback
    })

    return {
      success: response.success,
      settlementTxHash: response.settlementTxHash,
      callbackTxHash: response.callbackTxHash,
      error: response.error
    }
  }

  /**
   * Get the facilitator client for direct use
   */
  getFacilitatorClient(): FacilitatorClient {
    return this.facilitatorClient
  }

  /**
   * Add a new route configuration dynamically
   */
  addRoute(routeConfig: RouteConfig): void {
    this.config.routes.push(routeConfig)
  }

  /**
   * Remove a route configuration by path
   */
  removeRoute(path: string | RegExp): void {
    this.config.routes = this.config.routes.filter(route => route.path !== path)
  }
}

/**
 * Helper function to create middleware with simple configuration
 */
export function createX402Middleware(
  config: X402Config,
  options?: X402MiddlewareOptions
): RequestHandler<any, any, any, any> {
  const x402 = new X402Middleware(config, options)
  return x402.middleware()
}
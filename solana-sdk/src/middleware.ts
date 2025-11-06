import { Request, Response, NextFunction, RequestHandler } from 'express'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  X402Config,
  X402MiddlewareOptions,
  X402Response,
  PaymentRequirements,
  VerifyRequest,
  AtomicSettleRequest,
  X402Version,
  RouteConfig,
  RoutePaymentRequirements
} from './types'
import { FacilitatorClient } from './facilitator-client'

export class X402Middleware {
  private config: X402Config
  private facilitatorClient: FacilitatorClient
  private options: X402MiddlewareOptions
  private extraCache?: Record<string, any>
  private extraFetched: boolean = false
  private serverKeypair?: Keypair // Solana Keypair for signing atomic transactions

  constructor(config: X402Config, options: X402MiddlewareOptions = {}) {
    this.config = config
    this.options = {
      bypassOnError: options.bypassOnError ?? false,
      customHeaders: options.customHeaders || {}
    }

    // Initialize facilitator client
    this.facilitatorClient = new FacilitatorClient(config.facilitatorUrl)

    // Load server keypair if provided (for atomic transactions)
    if (config.serverKeypair && (config.network === 'solana' || config.network === 'solana-devnet')) {
      try {
        this.serverKeypair = Keypair.fromSecretKey(bs58.decode(config.serverKeypair))
      } catch (error) {
        console.error('Failed to load server keypair:', error)
        throw new Error('Invalid server keypair for atomic transactions')
      }
    }
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

      // Check if payment header is present
      const paymentHeader = req.headers['x-x402-payment']

      if (!paymentHeader) {
        // No payment provided, return 402 with route-specific requirements
        return await this.send402Response(res, routeConfig, undefined, req)
      }

      try {
        // Parse payment from header (base64 decode if needed)
        let payment: any
        if (typeof paymentHeader === 'string') {
          try {
            // Try to parse as base64 first
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8')
            payment = JSON.parse(decoded)
          } catch {
            // Fall back to direct JSON parse
            payment = JSON.parse(paymentHeader)
          }
        } else {
          payment = paymentHeader
        }

        // Ensure extra fields are fetched before building requirements
        await this.ensureExtraFields()

        // Build payment requirements for this route
        const requirements = await this.buildPaymentRequirements(routeConfig, req)

        // Handle atomic transactions differently
        if (routeConfig.atomic) {
          // Atomic transaction flow
          if (!this.serverKeypair) {
            return await this.send402Response(res, routeConfig, 'Server keypair not configured for atomic transactions', req)
          }

          // Step 1: Verify atomic payment with facilitator
          const atomicVerifyRequest = {
            x402Version: 1 as const,
            paymentPayload: payment,
            paymentRequirements: requirements
          }

          const atomicVerifyResponse = await this.facilitatorClient.atomicVerify(atomicVerifyRequest)

          if (!atomicVerifyResponse.isValid) {
            return await this.send402Response(res, routeConfig, 'Atomic payment verification failed', req)
          }

          // Step 2: Server signs the transaction (for callback instructions)
          try {
            const { VersionedTransaction } = require('@solana/web3.js')
            const txBuffer = Buffer.from(payment.transaction, 'base64')
            const transaction = VersionedTransaction.deserialize(txBuffer)
            transaction.sign([this.serverKeypair])
            payment.transaction = Buffer.from(transaction.serialize()).toString('base64')
          } catch (error) {
            console.error('Failed to sign atomic transaction:', error)
            return await this.send402Response(res, routeConfig, 'Failed to sign atomic transaction', req)
          }

          // Call route-specific verification callback
          if (routeConfig.onPaymentVerified) {
            await routeConfig.onPaymentVerified(payment, req)
          }

          // Step 3: Settle if autoSettle is enabled
          if (routeConfig.autoSettle) {
            const atomicSettleRequest: AtomicSettleRequest = {
              x402Version: 1,
              paymentPayload: payment,
              paymentRequirements: requirements,
              callback: { type: 'solana', data: null } // Transaction already signed by server
            }

            const atomicSettleResponse = await this.facilitatorClient.atomicSettle(atomicSettleRequest)

            if (!atomicSettleResponse.success) {
              return await this.send402Response(res, routeConfig, 'Atomic settlement failed', req)
            }

            // Call route-specific settlement callback
            if (routeConfig.onPaymentSettled && atomicSettleResponse.settlementTxHash) {
              await routeConfig.onPaymentSettled(payment, atomicSettleResponse.settlementTxHash, req)
            }

            // Add transaction info to request for downstream use
            (req as any).x402 = {
              settlementTxHash: atomicSettleResponse.settlementTxHash,
              callbackTxHash: atomicSettleResponse.callbackTxHash,
              payment: payment,
              route: req.path,
              settled: true,
              atomic: true
            }
          } else {
            // Just verify, no settlement
            (req as any).x402 = {
              payment: payment,
              route: req.path,
              verified: true,
              settled: false,
              atomic: true
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
      network: this.config.network,
      maxAmountRequired: routeReqs.maxAmountRequired || '1000000',
      resource: routeReqs.resource || routeConfig.path.toString(),
      description: routeReqs.description || 'API Access',
      mimeType: routeReqs.mimeType || 'application/json',
      payTo: routeReqs.payTo || this.config.defaultPayTo || '',
      maxTimeoutSeconds: routeReqs.maxTimeoutSeconds || 300,
      asset: routeReqs.asset || this.getAssetAddress(),
      outputSchema: routeReqs.outputSchema,
      extra: Object.keys(extra).length > 0 ? extra : undefined
    }

    return requirements
  }

  /**
   * Get asset address based on network
   */
  private getAssetAddress(): string {
    switch (this.config.network) {
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
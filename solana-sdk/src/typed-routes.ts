import { Request, Response } from 'express'
import { RouteConfig } from './types'
import {
  TypedRouteDefinition,
  buildOutputSchema,
  extractInput
} from './route-schema'

/**
 * Convert a typed route definition to a RouteConfig
 */
export function createTypedRoute<TInput = any, TOutput = any>(
  definition: TypedRouteDefinition<TInput, TOutput>
): RouteConfig {
  const routeConfig: RouteConfig = {
    path: definition.path,
    atomic: definition.atomic,
    autoSettle: definition.autoSettle,

    // Generate payment requirements with typed input
    paymentRequirements: async (req: Request) => {
      const input = extractInput<TInput>(req, definition.method)
      const requirements = await definition.paymentRequirements({ input, req })

      // Auto-generate outputSchema if not provided
      if (!requirements.outputSchema && (definition.inputSchema || definition.outputSchema)) {
        requirements.outputSchema = buildOutputSchema(
          definition.method,
          definition.inputSchema,
          definition.outputSchema,
          definition.discoverable
        )
      }

      return requirements
    },

    // Copy onGenerateCallback if present
    onGenerateCallback: definition.onGenerateCallback
  }

  return routeConfig
}

/**
 * Create typed Express route handlers
 */
export function createTypedHandlers<TInput = any, TOutput = any>(
  definition: TypedRouteDefinition<TInput, TOutput>
) {
  return {
    // Express handler that extracts typed input and returns typed output
    handler: async (req: Request, res: Response) => {
      try {
        const input = extractInput<TInput>(req, definition.method)
        const output = await definition.handler({ input, req, res })
        res.json(output)
      } catch (error) {
        console.error('Route handler error:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}

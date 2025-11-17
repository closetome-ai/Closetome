import { OutputSchema, PropertySchema, HttpInputSchema, HttpOutputSchema } from './types'

/**
 * Schema builder utility for creating outputSchema definitions
 */
export class SchemaBuilder {
  /**
   * Create an OutputSchema from input and output definitions
   */
  static create(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    options: {
      inputProperties?: Record<string, PropertySchema>
      outputProperties?: Record<string, PropertySchema>
      discoverable?: boolean
    }
  ): OutputSchema {
    const input: HttpInputSchema = {
      type: 'http',
      method,
      discoverable: options.discoverable ?? true,
      properties: options.inputProperties
    }

    const output: HttpOutputSchema = {
      type: 'http',
      properties: options.outputProperties
    }

    return { input, output }
  }

  /**
   * Create a string property schema
   */
  static string(description?: string, options?: { required?: boolean; enum?: string[] }): PropertySchema {
    return {
      type: 'string',
      description,
      required: options?.required,
      enum: options?.enum
    }
  }

  /**
   * Create a number property schema
   */
  static number(description?: string, options?: { required?: boolean }): PropertySchema {
    return {
      type: 'number',
      description,
      required: options?.required
    }
  }

  /**
   * Create a boolean property schema
   */
  static boolean(description?: string, options?: { required?: boolean }): PropertySchema {
    return {
      type: 'boolean',
      description,
      required: options?.required
    }
  }

  /**
   * Create an object property schema
   */
  static object(
    properties: Record<string, PropertySchema>,
    description?: string,
    options?: { required?: boolean }
  ): PropertySchema {
    return {
      type: 'object',
      description,
      properties,
      required: options?.required
    }
  }

  /**
   * Create an array property schema
   */
  static array(
    items: PropertySchema,
    description?: string,
    options?: { required?: boolean }
  ): PropertySchema {
    return {
      type: 'array',
      description,
      items,
      required: options?.required
    }
  }
}

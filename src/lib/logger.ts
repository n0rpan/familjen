/**
 * Structured Logger with PII filtering
 *
 * Provides consistent logging with:
 * - Log levels (debug, info, warn, error)
 * - Dev/prod separation (debug only in development)
 * - Automatic PII scrubbing
 * - Structured output with timestamps
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

// PII patterns to scrub from logs
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  // Norwegian phone numbers (8 digits, with or without country code)
  { pattern: /(?:\+47|0047)?[\s-]?\d{8}/g, replacement: '[PHONE]' },
  // Norwegian personal numbers (11 digits)
  { pattern: /\b\d{11}\b/g, replacement: '[PERSONAL_ID]' },
  // Credit card numbers (basic pattern)
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CARD]' },
  // Passwords in objects
  { pattern: /"password"\s*:\s*"[^"]*"/gi, replacement: '"password":"[REDACTED]"' },
  // Tokens/secrets
  { pattern: /"(token|secret|api_key|apikey|access_token|refresh_token)"\s*:\s*"[^"]*"/gi, replacement: '"$1":"[REDACTED]"' },
]

/**
 * Scrub PII from a string
 */
function scrubPII(input: string): string {
  let result = input
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Safely stringify an object, handling circular references
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  })
}

const isDev = process.env.NODE_ENV === 'development'

class Logger {
  private prefix: string

  constructor(prefix: string = '') {
    this.prefix = prefix
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix
    return new Logger(newPrefix)
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const prefix = this.prefix ? `[${this.prefix}]` : ''
    const contextStr = context ? ` ${safeStringify(context)}` : ''
    return `${timestamp} ${level.toUpperCase()} ${prefix} ${message}${contextStr}`
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const formatted = this.formatMessage(level, message, context)
    const scrubbed = scrubPII(formatted)

    switch (level) {
      case 'debug':
        if (isDev) console.debug(scrubbed)
        break
      case 'info':
        console.info(scrubbed)
        break
      case 'warn':
        console.warn(scrubbed)
        break
      case 'error':
        console.error(scrubbed)
        break
    }
  }

  /**
   * Debug level - only logged in development
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context)
  }

  /**
   * Info level - general information
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context)
  }

  /**
   * Warn level - potential issues
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context)
  }

  /**
   * Error level - errors and exceptions
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        message: error.message,
        name: error.name,
        stack: isDev ? error.stack : undefined,
      } : error,
    }
    this.log('error', message, errorContext)
  }
}

// Default logger instance
export const logger = new Logger()

// Pre-configured loggers for common use cases
export const cronLogger = logger.child('Cron')
export const apiLogger = logger.child('API')
export const authLogger = logger.child('Auth')
export const integrationLogger = logger.child('Integration')
export const cacheLogger = logger.child('Cache')

// Export the class for custom loggers
export { Logger }

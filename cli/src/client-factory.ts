/**
 * Build an AirlockClient from stored config + env vars,
 * with a friendly error when no key is available.
 */
import { AirlockClient } from '@airlock/sdk'
import { resolveCredentials } from './config.js'
import { printError } from './output.js'

export function makeClient(opts?: { baseUrl?: string; apiKey?: string }): AirlockClient {
  const creds = resolveCredentials()

  const apiKey = opts?.apiKey ?? creds.apiKey
  const baseUrl = opts?.baseUrl ?? creds.baseUrl

  if (!apiKey) {
    printError("No API key configured. Run 'airlock init' first, or set AIRLOCK_API_KEY.")
    process.exit(1)
  }

  return new AirlockClient({ apiKey, baseUrl })
}

/**
 * Like makeClient() but returns null instead of exiting when no key is set.
 * Used by `airlock init` which constructs its own client mid-flow.
 */
export function makeClientOptional(opts?: {
  baseUrl?: string
  apiKey?: string
}): AirlockClient | null {
  const creds = resolveCredentials()
  const apiKey = opts?.apiKey ?? creds.apiKey
  const baseUrl = opts?.baseUrl ?? creds.baseUrl
  if (!apiKey) return null
  return new AirlockClient({ apiKey, baseUrl })
}

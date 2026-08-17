/**
 * Shared HTTP transport for built-in quota probes. Every probe sends a GET
 * with provider-specific authorization headers and parses the JSON body at
 * its own boundary; this module only turns transport and HTTP status failures
 * into one catchable `QuotaProbeError`.
 * @module dsh-llm-router/probe/http
 */

/** Minimal fetch signature used by probes; matches the global `fetch`. */
export type ProbeFetcher = (input: string, init?: RequestInit) => Promise<Response>

/** Failure from a quota API transport or HTTP status. */
export class QuotaProbeError extends Error {
  /**
   * @param message - provider-facing failure summary without the API key.
   * @param options - optional cause chain for transport failures.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'QuotaProbeError'
  }
}

/**
 * Fetch one JSON document with a GET request.
 * @param url - provider quota endpoint.
 * @param headers - request headers, excluding `Accept: application/json`.
 * @param fetcher - fetch implementation; the global `fetch` when omitted.
 * @returns the parsed JSON body, already typed as `unknown` for the caller's boundary.
 */
export async function fetchJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  fetcher: ProbeFetcher,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
    })
  } catch (error: unknown) {
    throw new QuotaProbeError(`quota probe transport failed for ${url}`, { cause: error })
  }
  if (!response.ok) {
    throw new QuotaProbeError(`quota probe HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

/**
 * Browser-visible trust fence shared by the host Web bundle and the browser
 * connection client. The Web bundle injects these values into the page so the
 * client can mirror the server's privileged-method widening for trusted LANs.
 */

/** Global name the Web bundle uses to expose the LAN trust fence to the browser. */
export const WEB_TRUST_GLOBAL = '__DSH_WEB_TRUST__' as const

/** Browser-visible subset of the Web runtime's trust fence. */
export interface WebTrust {
  trustedHosts: string[]
  trustedNetworks: string[]
}

/**
 * @deepseek-ai/dsh-random-uuid — RFC 4122 version 4 UUIDs without a secure
 * context. Browsers gate `crypto.randomUUID` behind secure contexts, so it is
 * absent on the plain-HTTP LAN origins the Web GUI itself prints; `crypto.
 * getRandomValues` is exposed on every browser origin and by Node's webcrypto
 * global, and is the only primitive this generator needs.
 * @module @deepseek-ai/dsh-random-uuid
 */

/**
 * Generate one RFC 4122 version 4 UUID.
 * @returns a fresh UUID string backed by `crypto.getRandomValues`, available
 * on insecure browser origins where `crypto.randomUUID` is not.
 */
export function randomUuid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

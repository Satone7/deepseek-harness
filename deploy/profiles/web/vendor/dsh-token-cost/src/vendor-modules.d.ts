/**
 * Ambient types for the npm-runtime spellings of dependencies the repository
 * carries under rescoped names. The bundle keeps both specifiers external, so
 * these declarations shape typecheck only; the deployed profile's node_modules
 * resolves the real npm packages at runtime.
 */

declare module 'schemastery' {
  export * from '@deepseek-ai/schemastery'
  export { default } from '@deepseek-ai/schemastery'
}

declare module 'fzstd' {
  /** Decompress one zstd frame into a fresh Uint8Array. */
  export function decompress(data: Uint8Array): Uint8Array
}

/**
 * Self-contained tsdown build for the vendored dsh-token-cost plugin: the
 * Node half (lib/index.js, ESM) plus the browser half (lib/client.js, the
 * closure-factory artifact the dsh plugin module loader executes). The
 * package lives outside the pnpm workspace and the repository's shared
 * tsdown preset (which resolves externals from the workspace package
 * manifests), so the externals policy and the CSS Modules inline are stated here.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const id = '@deepseek-ai/dsh-token-cost'

/**
 * Node half. A leaf plugin: every bare specifier resolves from the deployed
 * profile's node_modules (workspace dsh packages, fzstd), so nothing inlines.
 */
const node: UserConfig = {
  name: id,
  // The tsc face (tsconfig.build.json), not src: rolldown keeps relative
  // `.ts` specifiers as imports under this tsconfig's relative-extension
  // rewrite, which would strand them in the shipped artifact. The compiled
  // relative imports are plain `.js` and bundle normally.
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  // Relative modules inline into the single-file artifact; every bare
  // specifier stays an import — the deployed profile's node_modules resolves
  // them. Stated as rolldown's own external predicate: the deps plugin's
  // neverBundle/alwaysBundle pair left the relative imports stranded as
  // external imports in the shipped artifact.
  external: specifier => !specifier.startsWith('.') && !specifier.startsWith('/'),
}

/**
 * Browser half. React rows are loader module-table requests (external);
 * everything else — the client runtime types are type-only — inlines.
 */
const REQUESTED_CLIENT_MODULES = new Set(['react', 'react-dom', 'react/jsx-runtime'])

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const client: UserConfig = {
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => REQUESTED_CLIENT_MODULES.has(specifier),
    alwaysBundle: specifier => !REQUESTED_CLIENT_MODULES.has(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: [
        (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
        'browser', 'import', 'module', 'default',
      ],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-vendor-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const fileId = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + fileId + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      const tagId = `${id}/${fileId.split('/').pop()}`
      const lines = [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(id)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
      ]
      lines.push(Object.keys(classMap).length === 0 ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
      return lines.join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [node, client]

import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const shimUrl = pathToFileURL(path.resolve('./tests/vue_shim.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vue') {
      return { url: shimUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  }
})

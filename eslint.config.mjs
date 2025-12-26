import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next')

export default [
  ...nextConfig,
  {
    rules: {
      // These rules are too strict for common React patterns
      'react-hooks/set-state-in-effect': 'off', // Setting state in effects is often necessary (hydration, async)
      'react-hooks/immutability': 'off', // Too many false positives with callback patterns
      // React Compiler rules - downgrade to warnings for existing code patterns
      'react-hooks/static-components': 'warn', // Components defined in render - needs refactoring
      'react-hooks/refs': 'warn', // Ref access during render - some false positives
      'react/no-children-prop': 'warn', // Downgrade to warning
    },
  },
]

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next')

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      // These rules are too strict for common React patterns
      'react-hooks/set-state-in-effect': 'off', // Setting state in effects is often necessary (hydration, async)
      'react-hooks/immutability': 'off', // Too many false positives with callback patterns
      // This codebase uses 'children' as a domain prop for household kids (Child[]), not React children
      // Example: <WeekGrid children={householdChildren} /> where children: Child[] is an array of kids
      // The warning is about React's children prop pattern, but our usage is intentional
      'react/no-children-prop': 'off',
    },
  },
]

export default eslintConfig

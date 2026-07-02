// eslint-config-next@16 ships native flat-config arrays (Linter.Config[]);
// wrapping them in @eslint/eslintrc's FlatCompat (the Next 15 pattern)
// crashes eslint's config validator.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
]

export default eslintConfig

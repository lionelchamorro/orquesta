import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const base = dirname(fileURLToPath(import.meta.url))

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': { base },
  },
}

export default config

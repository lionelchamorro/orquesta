import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for the Docker web image (Task 15) — copies
  // only the traced production dependencies into .next/standalone instead of
  // shipping the whole node_modules tree.
  output: 'standalone',
  turbopack: {
    root: __dirname,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig

/**
 * Extract { interfaceName: fieldName[] } from lib/types.ts and print it as
 * JSON. Used by test/test_contract_types.py as the TypeScript side of the
 * Pydantic<->types.ts field-name contract check (that test re-implements
 * this same brace-depth extraction directly in Python so the check runs
 * without Node; this script exists so the same snapshot can also be
 * generated/diffed from the web CI job, per the plan's scripts/gen-ts-
 * contract.ts + snapshot comparison design).
 *
 * Deliberately regex/brace-depth based rather than using the TypeScript
 * compiler API: every interface in lib/types.ts is flat (fields reference
 * other named interfaces via Record<string, X> rather than inlining nested
 * object types), so a full AST isn't needed.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TYPES_PATH = join(__dirname, "..", "lib", "types.ts")

function extractInterfaces(source: string): Record<string, string[]> {
  const lines = source.split("\n")
  const result: Record<string, string[]> = {}

  let currentName: string | null = null
  let depth = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (currentName === null) {
      const match = /^export interface (\w+)\s*\{/.exec(line)
      if (match) {
        currentName = match[1]
        result[currentName] = []
        depth = 1
      }
      continue
    }

    depth += (line.match(/\{/g) ?? []).length
    depth -= (line.match(/\}/g) ?? []).length

    if (depth <= 0) {
      currentName = null
      continue
    }

    if (depth === 1) {
      const fieldMatch = /^(\w+)\??:/.exec(line)
      if (fieldMatch) result[currentName].push(fieldMatch[1])
    }
  }

  return result
}

const source = readFileSync(TYPES_PATH, "utf-8")
process.stdout.write(JSON.stringify(extractInterfaces(source), null, 2) + "\n")

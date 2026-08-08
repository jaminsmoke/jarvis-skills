import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export interface KanbanConfig {
  projectId: string
  repoId: string
  repo: string
  fields: Record<string, string>
  options: {
    status: Record<string, string>
    version: Record<string, string>
    priority: Record<string, string>
    decision: Record<string, string>
    tipo: Record<string, string>
    area: Record<string, string>
    highlighted: Record<string, string>
  }
}

let _config: KanbanConfig | null = null

/**
 * Load .kanbanrc.json from the current working directory.
 * Walks up until found or reaches filesystem root.
 * Caches the result for the process lifetime.
 */
export function loadConfig(): KanbanConfig {
  if (_config) return _config

  let dir = process.cwd()
  const root = process.platform === "win32" ? dir.split("\\")[0] + "\\" : "/"

  while (true) {
    const path = resolve(dir, ".kanbanrc.json")
    try {
      const raw = readFileSync(path, "utf-8")
      _config = JSON.parse(raw) as KanbanConfig
      validateConfig(_config)
      return _config
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        // file not found — walk up
      } else if (e instanceof SyntaxError) {
        throw new Error(`Invalid JSON in ${path}: ${e.message}`)
      } else {
        throw e
      }
    }
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }

  throw new Error(".kanbanrc.json not found. Create one in your project root.")
}

function validateConfig(c: KanbanConfig): void {
  const required = ["projectId", "repoId", "repo", "fields", "options"]
  for (const key of required) {
    if (!(key in c)) throw new Error(`.kanbanrc.json missing required key: ${key}`)
  }
  const requiredFields = ["Status", "Versión", "Prioridad", "Decision", "Tipo", "Área principal", "HighLighted"]
  for (const f of requiredFields) {
    if (!(f in c.fields)) throw new Error(`.kanbanrc.json fields missing: ${f}`)
  }
}

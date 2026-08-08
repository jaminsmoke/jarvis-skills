#!/usr/bin/env bun
/**
 * kanban-cli — GitHub Projects kanban toolkit
 *
 * Usage:
 *   bun cli.ts create --title "Fix X" --tipo bug --area desktop
 *   bun cli.ts body <itemId>              # read body
 *   bun cli.ts body <itemId> --set "..."  # replace body
 *   bun cli.ts body <itemId> --append "Sección" "..." # append section
 */

import { loadConfig } from "./src/config"
import { FieldResolver } from "./src/fields"
import { TEMPLATES, appendSection } from "./src/templates"
import { createItem, getBody, updateBody } from "./src/items"

const args = process.argv.slice(2)
const command = args[0]

function parseFlags(rest: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2)
      const val = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true"
      flags[key] = val
    }
  }
  return flags
}

async function main() {
  if (!command || command === "help" || command === "--help") {
    console.log(`kanban-cli — GitHub Projects kanban toolkit

Usage:
  bun cli.ts create --title "Fix X" --tipo bug --area desktop [--priority Alta] [--body "..."]
  bun cli.ts body <itemId>                   # read current body
  bun cli.ts body <itemId> --set "..."       # replace entire body
  bun cli.ts body <itemId> --append "Plan" "content"  # append a section
  bun cli.ts help                            # show this help
`)
    return
  }

  const cfg = loadConfig()
  const fields = new FieldResolver(cfg)

  if (command === "create") {
    const flags = parseFlags(args.slice(1))
    if (!flags.title) {
      console.error("ERROR: --title is required")
      process.exit(1)
    }
    const result = await createItem(fields, {
      title: flags.title,
      body: flags.body,
      tipo: flags.tipo,
      area: flags.area,
      priority: flags.priority,
      version: flags.version,
    })
    console.log(JSON.stringify(result))
    return
  }

  if (command === "body") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }
    const flags = parseFlags(args.slice(2))

    if (flags.set) {
      await updateBody(itemId, flags.set)
      console.log("Body replaced OK")
    } else if (flags.append) {
      const section = flags.append
      const content = flags.content ?? args.slice(args.indexOf(section) + 2).join(" ")
      if (!content) {
        console.error("ERROR: --append requires --content or positional content")
        process.exit(1)
      }
      await updateBody(itemId, appendSection(await getBody(itemId), section, content))
      console.log(`Section "${section}" appended OK`)
    } else {
      const body = await getBody(itemId)
      console.log(body)
    }
    return
  }

  console.error(`Unknown command: ${command}. Run "bun cli.ts help" for usage.`)
  process.exit(1)
}

main().catch((e) => {
  console.error("ERROR:", e.message)
  process.exit(1)
})

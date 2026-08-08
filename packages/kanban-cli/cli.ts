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
import { createItem, getBody, updateBody, moveItem, archiveItem, unarchiveItem, clearFieldValue } from "./src/items"
import { generateConfig, validateConfig } from "./src/config-tools"
import { listItems } from "./src/list"
import { createField, updateField, addFieldOption, deleteField } from "./src/fields-mutations"
import type { FieldDataType, OptionColor, FieldOption } from "./src/fields-mutations"
import { convertDraftToIssue } from "./src/conversions"
import { writeFileSync } from "node:fs"

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

const VALID_COLORS = ["GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE"]

function parseOptions(raw: string): Array<{ name: string; color: string; description: string }> {
  return raw.split(",").map((opt) => {
    const [name, color = "GRAY", description = ""] = opt.split(":")
    const c = color.trim().toUpperCase()
    if (!VALID_COLORS.includes(c)) {
      console.error(`Invalid color: ${c}. Valid: ${VALID_COLORS.join(", ")}`)
      process.exit(1)
    }
    return { name: name.trim(), color: c, description: description.trim() || name.trim() }
  })
}

async function main() {
  if (!command || command === "help" || command === "--help") {
    console.log(`kanban-cli — GitHub Projects kanban toolkit

Usage:
  bun cli.ts create --title "Fix X" --tipo bug --area desktop [--priority Alta] [--body "..."]
  bun cli.ts body <itemId>                   # read current body
  bun cli.ts body <itemId> --set "..."       # replace entire body
  bun cli.ts body <itemId> --append "Plan" "content"  # append a section
  bun cli.ts config generate --project PVT_...         # generate .kanbanrc.json
  bun cli.ts config validate                           # validate against Project
  bun cli.ts list [--status X] [--tipo X] [--area X]  # list items
  bun cli.ts create-field --name "..." --data-type SINGLE_SELECT [--options "A:GRAY,B:BLUE"]
  bun cli.ts update-field --field-id "..." [--name "..."] [--options "A:GRAY,B:BLUE"]
  bun cli.ts add-option --field-id "..." --name "..." --color GRAY --desc "..."
  bun cli.ts delete-field --field-id "..."
  bun cli.ts convert-draft <itemId>
  bun cli.ts move <itemId> [--after <afterItemId>]
  bun cli.ts archive <itemId>
  bun cli.ts unarchive <itemId>
  bun cli.ts clear-field <itemId> --field-id "..."
  bun cli.ts help                                      # show this help
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
      const content = flags.content ?? args.slice(args.indexOf(section) + 1).join(" ")
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

  if (command === "config") {
    const sub = args[1]
    const flags = parseFlags(args.slice(2))

    if (sub === "generate") {
      const projectId = flags.project
      if (!projectId) {
        console.error("ERROR: --project <PROJECT_ID> is required")
        process.exit(1)
      }
      const cfg = await generateConfig(projectId)
      writeFileSync(".kanbanrc.json", JSON.stringify(cfg, null, 2) + "\n")
      console.log("Generated .kanbanrc.json with", Object.keys(cfg.fields).length, "fields")
      console.log("⚠️  Fill in repoId and repo manually")
      return
    }

    if (sub === "validate") {
      const issues = await validateConfig()
      if (issues.length === 0) {
        console.log("✅ .kanbanrc.json is valid")
      } else {
        console.log(`❌ ${issues.length} issues found:`)
        for (const i of issues) console.log("  -", i)
        process.exit(1)
      }
      return
    }

    console.error("Usage: bun cli.ts config <generate|validate>")
    process.exit(1)
  }

  if (command === "list") {
    const flags = parseFlags(args.slice(1))
    const items = await listItems({
      status: flags.status,
      tipo: flags.tipo,
      area: flags.area,
      version: flags.version,
      limit: flags.limit ? parseInt(flags.limit) : 50,
    })
    for (const item of items) {
      const num = item.number ? `#${item.number}` : "DRAFT"
      console.log(`${item.id.slice(0, 20)} ${num.padEnd(6)} [${(item.status ?? "-").padEnd(12)}] ${(item.tipo ?? "-").padEnd(14)} ${(item.area ?? "-").padEnd(12)} ${item.title.slice(0, 60)}`)
    }
    console.log(`${items.length} items`)
    return
  }

  if (command === "create-field") {
    const flags = parseFlags(args.slice(1))
    if (!flags.name || !flags["data-type"]) {
      console.error("ERROR: --name and --data-type are required")
      process.exit(1)
    }

    const dataType = flags["data-type"].toUpperCase() as FieldDataType
    let options: FieldOption[] | undefined

    if (flags.options) {
      options = parseOptions(flags.options) as FieldOption[]
    }

    const result = await createField(flags.name, dataType, options)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === "update-field") {
    const flags = parseFlags(args.slice(1))
    if (!flags["field-id"]) {
      console.error("ERROR: --field-id is required")
      process.exit(1)
    }

    let options: FieldOption[] | undefined
    if (flags.options) {
      options = parseOptions(flags.options) as FieldOption[]
    }

    const result = await updateField(flags["field-id"], flags.name, options)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === "add-option") {
    const flags = parseFlags(args.slice(1))
    if (!flags["field-id"] || !flags.name || !flags.color) {
      console.error("ERROR: --field-id, --name, and --color are required")
      process.exit(1)
    }

    const color = flags.color.toUpperCase()
    if (!VALID_COLORS.includes(color)) {
      console.error(`Invalid color: ${color}. Valid: ${VALID_COLORS.join(", ")}`)
      process.exit(1)
    }

    const option: FieldOption = {
      name: flags.name,
      color: color as OptionColor,
      description: flags.desc ?? flags.name,
    }

    const result = await addFieldOption(flags["field-id"], option)
    console.log(JSON.stringify(result, null, 2))
    console.log("⚠️  Option IDs changed. Run 'bun cli.ts config generate --project ...' to sync .kanbanrc.json")
    return
  }

  if (command === "delete-field") {
    const flags = parseFlags(args.slice(1))
    if (!flags["field-id"]) {
      console.error("ERROR: --field-id is required")
      process.exit(1)
    }

    await deleteField(flags["field-id"])
    console.log(`Field ${flags["field-id"]} deleted OK`)
    return
  }

  if (command === "convert-draft") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }

    const result = await convertDraftToIssue(itemId)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === "move") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }
    const flags = parseFlags(args.slice(2))
    await moveItem(cfg.projectId, itemId, flags.after)
    console.log(`Item ${itemId} moved${flags.after ? ` after ${flags.after}` : " to top"}`)
    return
  }

  if (command === "archive") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }
    await archiveItem(cfg.projectId, itemId)
    console.log(`Item ${itemId} archived`)
    return
  }

  if (command === "unarchive") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }
    await unarchiveItem(cfg.projectId, itemId)
    console.log(`Item ${itemId} unarchived`)
    return
  }

  if (command === "clear-field") {
    const itemId = args[1]
    if (!itemId) {
      console.error("ERROR: itemId required")
      process.exit(1)
    }
    const flags = parseFlags(args.slice(2))
    if (!flags["field-id"]) {
      console.error("ERROR: --field-id is required")
      process.exit(1)
    }
    await clearFieldValue(cfg.projectId, itemId, flags["field-id"])
    console.log(`Field ${flags["field-id"]} cleared from item ${itemId}`)
    return
  }

  console.error(`Unknown command: ${command}. Run "bun cli.ts help" for usage.`)
  process.exit(1)
}

main().catch((e) => {
  console.error("ERROR:", e.message)
  process.exit(1)
})

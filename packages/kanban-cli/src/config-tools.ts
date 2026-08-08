import { gql } from "./client"
import { loadConfig, type KanbanConfig } from "./config"
import { writeFileSync } from "node:fs"

/**
 * Generate .kanbanrc.json from a GitHub Project V2.
 * Queries all fields and options and builds the config.
 */
export async function generateConfig(projectId: string): Promise<KanbanConfig> {
  const data = await gql<{
    node: {
      fields: {
        nodes: Array<{
          id: string
          name: string
          dataType: string
          options?: Array<{ id: string; name: string }>
        }>
      }
    }
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id, name, dataType }
              ... on ProjectV2SingleSelectField { id, name, dataType, options { id, name } }
            }
          }
        }
      }
    }`,
    { projectId }
  )

  const fields: Record<string, string> = {}
  const options: KanbanConfig["options"] = {
    status: {},
    version: {},
    priority: {},
    decision: {},
    tipo: {},
    area: {},
    highlighted: {},
  }

  const nameToCategory: Record<string, keyof KanbanConfig["options"]> = {
    Status: "status",
    Versión: "version",
    Version: "version",
    Prioridad: "priority",
    Priority: "priority",
    Decisión: "decision",
    Decision: "decision",
    Tipo: "tipo",
    Type: "tipo",
    "Área principal": "area",
    Area: "area",
    HighLighted: "highlighted",
    Highlighted: "highlighted",
  }

  for (const f of data.node.fields.nodes) {
    if (f.name === "Title" || f.name === "Assignees" || f.name === "Labels" ||
        f.name === "Linked pull requests" || f.name === "Milestone" ||
        f.name === "Repository" || f.name === "Reviewers" ||
        f.name === "Parent issue" || f.name === "Sub-issues progress" ||
        f.name === "Created at" || f.dataType === "TITLE" || f.dataType === "ASSIGNEES" ||
        f.dataType === "LABELS" || f.dataType === "LINKED_PULL_REQUESTS" ||
        f.dataType === "MILESTONE" || f.dataType === "REPOSITORY" ||
        f.dataType === "REVIEWERS" || f.dataType === "PARENT_ISSUE" ||
        f.dataType === "SUB_ISSUES_PROGRESS") {
      continue
    }

    fields[f.name] = f.id

    const cat = nameToCategory[f.name]
    if (cat && f.options) {
      for (const o of f.options) {
        options[cat][o.name] = o.id
      }
    }
  }

  // Also query repo info
  const repoData = await gql<{ node: { title: string } }>(
    `query($projectId: ID!) { node(id: $projectId) { ... on ProjectV2 { title } } }`,
    { projectId }
  )

  return {
    projectId,
    repoId: "REPLACE_ME", // User must fill this in
    repo: "REPLACE_ME",   // User must fill this in
    fields,
    options,
  }
}

/**
 * Validate that .kanbanrc.json matches the real Project fields.
 * Returns array of issues found (empty = valid).
 */
export async function validateConfig(): Promise<string[]> {
  const cfg = loadConfig()
  const issues: string[] = []

  const data = await gql<{
    node: {
      fields: {
        nodes: Array<{
          id: string
          name: string
          options?: Array<{ id: string; name: string }>
        }>
      }
    }
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id, name }
              ... on ProjectV2SingleSelectField { id, name, options { id, name } }
            }
          }
        }
      }
    }`,
    { projectId: cfg.projectId }
  )

  const realFields = new Map(data.node.fields.nodes.map(f => [f.name, f]))

  for (const [name, id] of Object.entries(cfg.fields)) {
    const real = realFields.get(name)
    if (!real) {
      issues.push(`Field "${name}" (${id}) not found in Project`)
    } else if (real.id !== id) {
      issues.push(`Field "${name}": config has ${id}, Project has ${real.id}`)
    }
  }

  for (const [cat, opts] of Object.entries(cfg.options)) {
    const fieldName = Object.entries({
      status: "Status", version: "Versión", priority: "Prioridad",
      decision: "Decisión", tipo: "Tipo", area: "Área principal",
      highlighted: "HighLighted",
    }).find(([, v]) => v && cat === v)?.[0] ?? cat

    const real = realFields.get(fieldName)
    if (!real || !real.options) continue
    const realOptions = new Map(real.options.map(o => [o.name, o.id]))
    for (const [name, id] of Object.entries(opts)) {
      const realId = realOptions.get(name)
      if (!realId) {
        issues.push(`Option "${name}" in ${cat}: not found in Project`)
      } else if (realId !== id) {
        issues.push(`Option "${name}" in ${cat}: config has ${id}, Project has ${realId}`)
      }
    }
  }

  return issues
}

import { gql } from "./client"
import { loadConfig } from "./config"

interface ListFilters {
  status?: string
  version?: string
  tipo?: string
  area?: string
  limit?: number
}

interface ListItem {
  id: string
  title: string
  type: "DraftIssue" | "Issue"
  number?: number
  status?: string
  version?: string
  tipo?: string
  area?: string
}

/**
 * List kanban items with optional filters.
 */
export async function listItems(filters: ListFilters = {}): Promise<ListItem[]> {
  const cfg = loadConfig()
  const limit = filters.limit ?? 50

  const data = await gql<{
    node: {
      items: {
        nodes: Array<{
          id: string
          content: { __typename: string; title: string; number?: number }
          fieldValues: {
            nodes: Array<{
              name?: string
              date?: string
              field: { name: string }
            }>
          }
        }>
      }
    }
  }>(
    `query($projectId: ID!, $limit: Int!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: $limit) {
            nodes {
              id
              content { __typename, ... on DraftIssue { title } ... on Issue { title, number } }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue { name, field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldDateValue { date, field { ... on ProjectV2FieldCommon { name } } }
                }
              }
            }
          }
        }
      }
    }`,
    { projectId: cfg.projectId, limit }
  )

  const items: ListItem[] = []

  for (const node of data.node.items.nodes) {
    const ct = node.content as { __typename: string; title: string; number?: number }
    const fv: Record<string, string> = {}
    for (const v of node.fieldValues.nodes) {
      if (v.name) fv[v.field.name] = v.name
      if (v.date) fv[v.field.name] = v.date
    }

    const status = fv["Status"] ?? "-"
    const version = fv["Versión"] ?? fv["Version"] ?? "-"
    const tipo = fv["Tipo"] ?? "-"
    const area = fv["Área principal"] ?? fv["Area"] ?? "-"

    // Apply filters
    if (filters.status && status !== filters.status) continue
    if (filters.version && version !== filters.version) continue
    if (filters.tipo && tipo !== filters.tipo) continue
    if (filters.area && area !== filters.area) continue

    items.push({
      id: node.id,
      title: ct.title,
      type: ct.__typename as "DraftIssue" | "Issue",
      number: ct.number,
      status,
      version,
      tipo,
      area,
    })
  }

  return items
}

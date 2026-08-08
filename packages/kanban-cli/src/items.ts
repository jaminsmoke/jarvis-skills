import { gql } from "./client"
import { FieldResolver } from "./fields"
import { TEMPLATES, appendSection } from "./templates"

interface CreateInput {
  title: string
  body?: string
  tipo?: string
  area?: string
  priority?: string
  version?: string
  extra?: Record<string, string>
}

interface CreateResult {
  itemId: string
  title: string
}

/**
 * Create a DraftIssue in the kanban with all fields set.
 */
export async function createItem(fields: FieldResolver, input: CreateInput): Promise<CreateResult> {
  const body = input.body ?? TEMPLATES.detectado(input.extra)
  const now = new Date()
  const inicioExacto = now.toISOString().replace(/\.\d{3}Z$/, "Z")
  const inicio = now.toISOString().slice(0, 10)

  // The mutation doesn't return the item ID (GitHub API limitation).
  // Create, then find by title in the most recent items.
  await gql(
    `mutation($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        clientMutationId
      }
    }`,
    { projectId: fields.projectId, title: input.title, body }
  )

  // Find the newly created item by title
  const result = await gql(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(last: 10) {
            nodes { id, content { __typename, ... on DraftIssue { title } ... on Issue { title } } }
          }
        }
      }
    }`,
    { projectId: fields.projectId }
  ) as { node: { items: { nodes: Array<{ id: string; content: Record<string, unknown> }> } } }

  // GitHub API eventual consistency: retry find for up to 5s
  let found: { id: string } | undefined
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500))
    const q = await gql(
      `query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(last: 10) {
              nodes { id, content { __typename, ... on DraftIssue { title } ... on Issue { title } } }
            }
          }
        }
      }`,
      { projectId: fields.projectId }
    ) as { node: { items: { nodes: Array<{ id: string; content: { title?: string } }> } } }
    found = q.node.items.nodes.find((n) => n.content.title === input.title) as { id: string } | undefined
    if (found) break
  }
  if (!found) throw new Error("Item created but could not be found by title. Retry with a unique title.")
  const itemId = found.id

  // Set all fields
  const setField = async (fieldId: string, optionId: string) => {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, optionId }
    )
  }

  const setText = async (fieldId: string, text: string) => {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { text: $text }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, text }
    )
  }

  const setDate = async (fieldId: string, date: string) => {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { date: $date }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, date }
    )
  }

  await setField(fields.fieldId("Status"), fields.status("Detectado"))
  await setField(fields.fieldId("Version"), fields.version(input.version ?? "Sin asignar"))
  await setField(fields.fieldId("Prioridad"), fields.priority(input.priority ?? "Alta"))
  if (input.tipo) await setField(fields.fieldId("Tipo"), fields.tipo(input.tipo))
  if (input.area) await setField(fields.fieldId("Area"), fields.area(input.area))
  await setText(fields.fieldId("Inicio exacto"), inicioExacto)
  await setDate(fields.fieldId("Inicio"), inicio)

  return { itemId, title: input.title }
}

/**
 * Get the current body of a DraftIssue.
 */
export async function getBody(itemId: string): Promise<string> {
  const result = await gql<{ node: { content: { body?: string; title?: string } } }>(
    `query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          content { ... on DraftIssue { body } ... on Issue { body } }
        }
      }
    }`,
    { itemId }
  )
  return result.node.content.body ?? ""
}

/**
 * Update the body of a DraftIssue. Keeps existing title.
 */
export async function updateBody(itemId: string, body: string): Promise<void> {
  // First get the draft Id (differs for Draft vs Issue)
  const item = await gql<{ node: { content: { __typename: string; id: string } } }>(
    `query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          content { __typename, ... on DraftIssue { id } ... on Issue { id } }
        }
      }
    }`,
    { itemId }
  )

  const content = item.node.content
  const __typename = content.__typename

  if (__typename === "DraftIssue") {
    await gql(
      `mutation($draftId: ID!, $body: String!) {
        updateProjectV2DraftIssue(input: { draftIssueId: $draftId, body: $body }) {
          clientMutationId
        }
      }`,
      { draftId: content.id, body }
    )
  } else {
    await gql(
      `mutation($issueId: ID!, $body: String!) {
        updateIssue(input: { id: $issueId, body: $body }) {
          clientMutationId
        }
      }`,
      { issueId: content.id, body }
    )
  }
}

/**
 * Append a section to an existing item body, then update it.
 */
export async function appendBodySection(itemId: string, sectionName: string, content: string): Promise<void> {
  const current = await getBody(itemId)
  const updated = appendSection(current, sectionName, content)
  await updateBody(itemId, updated)
}

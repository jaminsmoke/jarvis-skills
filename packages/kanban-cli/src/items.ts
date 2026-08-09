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

  // Resolve every field and option ID BEFORE creating the draft, so an invalid
  // name fails fast and never leaves an orphaned DraftIssue behind.
  const resolvedSelect = [
    { fieldId: fields.fieldId("Status"), optionId: fields.status("Detectado") },
    { fieldId: fields.fieldId("Versión"), optionId: fields.version(input.version ?? "Sin asignar") },
    { fieldId: fields.fieldId("Prioridad"), optionId: fields.priority(input.priority ?? "Alta") },
    ...(input.tipo ? [{ fieldId: fields.fieldId("Tipo"), optionId: fields.tipo(input.tipo) }] : []),
    ...(input.area ? [{ fieldId: fields.fieldId("Área principal"), optionId: fields.area(input.area) }] : []),
  ]
  const inicioExactoFieldId = fields.fieldId("Inicio exacto")
  const inicioFieldId = fields.fieldId("Inicio")

  // addProjectV2DraftIssue returns the item ID directly (confirmed via API test).
  const createResult = await gql<{
    addProjectV2DraftIssue: { projectItem: { id: string } }
  }>(
    `mutation($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        projectItem { id }
      }
    }`,
    { projectId: fields.projectId, title: input.title, body }
  )

  const itemId = createResult.addProjectV2DraftIssue.projectItem.id

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

  for (const { fieldId, optionId } of resolvedSelect) {
    await setField(fieldId, optionId)
  }
  await setText(inicioExactoFieldId, inicioExacto)
  await setDate(inicioFieldId, inicio)

  return { itemId, title: input.title }
}

/** Map a field name to its option category in .kanbanrc.json */
const FIELD_TO_CATEGORY: Record<string, keyof import("./config").KanbanConfig["options"]> = {
  Status: "status",
  "Versión": "version",
  Version: "version",
  Prioridad: "priority",
  Priority: "priority",
  "Decisión": "decision",
  Decision: "decision",
  Tipo: "tipo",
  Type: "tipo",
  "Área principal": "area",
  Area: "area",
  HighLighted: "highlighted",
  Highlighted: "highlighted",
}

interface SetFieldInput {
  option?: string
  text?: string
  date?: string
}

/**
 * Set a field value on any item (Draft or Issue).
 * Supports single-select options, text and date values.
 */
export async function setFieldValue(
  fields: FieldResolver,
  itemId: string,
  fieldName: string,
  value: SetFieldInput,
): Promise<void> {
  const fieldId = fields.fieldId(fieldName)

  if (value.option) {
    const category = FIELD_TO_CATEGORY[fieldName]
    if (!category) throw new Error(`No option category known for field: ${fieldName}`)
    const optionId = fields.optionId(category, value.option)
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, optionId }
    )
    return
  }

  if (value.text !== undefined) {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { text: $text }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, text: value.text }
    )
    return
  }

  if (value.date) {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { date: $date }
        }) { clientMutationId }
      }`,
      { projectId: fields.projectId, itemId, fieldId, date: value.date }
    )
    return
  }

  throw new Error("Provide one of: --option, --text, --date")
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

/**
 * Move an item to a new position in the kanban.
 * Pass afterId to place after a specific item, or omit to move to top.
 */
export async function moveItem(
  projectId: string,
  itemId: string,
  afterId?: string,
): Promise<void> {
  await gql(
    `mutation($projectId: ID!, $itemId: ID!, $afterId: ID) {
      updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }) {
        clientMutationId
      }
    }`,
    { projectId, itemId, afterId: afterId ?? null },
  )
}

/**
 * Archive an item in the project (soft delete).
 */
export async function archiveItem(projectId: string, itemId: string): Promise<void> {
  await gql(
    `mutation($projectId: ID!, $itemId: ID!) {
      archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { clientMutationId }
    }`,
    { projectId, itemId },
  )
}

/**
 * Unarchive a previously archived item.
 */
export async function unarchiveItem(projectId: string, itemId: string): Promise<void> {
  await gql(
    `mutation($projectId: ID!, $itemId: ID!) {
      unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { clientMutationId }
    }`,
    { projectId, itemId },
  )
}

/**
 * Clear (remove) a field value from an item.
 */
export async function clearFieldValue(
  projectId: string,
  itemId: string,
  fieldId: string,
): Promise<void> {
  await gql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
      clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
        clientMutationId
      }
    }`,
    { projectId, itemId, fieldId },
  )
}

import type { Row } from "./contract.js"
import { loadCounts } from "./repository.js"
import { asIso, safeJsonParse, str } from "./value.js"

export function storageMode(counts: ReturnType<typeof loadCounts>) {
  const current = counts.message_count > 0 || counts.part_count > 0
  const legacy = counts.session_message_count > 0
  if (current && legacy) return "hybrid"
  if (current) return "message-part"
  if (legacy) return "legacy-session_message"
  return "empty"
}

export function diagnostics(counts: ReturnType<typeof loadCounts>) {
  if (counts.message_count > 0 || counts.part_count > 0) return { reason: "message_part_available", unsupported: false }
  if (counts.session_message_count > 0) return { reason: "legacy_only_unsupported", unsupported: true }
  return { reason: "no_messages_persisted", unsupported: false }
}

export function parseSession(row: Row) {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    parentId: row.parent_id || null,
    slug: str(row.slug),
    title: str(row.title),
    directory: str(row.directory),
    version: str(row.version),
    shareUrl: row.share_url || null,
    agent: row.agent || null,
    model: safeJsonParse(row.model) || row.model || null,
    path: safeJsonParse(row.path) || row.path || null,
    metadata: safeJsonParse(row.metadata) || row.metadata || null,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    createdAt: asIso(row.time_created),
    updatedAt: asIso(row.time_updated),
    project: { id: str(row.project_id), name: row.project_name || null, worktree: row.project_worktree || null, vcs: row.project_vcs || null },
    ref: { sessionId: str(row.id) },
  }
}

export function summarizeSessionForIndex(row: Row) {
  const session = parseSession(row)
  return {
    id: session.id,
    projectId: session.projectId,
    parentId: session.parentId,
    slug: session.slug,
    title: session.title,
    directory: session.directory,
    agent: session.agent,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    project: session.project,
    ref: session.ref,
  }
}

import fs from "node:fs/promises"
import path from "node:path"
import { Artifact } from "@opencode/schema/artifact"
import { ProjectID } from "@opencode/schema/project-id"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import type { DatabaseMigration } from "../database/migration.js"

export const LegacyProjectsReceipt = "harpress.wordpress.legacy-projects"

type Transaction = Parameters<DatabaseMigration.Migration["up"]>[0]
type SessionLocation = { id: string; project_id: string; directory: string }

const legacyProjects = sql`
  SELECT id FROM project
  WHERE id <> ${ProjectID.global}
    AND (nullif(trim(wordpress_url), '') IS NULL OR nullif(trim(wordpress_directory), '') IS NULL)
`
const currentLegacySessions = sql`SELECT id, project_id, directory FROM session_v2 WHERE project_id IN (${legacyProjects})`
const retainedSessions = sql`SELECT id, project_id, directory FROM session_v2 WHERE project_id NOT IN (${legacyProjects})`
const artifactPrefix = "artifact:item:"
const decodeArtifact = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ info: Artifact.Info, directory: Schema.String, projectID: Schema.String })),
)

export function purgeLegacyProjects(tx: Transaction) {
  return Effect.gen(function* () {
    if (yield* tx.get(sql`SELECT key FROM kv WHERE key = ${LegacyProjectsReceipt}`)) return
    const projects = yield* tx.all<{ id: string }>(sql`${legacyProjects} ORDER BY id`)
    if (projects.length === 0) return
    const projectIDs = new Set(projects.map((project) => project.id))
    const hasV1 = yield* tx.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
    const sessions = hasV1
      ? sql`
          ${currentLegacySessions}
          UNION ALL
          SELECT id, project_id, directory FROM session
          WHERE project_id IN (${legacyProjects}) AND id NOT IN (SELECT id FROM session_v2)
        `
      : currentLegacySessions
    const sessionIDs = sql`SELECT id FROM (${sessions})`
    const removing = yield* tx.all<SessionLocation>(sql`${sessions} ORDER BY id`)
    const surviving = new Map(
      (yield* tx.all<SessionLocation>(retainedSessions)).map((session) => [session.id, session]),
    )
    const removingIDs = new Set(removing.map((session) => session.id))
    const paths = yield* tx.all<{ project_id: string; directory: string }>(sql`
      SELECT id AS project_id, worktree AS directory FROM project
      UNION SELECT id, wordpress_directory FROM project WHERE wordpress_directory IS NOT NULL
      UNION SELECT project_id, directory FROM project_directory
      UNION SELECT project_id, directory FROM worktree
      UNION
      SELECT project.id, sandbox.value FROM project, json_each(
        CASE WHEN json_valid(project.sandboxes) THEN project.sandboxes ELSE '[]' END
      ) AS sandbox WHERE sandbox.type = 'text'
      UNION SELECT project_id, directory FROM session_v2
    `)
    const knownPaths = paths.concat(removing).filter((entry) => {
      const directory = entry.directory
      return path.isAbsolute(directory) && path.resolve(directory) !== path.parse(directory).root
    })
    const retainedPaths = knownPaths.filter((entry) => !projectIDs.has(entry.project_id))
    const directories = new Map<string, Set<string>>()
    for (const entry of knownPaths) {
      if (!projectIDs.has(entry.project_id)) continue
      if (retainedPaths.some((retained) => FSUtil.overlaps(retained.directory, entry.directory))) continue
      const owned = directories.get(entry.project_id) ?? new Set<string>()
      owned.add(entry.directory)
      directories.set(entry.project_id, owned)
    }

    const artifacts = yield* tx.all<{ key: string; value: string }>(sql`
      SELECT key, value FROM kv WHERE key GLOB 'artifact:item:*'
    `)
    const ownedArtifacts: string[] = []
    for (const row of artifacts) {
      const record = Option.getOrUndefined(decodeArtifact(row.value))
      if (!record || row.key !== artifactPrefix + record.info.id) continue
      const session = record.info.sessionID
      if (!projectIDs.has(record.projectID)) {
        if (session && removingIDs.has(session)) {
          yield* tx.run(sql`UPDATE kv SET value = json_remove(value, '$.info.sessionID') WHERE key = ${row.key}`)
        }
        continue
      }
      const remaining = session ? surviving.get(session) : undefined
      if (remaining) {
        yield* tx.run(sql`
          UPDATE kv SET value = json_set(value, '$.projectID', ${remaining.project_id}, '$.directory', ${remaining.directory})
          WHERE key = ${row.key}
        `)
        continue
      }
      yield* tx.run(sql`DELETE FROM kv WHERE key = ${row.key}`)
      if (record.info.provider === "local") ownedArtifacts.push(record.info.id)
    }
    // Ref rows enumerate owners of stored media. Restrict candidates to the removed sessions' own refs.
    yield* tx.run(sql`
      DELETE FROM blob
      WHERE hash IN (SELECT hash FROM blob_ref WHERE session_id IN (${sessionIDs}))
        AND NOT EXISTS (
          SELECT 1 FROM blob_ref WHERE hash = blob.hash AND session_id NOT IN (${sessionIDs})
        )
    `)
    yield* purgeInstructionBlobs(tx, sessionIDs)
    yield* purgePluginState(tx, sessionIDs)
    yield* tx.run(sql`DELETE FROM job WHERE session_id IN (${sessionIDs})`)
    yield* tx.run(sql`DELETE FROM automation WHERE project_id IN (${legacyProjects})`)
    yield* tx.run(sql`
      DELETE FROM event_sequence
      WHERE aggregate_id IN (${legacyProjects}) OR aggregate_id IN (${sessionIDs})
    `)
    if (hasV1) yield* tx.run(sql`DELETE FROM session WHERE id IN (${sessionIDs})`)
    // Project and session foreign keys cascade to messages, inboxes, parts, permissions and directory records.
    yield* tx.run(sql`DELETE FROM project WHERE id IN (${legacyProjects})`)
    const now = Date.now()
    const receipt = {
      projects: projects.map((project) => ({
        id: project.id,
        directories: [...(directories.get(project.id) ?? [])].sort(),
      })),
      sessions: removing.map((session) => ({ id: session.id, directory: session.directory })),
    }
    yield* tx.run(sql`
      INSERT INTO kv (key, value, time_created, time_updated)
      VALUES (${LegacyProjectsReceipt}, ${JSON.stringify(receipt)}, ${now}, ${now})
    `)

    const global = yield* Global.Service
    const retainedProjects = yield* tx.all<{ id: string }>(sql`SELECT id FROM project`)
    const keptProjectIDs = new Set(retainedProjects.map((project) => project.id.toLowerCase()))
    const ownedProjectIDs = projects.map((project) => project.id).filter((id) => !keptProjectIDs.has(id.toLowerCase()))
    const deletedArtifacts = new Set(ownedArtifacts.map((id) => artifactPrefix + id))
    const keptArtifacts = new Set(
      artifacts.filter((row) => !deletedArtifacts.has(row.key)).map((row) => row.key.toLowerCase()),
    )
    const worktrees = knownPaths.map((entry) => entry.directory)
    // SQL errors occur before touching disk. If removal fails and the transaction rolls back, missing paths are
    // safe to retry.
    yield* Effect.tryPromise(async () => {
      await removeManaged(path.join(global.data, "snapshot"), ownedProjectIDs, worktrees)
      await removeManaged(path.join(global.data, "memory"), ownedProjectIDs, worktrees)
      await removeManaged(
        path.join(global.data, "artifacts"),
        ownedArtifacts.filter((id) => !keptArtifacts.has(artifactPrefix + id.toLowerCase())),
        worktrees,
      )
    })
  })
}

function purgeInstructionBlobs(tx: Transaction, sessionIDs: ReturnType<typeof sql>) {
  return tx.run(sql`
    WITH refs(owner, hash) AS (
      SELECT state.session_id, item.value FROM instruction_state AS state, json_each(state.initial_values) AS item
      UNION ALL
      SELECT state.session_id, item.value FROM instruction_state AS state, json_each(state.current_values) AS item
      UNION ALL
      SELECT event.aggregate_id, item.value
      FROM event, json_each(CASE WHEN json_valid(event.data) THEN event.data ELSE '{}' END, '$.delta') AS item
      WHERE event.type GLOB 'session.instructions.updated.*'
      UNION ALL
      SELECT event.aggregate_id, item.value
      FROM event, json_each(CASE WHEN json_valid(event.data) THEN event.data ELSE '{}' END, '$.instructions') AS item
      WHERE event.type GLOB 'session.forked.*'
    )
    DELETE FROM instruction_blob
    WHERE hash IN (SELECT hash FROM refs WHERE owner IN (${sessionIDs}))
      AND hash NOT IN (SELECT hash FROM refs WHERE hash IS NOT NULL AND owner NOT IN (${sessionIDs}))
  `)
}

function purgePluginState(tx: Transaction, sessionIDs: ReturnType<typeof sql>) {
  // Built-in plugin storage keys encode the plugin ID as UTF-16 hex before the owned key.
  const prefix = (plugin: string) =>
    `plugin:${plugin
      .split("")
      .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("")}:`
  const claude = prefix("opencode.provider.claude-agent")
  const watches = prefix("opencode.provider.opencode")
  return tx.run(sql`
    WITH sessions AS (${sessionIDs})
    DELETE FROM kv
    WHERE key IN (
      SELECT ${prefix("opencode.goal") + "session:"} || id FROM sessions
      UNION ALL SELECT ${claude + "sessions/"} || id FROM sessions
      UNION ALL SELECT ${claude + "accounts/"} || id FROM sessions
      UNION ALL SELECT ${watches + "watch-streak:"} || id FROM sessions
      UNION ALL SELECT ${watches + "watch-deleted:"} || id FROM sessions
      UNION ALL SELECT ${prefix("opencode.home-memory") + "state/"} || id FROM (${legacyProjects})
    ) OR (
      key GLOB ${claude + "sessions/*:*"}
      AND EXISTS (SELECT 1 FROM sessions WHERE instr(kv.key, ${claude + "sessions/"} || id || ':') = 1)
    )
  `)
}

async function removeManaged(root: string, ids: readonly string[], worktrees: readonly string[]) {
  if (ids.length === 0) return
  const stat = await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (!stat?.isDirectory()) return
  for (const id of ids) {
    if (!/^[a-z0-9_-]+$/i.test(id)) continue
    const directory = path.join(root, id)
    // A user can select any folder as a worktree, including a managed folder or one of its children.
    if (worktrees.some((worktree) => FSUtil.contains(directory, worktree))) continue
    await fs.rm(directory, { recursive: true, force: true })
  }
}

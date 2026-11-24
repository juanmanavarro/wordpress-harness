import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { migrations } from "@opencode/core/database/migration.gen"
import wordpressProjects from "@opencode/core/database/migration/20261124153425_wordpress-projects"
import schema from "@opencode/core/database/schema.gen"
import { purgeLegacyProjects } from "@opencode/core/project/purge-legacy"
import { Global } from "@opencode/util/global"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.merge(SqliteClient.layer({ filename: ":memory:", disableWAL: true }), tempGlobalLayer))

it.live(
  "purges old projects only once and preserves surviving owners of shared storage",
  Effect.gen(function* () {
    const global = yield* Global.Service
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.transaction(schema.up)

    const oldDir = path.join(global.data, "legacy")
    const keptDir = path.join(global.data, "wordpress")
    const sharedDir = path.join(keptDir, "shared")
    const exclusiveDir = path.join(global.data, "sandbox")
    const protectedArtifact = path.join(global.data, "artifacts", "art_worktree")
    yield* db.run(sql`
      INSERT INTO project (id, worktree, sandboxes, wordpress_url, wordpress_directory, time_created, time_updated)
      VALUES ('legacy', ${oldDir}, ${JSON.stringify([exclusiveDir, sharedDir])}, NULL, NULL, 0, 0),
        ('retained', ${keptDir}, '[]', 'https://example.com', ${keptDir}, 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO project_directory (project_id, directory, time_created)
      VALUES ('legacy', ${oldDir}, 0), ('retained', ${keptDir}, 0)
    `)
    yield* db.run(sql`
      INSERT INTO worktree (project_id, directory, time_created)
      VALUES ('legacy', ${sharedDir}, 0), ('retained', ${sharedDir}, 0), ('retained', ${protectedArtifact}, 0)
    `)
    yield* db.run(sql`
      INSERT INTO session_v2 (id, project_id, directory, slug, version, time_created, time_updated)
      VALUES ('ses_remove', 'legacy', ${sharedDir}, 'old', '1', 0, 0),
        ('ses_keep', 'retained', ${sharedDir}, 'keep', '1', 0, 0)
    `)
    for (const id of ["ses_remove", "ses_keep"]) {
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, data, time_created, time_updated)
        VALUES (${"message:" + id}, ${id}, 'assistant', 0, '{}', 0, 0)
      `)
      yield* db.run(sql`
        INSERT INTO session_part (message_id, session_id, ordinal, type, data, time_created, time_updated)
        VALUES (${"message:" + id}, ${id}, 0, 'text', '{"type":"text","text":"test"}', 0, 0)
      `)
      yield* db.run(sql`
        INSERT INTO session_inbox (id, session_id, type, payload, delivery, enqueued_seq, time_created)
        VALUES (${"inbox:" + id}, ${id}, 'user', '{}', 'steer', 0, 0)
      `)
      yield* db.run(sql`
        INSERT INTO event_sequence (aggregate_id, seq) VALUES (${id}, 0)
      `)
      yield* db.run(sql`
        INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (${"event:" + id}, ${id}, 0, 'session.created.1', '{}')
      `)
      yield* db.run(sql`
        INSERT INTO job (notification_id, id, session_id, kind, status, recovery, time_created, time_updated)
        VALUES (${"notice:" + id}, ${"job:" + id}, ${id}, 'test', 'completed', '{}', 0, 0)
      `)
    }
    yield* db.run("INSERT INTO event_sequence (aggregate_id, seq) VALUES ('legacy', 0), ('unrelated', 0)")
    yield* db.run(sql`
      INSERT INTO automation (id, project_id, session_id, directory, name, trigger, tz, action, time_created, time_updated)
      VALUES ('remove', 'legacy', 'ses_remove', ${sharedDir}, 'old', '{}', 'UTC', '{}', 0, 0),
        ('keep', 'retained', 'ses_keep', ${sharedDir}, 'keep', '{}', 'UTC', '{}', 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO blob (hash, mime, bytes, data, time_created)
      VALUES ('old', 'image/png', 1, X'01', 0), ('shared', 'image/png', 1, X'01', 0),
        ('unrelated', 'image/png', 1, X'01', 0)
    `)
    yield* db.run(sql`
      INSERT INTO blob_ref (session_id, message_id, hash, seq)
      VALUES ('ses_remove', 'message:ses_remove', 'old', 0),
        ('ses_remove', 'message:ses_remove', 'shared', 0),
        ('ses_keep', 'message:ses_keep', 'shared', 0)
    `)
    yield* db.run(sql`
      INSERT INTO instruction_blob (hash, value) VALUES ('old', '"old"'), ('shared', '"shared"'), ('unused', '"unused"')
    `)
    yield* db.run(sql`
      INSERT INTO instruction_state (session_id, epoch_start, through_seq, initial_values, current_values)
      VALUES ('ses_remove', 0, 0, '{"project/old":"old"}', '{"project/copied":"shared"}')
    `)
    yield* db.run(sql`
      INSERT INTO event (id, aggregate_id, seq, type, data)
      VALUES ('event:instruction', 'ses_keep', 1, 'session.instructions.updated.2', '{"delta":{"project/copied":"shared"}}')
    `)
    for (const [id, projectID, sessionID] of [
      ["art_removed", "legacy", "ses_remove"],
      ["art_project", "legacy", undefined],
      ["art_shared", "legacy", "ses_keep"],
      ["art_retained", "retained", undefined],
      ["art_worktree", "legacy", undefined],
    ] as const) {
      yield* db.run(sql`
        INSERT INTO kv (key, value, time_created, time_updated)
        VALUES (${"artifact:item:" + id}, ${JSON.stringify({
          projectID,
          directory: sharedDir,
          info: {
            id,
            sessionID,
            provider: "local",
            title: "fixture",
            entry: "index.html",
            url: "/",
            time: { created: 0, updated: 0 },
          },
        })}, 0, 0)
      `)
    }
    const goal = "plugin:006f00700065006e0063006f00640065002e0067006f0061006c:session:"
    yield* db.run(sql`
      INSERT INTO kv (key, value, time_created, time_updated)
      VALUES (${goal + "ses_remove"}, '{}', 0, 0), (${goal + "ses_keep"}, '{}', 0, 0)
    `)

    const files = [
      path.join(global.data, "artifacts", "art_removed", "index.html"),
      path.join(global.data, "artifacts", "art_project", "index.html"),
      path.join(global.data, "snapshot", "legacy", "md5", "HEAD"),
      path.join(global.data, "memory", "legacy", "docs", "notes.txt"),
      path.join(global.data, "artifacts", "art_shared", "index.html"),
      path.join(global.data, "artifacts", "art_retained", "index.html"),
      path.join(global.data, "artifacts", "art_unrelated", "index.html"),
      path.join(global.data, "snapshot", "retained", "md5", "HEAD"),
      path.join(global.data, "memory", "retained", "docs", "notes.txt"),
      path.join(oldDir, "user-work.txt"),
      path.join(sharedDir, "shared-work.txt"),
      path.join(protectedArtifact, "wordpress-work.txt"),
    ]
    yield* Effect.promise(() =>
      Promise.all(
        files.map(async (file) => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await Bun.write(file, "fixture")
        }),
      ),
    )

    yield* db.transaction(purgeLegacyProjects)

    expect(yield* db.all("SELECT id FROM project")).toEqual([{ id: "retained" }])
    expect(yield* db.all("SELECT id FROM session_v2")).toEqual([{ id: "ses_keep" }])
    expect(yield* db.all("SELECT session_id FROM session_message")).toEqual([{ session_id: "ses_keep" }])
    expect(yield* db.all("SELECT session_id FROM session_part")).toEqual([{ session_id: "ses_keep" }])
    expect(yield* db.all("SELECT session_id FROM session_inbox")).toEqual([{ session_id: "ses_keep" }])
    expect(yield* db.all("SELECT session_id FROM job")).toEqual([{ session_id: "ses_keep" }])
    expect(yield* db.all("SELECT id FROM automation")).toEqual([{ id: "keep" }])
    expect(yield* db.all("SELECT DISTINCT aggregate_id FROM event")).toEqual([{ aggregate_id: "ses_keep" }])
    expect(yield* db.all("SELECT aggregate_id FROM event_sequence ORDER BY aggregate_id")).toEqual([
      { aggregate_id: "ses_keep" },
      { aggregate_id: "unrelated" },
    ])
    expect(yield* db.all("SELECT hash FROM blob ORDER BY hash")).toEqual([{ hash: "shared" }, { hash: "unrelated" }])
    expect(yield* db.all("SELECT hash FROM instruction_blob ORDER BY hash")).toEqual([
      { hash: "shared" },
      { hash: "unused" },
    ])
    expect(yield* db.all("SELECT session_id FROM instruction_state")).toEqual([])
    expect(yield* db.all("SELECT key FROM kv WHERE key LIKE 'artifact:item:%' ORDER BY key")).toEqual([
      { key: "artifact:item:art_retained" },
      { key: "artifact:item:art_shared" },
    ])
    expect(
      yield* db.get(sql`
      SELECT json_extract(value, '$.projectID') AS project, json_extract(value, '$.directory') AS directory
      FROM kv WHERE key = 'artifact:item:art_shared'
    `),
    ).toEqual({ project: "retained", directory: sharedDir })
    expect(yield* db.all("SELECT key FROM kv WHERE key GLOB 'plugin:*'")).toEqual([{ key: goal + "ses_keep" }])
    expect(yield* Effect.promise(() => Promise.all(files.map((file) => Bun.file(file).exists())))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ])

    yield* db.run(sql`
      INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
      VALUES ('technical', ${oldDir}, '[]', 0, 0)
    `)
    yield* db.transaction(purgeLegacyProjects)
    expect(yield* db.all("SELECT id FROM project ORDER BY id")).toEqual([{ id: "retained" }, { id: "technical" }])
    const receipt = yield* db.get<{ value: string }>(
      "SELECT value FROM kv WHERE key = 'harpress.wordpress.legacy-projects'",
    )
    expect(JSON.parse(receipt?.value ?? "null")).toEqual({
      projects: [{ id: "legacy", directories: [oldDir, exclusiveDir].sort() }],
      sessions: [{ id: "ses_remove", directory: sharedDir }],
    })
    expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([])
  }),
)

it.live(
  "upgrades a V1 profile and removes its legacy transcript tables' owned rows",
  Effect.gen(function* () {
    const global = yield* Global.Service
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* DatabaseMigration.applyOnly(
      db,
      migrations.filter((migration) => migration.id < wordpressProjects.id),
    )
    const directory = path.join(global.data, "old-project")
    yield* db.run(sql`
      INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
      VALUES ('old', ${directory}, '[]', 0, 0), ('global', ${path.parse(global.data).root}, '[]', 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, directory, slug, title, version, time_created, time_updated)
      VALUES ('ses_unimported', 'old', ${directory}, 'old', 'Legacy', '1', 0, 0),
        ('ses_global_v1', 'global', '', 'global', 'Standalone V1', '1', 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO session_v2 (id, project_id, directory, slug, title, version, time_created, time_updated)
      VALUES ('ses_global_current', 'global', '', 'global', 'Standalone current', '2', 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO message (id, session_id, data, time_created, time_updated)
      VALUES ('msg_old', 'ses_unimported', '{}', 0, 0), ('msg_standalone', 'ses_global_v1', '{}', 0, 0)
    `)
    yield* db.run(sql`
      INSERT INTO part (id, message_id, session_id, data, time_created, time_updated)
      VALUES ('part_old', 'msg_old', 'ses_unimported', '{}', 0, 0)
    `)

    yield* DatabaseMigration.apply(db)

    expect(yield* db.all("SELECT id FROM project")).toEqual([{ id: "global" }])
    expect(yield* db.all("SELECT id FROM session_v2")).toEqual([{ id: "ses_global_current" }])
    expect(yield* db.all("SELECT id FROM session")).toEqual([{ id: "ses_global_v1" }])
    expect(yield* db.all("SELECT id FROM message")).toEqual([{ id: "msg_standalone" }])
    expect(yield* db.all("SELECT id FROM part")).toEqual([])
    const receipt = yield* db.get<{ value: string }>(
      "SELECT value FROM kv WHERE key = 'harpress.wordpress.legacy-projects'",
    )
    expect(JSON.parse(receipt?.value ?? "null")).toEqual({
      projects: [{ id: "old", directories: [directory] }],
      sessions: [{ id: "ses_unimported", directory }],
    })
    expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([])
  }),
)

import { expect, test } from "bun:test"
import { openDatabase } from "./database"
import { cleanupLegacyProjectStorage } from "./project-cleanup"

test.each([
  { scope: "local", server: "sidecar", storage: "opencode.workspace.L29sZA.1299wbu.dat" },
  {
    scope: "https://test.invalid",
    server: "https://test.invalid",
    storage: "opencode.workspace.https---test.msiyty.dat",
  },
])("cleans SQLite state and exclusive draft bytes once for $server", (input) => {
  const database = openDatabase(":memory:")
  const db = database.db.$client
  const tab = { type: "draft", draftID: "owned-draft", server: input.server, directory: "/old" }
  const keep = { ...tab, draftID: "shared-draft", directory: "/elsewhere" }
  const tabs = JSON.stringify([tab, keep])
  const insertState = db.prepare("INSERT INTO state VALUES (?, ?, ?, 0)")
  const window = "opencode.window.any.dat"
  const key = `${input.storage}:session:ses_a:prompt`
  const history = "opencode.global.dat:prompt-history"
  const insertDocument = db.prepare("INSERT INTO document VALUES (?, ?)")

  const content = JSON.stringify({
    prompt: [{ blob: { id: "image" } }, { blob: { ids: ["chunk", "shared"] } }],
  })

  try {
    insertState.run(window, "tabs", tabs)
    insertState.run(input.storage, "session:ses_a:comments", "{}")
    insertState.run(input.storage, "session:ses_a2:comments", "{}")
    insertDocument.run(key, content)
    insertDocument.run(history, JSON.stringify({ entries: [{ blob: { id: "shared" } }] }))
    db.exec(
      "INSERT INTO blob (id, data) VALUES ('image', x'01'), ('chunk', x'02'), ('shared', x'03'), ('orphan', x'04')",
    )

    const receipt = {
      ...input,
      projects: [{ id: "retired", directories: ["/old"] }],
      sessions: [{ id: "ses_a", directory: "/old" }],
    }

    expect(cleanupLegacyProjectStorage(database.db, receipt).draftIDs).toEqual(["owned-draft"])
    expect(db.prepare("SELECT value FROM state WHERE name = ? AND key = 'tabs'").get(window)?.value).toBe(
      JSON.stringify([keep]),
    )
    expect(db.prepare("SELECT key FROM state WHERE name = ? ORDER BY key").all(input.storage)).toEqual([
      { key: "session:ses_a2:comments" },
    ])
    expect(db.prepare("SELECT key FROM document ORDER BY key").all()).toEqual([{ key: history }])
    expect(db.prepare("SELECT id FROM blob ORDER BY id").all()).toEqual([{ id: "orphan" }, { id: "shared" }])

    const recreated = { ...tab, draftID: "wordpress-draft" }
    db.prepare("UPDATE state SET value = ? WHERE name = ? AND key = 'tabs'").run(JSON.stringify([recreated]), window)
    insertState.run(input.storage, "workspace:prompt", "{}")
    expect(cleanupLegacyProjectStorage(database.db, receipt)).toEqual({ draftIDs: ["owned-draft"], changes: [] })
    expect(db.prepare("SELECT value FROM state WHERE name = ? AND key = 'tabs'").get(window)?.value).toBe(
      JSON.stringify([recreated]),
    )
    expect(
      db.prepare("SELECT key FROM state WHERE name = ? AND key = 'workspace:prompt'").get(input.storage),
    ).toBeDefined()
  } finally {
    database.close()
  }
})

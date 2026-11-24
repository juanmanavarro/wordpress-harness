import {
  legacyProjectCleanupDraftIDs,
  legacyProjectCleanupMarker,
  planLegacyProjectCleanup,
  type LegacyProjectCleanup,
} from "@opencode/app/project-cleanup"
import { and, eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import { removeOwnedDrafts } from "./drafts"
import { state } from "./schema"

export function cleanupLegacyProjectStorage(db: Database, input: LegacyProjectCleanup) {
  return db.transaction(() => {
    const marker = { name: "opencode.global.dat", key: legacyProjectCleanupMarker(input) }

    const applied = db
      .select({ value: state.value })
      .from(state)
      .where(and(eq(state.name, marker.name), eq(state.key, marker.key)))
      .get()

    if (applied) return { draftIDs: legacyProjectCleanupDraftIDs(applied.value), changes: [] }

    const knownWindows = db
      .select()
      .from(state)
      .where(sql`${state.name} GLOB 'opencode.window.*.dat' AND ${state.key} IN ('tabs', 'tabs.closed')`)
      .all()

    const plan = planLegacyProjectCleanup(input, knownWindows)

    const removed = db
      .select({ name: state.name, key: state.key })
      .from(state)
      .all()
      .filter((row) => plan.owns(row.name, row.key))
      .map((row) => ({ ...row, value: null }))

    const changes = [...plan.updates, ...removed]
    const updatedAt = Date.now()

    removeOwnedDrafts(db, plan.ownsDocument)

    for (const row of changes) {
      const target = and(eq(state.name, row.name), eq(state.key, row.key))

      if (row.value === null) db.delete(state).where(target).run()
      else db.update(state).set({ value: row.value, updated_at: updatedAt }).where(target).run()
    }

    db.insert(state)
      .values({ ...marker, value: JSON.stringify(plan.draftIDs), updated_at: updatedAt })
      .run()

    return { draftIDs: plan.draftIDs, changes }
  })
}

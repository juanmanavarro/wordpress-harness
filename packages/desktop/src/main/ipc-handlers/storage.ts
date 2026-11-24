import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { StorageRpcs } from "../../shared/ipc-rpc"
import { StorageChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { DesktopStorage } from "../storage"
import { cleanupLegacyProjectStorage } from "../storage/project-cleanup"

export const storageHandlers = StorageRpcs.toLayer(
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service
    const handoff = yield* IpcPortHandoff

    return StorageRpcs.of({
      StorageItems: ({ name }) => Effect.sync(() => storage.state.items(name)),
      StorageUpdate: ({ name, insert, remove }, context) =>
        Effect.sync(() => {
          const revision = storage.state.update(name, insert, remove)
          // Other windows hold their own copy of this namespace; tell them what moved. A reloading
          // window's new document is another copy too: an unloading document's flush reaches it.
          const event = new StorageChanged({ name, insert, remove, revision })

          for (const win of BrowserWindow.getAllWindows()) {
            if (!handoff.isCurrentClient(win.webContents, context.client.id)) emitIpcEvent(win.webContents, event)
          }

          return revision
        }),
      StorageClear: ({ name }) => Effect.sync(() => storage.state.clear(name)),
      DraftsGet: ({ key }) => Effect.sync(() => storage.drafts.get(key)),
      DraftsSet: ({ key, value, strict }) => Effect.sync(() => storage.drafts.set(key, value, strict)),
      DraftsDelete: ({ key }) => Effect.sync(() => void storage.drafts.set(key, null)),
      DraftsPutBlob: ({ data }) => Effect.sync(() => storage.drafts.putBlob(data)),
      DraftsGetBlob: ({ id }) => Effect.sync(() => storage.drafts.getBlob(id)),
      StorageCleanupLegacyProjects: (input) =>
        Effect.sync(() => {
          storage.flush()
          const result = cleanupLegacyProjectStorage(storage.db, input)
          const changed = new Map<string, { insert: Record<string, string>; remove: string[] }>()

          for (const row of result.changes) {
            const namespace = changed.get(row.name) ?? { insert: {}, remove: [] }

            if (row.value === null) namespace.remove.push(row.key)
            else namespace.insert[row.key] = row.value
            changed.set(row.name, namespace)
          }

          for (const [name, changes] of changed) {
            const revision = storage.state.update(name, {}, [])
            const event = new StorageChanged({ name, ...changes, revision })

            for (const win of BrowserWindow.getAllWindows()) emitIpcEvent(win.webContents, event)
          }

          return result.draftIDs
        }),
    })
  }),
)

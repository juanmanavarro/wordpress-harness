import { base64Encode } from "@opencode/util/encode"
import { comparablePath, sameDirectory } from "@opencode/util/path"
import { Option, Schema } from "effect"
import { ServerScope } from "../server/scope"
import { draftStorage, serverWorkspaceStorage, workspaceStorageAliases } from "./storage-keys"

export const LegacyProjectCleanupInput = Schema.Struct({
  scope: Schema.String,
  server: Schema.String,
  projects: Schema.Array(Schema.Struct({ id: Schema.String, directories: Schema.Array(Schema.String) })),
  sessions: Schema.Array(Schema.Struct({ id: Schema.String, directory: Schema.String })),
})

export type LegacyProjectCleanup = typeof LegacyProjectCleanupInput.Type

export type LegacyProjectStorageRow = { name: string; key: string; value: string }

const decodeTabs = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)))

const decodeMarker = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))

const isDraftTab = Schema.is(
  Schema.Struct({
    type: Schema.Literal("draft"),
    server: Schema.String,
    directory: Schema.String,
    draftID: Schema.String,
  }),
)

const isSessionTab = Schema.is(
  Schema.Struct({ type: Schema.Literal("session"), server: Schema.String, sessionId: Schema.String }),
)

const isClosed = Schema.is(Schema.Struct({ tab: Schema.Unknown }))

export function legacyProjectCleanupMarker(input: LegacyProjectCleanup) {
  return `wordpress.legacy-projects.v1:${input.scope}`
}

export function legacyProjectCleanupDraftIDs(value: string) {
  return Option.getOrElse(decodeMarker(value), () => [])
}

export function planLegacyProjectCleanup(input: LegacyProjectCleanup, rows: readonly LegacyProjectStorageRow[]) {
  const directories = input.projects.flatMap((project) => project.directories).filter(Boolean)
  const sessions = new Set(input.sessions.map((session) => session.id))
  const namespaces = new Map<string, Set<string>>()
  const legacy = new Set<string>()

  const addDirectory = (directory: string, sessionID?: string) => {
    const comparable = comparablePath(directory)
    const paths = new Set([directory, comparable])
    const prefix = sessionID ? `session:${sessionID}:` : "workspace:"

    if (/^[a-z]:\//i.test(comparable) || comparable.startsWith("//")) paths.add(comparable.replaceAll("/", "\\"))

    for (const path of paths) {
      const encoded = base64Encode(path)

      if (input.scope === ServerScope.local) {
        legacy.add(`${encoded}/prompt${sessionID ? "/" + sessionID : ""}.v2`)
      }

      for (const dir of [path, encoded]) {
        const names = [serverWorkspaceStorage(input.scope, dir)]

        if (input.scope === ServerScope.local) names.push(...workspaceStorageAliases(dir))

        for (const name of names) {
          const prefixes = namespaces.get(name) ?? new Set<string>()
          prefixes.add(prefix)
          namespaces.set(name, prefixes)
        }
      }
    }
  }

  for (const directory of directories) addDirectory(directory)

  for (const session of input.sessions) {
    if (session.directory) addDirectory(session.directory, session.id)
  }

  const windowRows = rows.flatMap((row) => readWindowTabs(row) ?? [])
  const draftIDs = new Set<string>()
  const retainedDraftIDs = new Set<string>()

  for (const window of windowRows) {
    if (window.row.key !== "tabs") continue

    for (const tab of window.tabs) {
      if (!isDraftTab(tab)) continue

      const owned =
        tab.server === input.server && directories.some((directory) => sameDirectory(directory, tab.directory))

      if (owned) draftIDs.add(tab.draftID)
      else retainedDraftIDs.add(tab.draftID)
    }
  }

  for (const id of retainedDraftIDs) draftIDs.delete(id)

  const rewrite = (window: NonNullable<ReturnType<typeof readWindowTabs>>) => {
    const remaining = window.tabs.filter((entry) => {
      const tab = window.row.key === "tabs.closed" && isClosed(entry) ? entry.tab : entry

      if (isDraftTab(tab)) return tab.server !== input.server || !draftIDs.has(tab.draftID)

      if (isSessionTab(tab)) return tab.server !== input.server || !sessions.has(tab.sessionId)

      return true
    })

    if (remaining.length !== window.tabs.length) return { ...window.row, value: JSON.stringify(remaining) }
  }

  const updates = windowRows.flatMap((window) => rewrite(window) ?? [])
  const draftNamespaces = new Set([...draftIDs].map(draftStorage))

  const owns = (name: string, key: string) =>
    (name === "default.dat" && legacy.has(key)) ||
    (draftNamespaces.has(name) && key.startsWith("draft:")) ||
    [...(namespaces.get(name) ?? [])].some((prefix) => key.startsWith(prefix))

  return {
    draftIDs: [...draftIDs],
    updates,
    owns,
    rewriteTabs(row: LegacyProjectStorageRow) {
      const window = readWindowTabs(row)

      return window && rewrite(window)
    },
    ownsDocument(document: string) {
      const separator = document.indexOf(":")

      return separator !== -1 && owns(document.slice(0, separator), document.slice(separator + 1))
    },
  }
}

function readWindowTabs(row: LegacyProjectStorageRow) {
  if (!/^opencode\.window\.[a-zA-Z0-9._-]+\.dat$/.test(row.name)) return

  if (row.key !== "tabs" && row.key !== "tabs.closed") return
  const decoded = decodeTabs(row.value)

  if (Option.isSome(decoded)) return { row, tabs: decoded.value }
}

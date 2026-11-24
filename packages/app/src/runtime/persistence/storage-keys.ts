import { checksum } from "@opencode/util/encode"
import { pathKey } from "../../workspaces/path-key"
import { ServerScope } from "../server/scope"

function workspaceStorage(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(dir) ?? "0"

  return `opencode.workspace.${head}.${sum}.dat`
}

export function draftStorage(draftID: string) {
  const head = (draftID.slice(0, 12) || "draft").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(draftID) ?? "0"

  return `opencode.draft.${head}.${sum}.dat`
}

export function serverWorkspaceStorage(scope: string, dir: string) {
  const key = pathKey(dir)

  if (scope === ServerScope.local) return workspaceStorage(key)

  if (scope.includes("\0") || key.includes("\0")) throw new Error("Workspace storage key cannot contain null bytes")

  return workspaceStorage(`${scope}\0${key}`)
}

export function workspaceStorageAliases(dir: string) {
  const storage = serverWorkspaceStorage(ServerScope.local, dir)
  const result = new Set<string>()
  const raw = workspaceStorage(dir)

  if (raw !== storage) result.add(raw)

  const key = pathKey(dir)
  const drive = key.length >= 3 && key[1] === ":" && key[2] === "/"

  if (drive) {
    const backslash = workspaceStorage(key.replaceAll("/", "\\"))

    if (backslash !== storage) result.add(backslash)
  }

  return [...result]
}

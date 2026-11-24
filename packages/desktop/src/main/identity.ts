import path from "node:path"

export type Channel = "local" | "dev" | "beta" | "prod"

const appNames: Record<Channel, string> = {
  local: "Harpress Dev",
  dev: "Harpress Dev",
  beta: "Harpress Beta",
  prod: "Harpress",
}

const appIDs: Record<Channel, string> = {
  local: "io.github.juanmanavarro.harpress.dev",
  dev: "io.github.juanmanavarro.harpress.dev",
  beta: "io.github.juanmanavarro.harpress.beta",
  prod: "io.github.juanmanavarro.harpress",
}

// Unpackaged dev runs keep the dev profile directory (`appID`), but use a separate Windows
// AppUserModelID: Electron writes a Start Menu `Electron.lnk` with the active AUMID on the first
// toast, which would otherwise shadow the installed Harpress Dev shortcut and route its toast
// clicks to bare `electron.exe`.
const LOCAL_APP_USER_MODEL_ID = "io.github.juanmanavarro.harpress.local"

export function resolveIdentity(channel: Channel, packaged: boolean) {
  return {
    appName: packaged ? appNames[channel] : "Harpress Dev",
    appID: packaged ? appIDs[channel] : "io.github.juanmanavarro.harpress.dev",
    appUserModelID: packaged ? appIDs[channel] : LOCAL_APP_USER_MODEL_ID,
  }
}

export function isCollidingDevShortcut(
  shortcut: { readonly appUserModelId?: string; readonly target: string },
  appUserModelID: string,
  execPath: string,
) {
  if (!shortcut.appUserModelId) return false

  if (shortcut.appUserModelId.toLowerCase() !== appUserModelID.toLowerCase()) return false

  return path.win32.normalize(shortcut.target).toLowerCase() !== path.win32.normalize(execPath).toLowerCase()
}

import { expect, test } from "bun:test"
import { isCollidingDevShortcut, resolveIdentity } from "./identity"

test.each([
  {
    channel: "dev",
    packaged: true,
    appName: "Harpress Dev",
    appID: "io.github.juanmanavarro.harpress.dev",
    appUserModelID: "io.github.juanmanavarro.harpress.dev",
  },
  {
    channel: "beta",
    packaged: true,
    appName: "Harpress Beta",
    appID: "io.github.juanmanavarro.harpress.beta",
    appUserModelID: "io.github.juanmanavarro.harpress.beta",
  },
  {
    channel: "prod",
    packaged: true,
    appName: "Harpress",
    appID: "io.github.juanmanavarro.harpress",
    appUserModelID: "io.github.juanmanavarro.harpress",
  },
  {
    channel: "local",
    packaged: false,
    appName: "Harpress Dev",
    appID: "io.github.juanmanavarro.harpress.dev",
    appUserModelID: "io.github.juanmanavarro.harpress.local",
  },
  {
    channel: "dev",
    packaged: false,
    appName: "Harpress Dev",
    appID: "io.github.juanmanavarro.harpress.dev",
    appUserModelID: "io.github.juanmanavarro.harpress.local",
  },
] as const)(
  "identity for $channel (packaged=$packaged) isolates unpackaged AUMID from installed channels",
  ({ channel, packaged, appName, appID, appUserModelID }) => {
    expect(resolveIdentity(channel, packaged)).toEqual({ appName, appID, appUserModelID })
  },
)

const installedExe = "C:\\Users\\user\\AppData\\Local\\Programs\\io.github.juanmanavarro.harpress.dev\\Harpress Dev.exe"

const devElectron = "D:\\repo\\node_modules\\electron\\dist\\electron.exe"

test.each([
  {
    name: "unpackaged Electron.lnk claiming the installed dev AUMID",
    shortcut: { appUserModelId: "io.github.juanmanavarro.harpress.dev", target: devElectron },
    expected: true,
  },
  {
    name: "case-insensitive AUMID match",
    shortcut: { appUserModelId: "IO.GITHUB.JUANMANAVARRO.HARPRESS.DEV", target: devElectron },
    expected: true,
  },
  {
    name: "unpackaged Electron.lnk with the isolated local AUMID",
    shortcut: { appUserModelId: "io.github.juanmanavarro.harpress.local", target: devElectron },
    expected: false,
  },
  {
    name: "unrelated app shortcut",
    shortcut: { appUserModelId: "com.example.other", target: devElectron },
    expected: false,
  },
  {
    name: "shortcut without an AUMID",
    shortcut: { target: devElectron },
    expected: false,
  },
  {
    name: "shortcut targeting the installed executable itself",
    shortcut: { appUserModelId: "io.github.juanmanavarro.harpress.dev", target: installedExe.toLowerCase() },
    expected: false,
  },
])("isCollidingDevShortcut returns $expected for $name", ({ shortcut, expected }) => {
  expect(isCollidingDevShortcut(shortcut, "io.github.juanmanavarro.harpress.dev", installedExe)).toBe(expected)
})

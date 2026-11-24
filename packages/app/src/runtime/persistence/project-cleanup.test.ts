import { expect, test } from "bun:test"
import { base64Encode } from "@opencode/util/encode"
import { ServerKey } from "../server/persistence"
import { ServerScope } from "../server/scope"
import { cleanupLegacyBrowserStorage, Persist } from "./storage"
import { planLegacyProjectCleanup } from "./project-cleanup"

test("matches stored ownership by server, workspace, and exact session or draft ID", () => {
  const scope = ServerScope.local
  const directory = "/home/test/old project"
  const shared = "/home/test/shared project"
  const remote = ServerScope.fromServerKey(ServerKey.make("https://remote.test"))
  const tab = { type: "draft", draftID: "draft-a", server: "sidecar", directory }
  const remoteTab = { ...tab, draftID: "draft-b", server: remote }
  const sharedTab = { ...tab, draftID: "draft-c", directory: shared }
  const removedSession = { type: "session", sessionId: "ses_a", server: "sidecar" }
  const keptSession = { ...removedSession, sessionId: "ses_a2" }
  const window = "opencode.window.window-a.dat"

  const plan = planLegacyProjectCleanup(
    {
      scope,
      server: "sidecar",
      projects: [{ id: "old", directories: [directory] }],
      sessions: [{ id: "ses_a", directory: shared }],
    },
    [
      { name: window, key: "tabs", value: JSON.stringify([tab, remoteTab, sharedTab, removedSession, keptSession]) },
      { name: window, key: "tabs.closed", value: JSON.stringify([{ tab: removedSession }, { tab: keptSession }]) },
    ],
  )

  const storageOwned = (target: ReturnType<typeof Persist.session>) => plan.owns(target.storage!, target.key)

  const draftOwned = (target: ReturnType<typeof Persist.session>) =>
    plan.ownsDocument(`${target.storage}:${target.key}`)

  expect(plan.draftIDs).toEqual(["draft-a"])
  expect(JSON.parse(plan.updates.find((row) => row.key === "tabs")?.value ?? "")).toEqual([
    remoteTab,
    sharedTab,
    keptSession,
  ])
  expect(JSON.parse(plan.updates.find((row) => row.key === "tabs.closed")?.value ?? "")).toEqual([{ tab: keptSession }])
  expect(storageOwned(Persist.workspace(directory, "project"))).toBe(true)
  expect(storageOwned(Persist.session(base64Encode(shared), "ses_a", "comments"))).toBe(true)
  expect(storageOwned(Persist.session(base64Encode(shared), "ses_a2", "comments"))).toBe(false)
  expect(storageOwned(Persist.workspace(shared, "project"))).toBe(false)
  expect(storageOwned(Persist.session(directory, "ses_a2", "comments"))).toBe(false)
  expect(storageOwned(Persist.draft("draft-a", "file-view"))).toBe(true)
  expect(draftOwned(Persist.draft("draft-c", "prompt"))).toBe(false)
  expect(draftOwned(Persist.workspace(base64Encode(directory), "prompt"))).toBe(true)
  expect(draftOwned(Persist.serverSession(remote, base64Encode(shared), "ses_a", "prompt"))).toBe(false)
  expect(draftOwned(Persist.global("prompt-history"))).toBe(false)
  expect(plan.owns("default.dat", `${base64Encode(shared)}/prompt/ses_a.v2`)).toBe(true)
  expect(plan.owns("default.dat", `${base64Encode(shared)}/prompt/ses_a2.v2`)).toBe(false)
})

test("recognizes legacy drafts written with either Windows directory separator", () => {
  const plan = planLegacyProjectCleanup(
    {
      scope: ServerScope.local,
      server: "sidecar",
      projects: [{ id: "old", directories: ["C:/old"] }],
      sessions: [{ id: "ses_old", directory: "C:/old" }],
    },
    [],
  )

  const old = base64Encode("C:\\old")

  expect(plan.owns("default.dat", `${old}/prompt.v2`)).toBe(true)
  expect(plan.owns("default.dat", `${old}/prompt/ses_old.v2`)).toBe(true)
  expect(plan.owns("default.dat", `${old}/prompt/ses_other.v2`)).toBe(false)
})

test("cleans browser state after deleting the owned documents and applies that receipt once", async () => {
  localStorage.clear()

  const input = {
    scope: ServerScope.local,
    server: "http://localhost",
    projects: [{ id: "old", directories: ["/old"] }],
    sessions: [],
  }

  const target = Persist.workspace("/old", "project")
  const workspace = `${target.storage}:${target.key}`
  const document = Persist.workspace(base64Encode("/old"), "prompt")
  const prompt = `${document.storage}:${document.key}`
  const unrelated = "opencode.global.dat:prompt-history"
  const storedDocuments = new Set([prompt, unrelated])
  const window = "opencode.window.browser.dat:tabs"
  const tab = { type: "draft", draftID: "legacy-draft", server: input.server, directory: "/old" }
  const newTab = { ...tab, draftID: "new-draft", directory: "/retained" }

  localStorage.setItem(workspace, "{}")
  localStorage.setItem(unrelated, "{}")
  localStorage.setItem(window, JSON.stringify([tab]))

  const applied = await cleanupLegacyBrowserStorage(input, async (owns) => {
    expect(localStorage.getItem(workspace)).toBe("{}")
    localStorage.setItem(window, JSON.stringify([tab, newTab]))

    for (const key of storedDocuments) {
      if (owns(key)) storedDocuments.delete(key)
    }
  })

  expect(applied).toEqual(["legacy-draft"])
  expect(storedDocuments).toEqual(new Set([unrelated]))
  expect(localStorage.getItem(workspace)).toBeNull()
  expect(localStorage.getItem(unrelated)).toBe("{}")
  expect(localStorage.getItem(window)).toBe(JSON.stringify([newTab]))

  localStorage.setItem(workspace, '{"name":"WordPress"}')
  await expect(cleanupLegacyBrowserStorage(input, () => Promise.reject(new Error("Already applied")))).resolves.toEqual(
    ["legacy-draft"],
  )
  expect(localStorage.getItem(workspace)).toBe('{"name":"WordPress"}')
})

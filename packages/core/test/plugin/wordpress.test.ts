import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { WordPressPlugin } from "@opencode/core/plugin/wordpress"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { ProjectWordPress } from "@opencode/core/project/wordpress"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { FetchHttpClient } from "effect/http"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"
import { host } from "./host"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Form.node,
      Location.node,
      Agent.node,
      Skill.node,
      Tool.node,
      Permission.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Config.node.replace(Config.testLayer()),
      Image.node.replace(imagePassthrough),
      Flag.node.replace(Flag.testLayer()),
    ],
  ),
)

const site = "https://editorial.example.test"
const otherSite = "https://other.example.test"
const otherProject = Project.ID.make("project-other-wordpress")
const sessionID = Session.ID.make("ses_wordpress_test")
const updateTool = "wordpress_update_content"
const patch = { kind: "posts", id: 42, patch: { title: "New title" } }
const post = {
  id: 42,
  slug: "contact",
  status: "publish",
  title: { raw: "Contact", rendered: "Contact" },
  content: { raw: "<!-- wp:paragraph --><p>Hours</p><!-- /wp:paragraph -->", rendered: "<p>Hours</p>" },
  excerpt: { raw: "Summary", rendered: "<p>Summary</p>" },
}

const setup = Effect.fnUntraced(function* (flag: string) {
  const location = yield* Location.Service
  const database = yield* Database.Service
  const agents = yield* Agent.Service
  const skills = yield* Skill.Service
  const registry = yield* Tool.Service
  const forms = yield* Form.Service
  const bus = yield* Bus.Service
  const projectID = location.project.id
  const writes: { host: string; body: unknown }[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      expect([site, otherSite]).toContain(url.origin)
      if (init?.method === "HEAD") return new Response(null)
      if (url.pathname === "/wp-json/wp/v2/users/me") return Response.json({ id: 1, username: "editor" })
      expect(url.pathname).toBe("/wp-json/wp/v2/posts/42")
      if (init?.method === "POST") writes.push({ host: url.origin, body: JSON.parse(String(init.body)) })
      const title = writes.some((write) => write.host === url.origin) ? "New title" : "Contact"
      return Response.json({ ...post, link: `${url.origin}/contact`, title: { raw: title, rendered: title } })
    },
    { preconnect: fetch.preconnect },
  )

  yield* database.db
    .insert(ProjectTable)
    .values([
      { id: projectID, worktree: location.directory, wordpress_url: site, sandboxes: [] },
      {
        id: otherProject,
        worktree: AbsolutePath.make(`${location.directory}/other`),
        wordpress_url: otherSite,
        sandboxes: [],
      },
    ])
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "wordpress",
      directory: location.directory,
      title: "WordPress",
      version: "test",
      agent: toolIdentity.agent,
    })
    .run()
  // Even an explicit allow for the action must wait for a human confirmation.
  yield* agents.transform((editor) =>
    editor.update(toolIdentity.agent, (agent) =>
      agent.permissions.push({ action: updateTool, resource: "*", effect: "allow" }),
    ),
  )
  const wordpress = yield* ProjectWordPress.make.pipe(Effect.provideService(FetchHttpClient.Fetch, fetcher))
  const credentials = { username: "editor", applicationPassword: "test application password" }
  yield* wordpress.connect(projectID, { url: site, ...credentials })
  yield* wordpress.connect(otherProject, { url: otherSite, ...credentials })
  yield* registerToolPlugin(WordPressPlugin, { skill: { ...host().skill, transform: skills.transform } }).pipe(
    Effect.provide(Flag.testLayer([], { overrides: flag })),
    Effect.provideService(FetchHttpClient.Fetch, fetcher),
  )

  const execute = (name: string, input: unknown, id: string, direct = true) =>
    executeTool(
      registry,
      { sessionID, ...toolIdentity, call: { type: "tool-call", id, name, input } },
      direct ? { tools: { direct: new Set([name]) } } : undefined,
    )

  const awaiting = Effect.fnUntraced(function* (run: ReturnType<typeof execute>) {
    const created = yield* Deferred.make<Form.Info>()
    const unsubscribe = yield* bus.listen((event) =>
      event.type === Form.Event.Created.type
        ? Deferred.succeed(created, (event.data as { readonly form: Form.Info }).form).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* run.pipe(Effect.forkScoped)
    const form = yield* Deferred.await(created).pipe(Effect.timeout("2 seconds"))
    return { form, fiber }
  })
  return { registry, forms, bus, writes, execute, awaiting, projectID, database, wordpress }
})

it.live("keeps the published-page tools available with the content API flag off", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("-wordpress_content_api")
    const names = (yield* fixture.registry.list()).map((tool) => tool.id)
    expect(names).toContain("wordpress_list_pages")
    expect(names).toContain("wordpress_read_page")
    expect(names).not.toContain(updateTool)
  }),
)

it.live("waits for confirmation on each save and only updates the connected project", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("wordpress_content_api")
    const snapshot = yield* fixture.registry.snapshot()
    expect(snapshot.codeModeCatalog && codeModeListings(snapshot.codeModeCatalog).map((tool) => tool.path)).toContain(
      "wordpress.update_content",
    )
    expect(yield* fixture.execute("wordpress_get_content", { kind: "posts", id: 42 }, "read")).toMatchObject({
      status: "completed",
      output: { site, result: { title: "Contact", content: "<p>Hours</p>" } },
    })

    const rejected = yield* fixture.awaiting(fixture.execute(updateTool, patch, "reject"))
    expect(rejected.form.fields[0].description).toContain(site)
    expect(rejected.form.fields[0].description).toContain("title")
    expect(fixture.writes).toEqual([])
    yield* fixture.forms.reply({ id: rejected.form.id, answer: { decision: "cancel" } })
    expect(yield* Fiber.join(rejected.fiber)).toMatchObject({ status: "error" })
    expect(fixture.writes).toEqual([])

    const approved = yield* fixture.awaiting(fixture.execute(updateTool, patch, "approve"))
    yield* fixture.forms.reply({ id: approved.form.id, answer: { decision: "save" } })
    const saved = yield* Fiber.join(approved.fiber)
    expect(saved).toMatchObject({
      status: "completed",
      output: { site, result: { title: "New title", status: "publish" } },
    })
    expect(saved.output).not.toHaveProperty("result.content")
    expect(fixture.writes).toEqual([{ host: site, body: { title: "New title" } }])
    expect(yield* fixture.execute("wordpress_get_content", { kind: "posts", id: 42 }, "verify")).toMatchObject({
      output: { site, result: { title: "New title", status: "publish", content: "<p>Hours</p>" } },
    })

    const code = `return await tools.wordpress.update_content(${JSON.stringify(patch)})`
    const again = yield* fixture.awaiting(fixture.execute("execute", { code }, "code-mode", false))
    expect(fixture.writes).toHaveLength(1)
    yield* fixture.forms.reply({ id: again.form.id, answer: { decision: "cancel" } })
    yield* Fiber.join(again.fiber)
    expect(fixture.writes).toHaveLength(1)
  }),
)

for (const change of ["disconnect", "change site"] as const) {
  it.live(`invalidates an outstanding edit approval after ${change}`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup("wordpress_content_api")
      const pending = yield* fixture.awaiting(fixture.execute(updateTool, patch, "changed"))
      yield* fixture.wordpress.disconnect(fixture.projectID)
      if (change === "change site") {
        yield* fixture.database.db
          .update(ProjectTable)
          .set({ wordpress_url: otherSite })
          .where(eq(ProjectTable.id, fixture.projectID))
          .run()
        yield* fixture.wordpress.connect(fixture.projectID, {
          url: otherSite,
          username: "editor",
          applicationPassword: "other application password",
        })
      }
      yield* fixture.forms.reply({ id: pending.form.id, answer: { decision: "save" } })
      expect(yield* Fiber.join(pending.fiber)).toMatchObject({ status: "error" })
      expect(fixture.writes).toEqual([])
    }),
  )
}

it.live("keeps a saved editable-read approval separate from the next write confirmation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("wordpress_content_api")
    const permissions = yield* Permission.Service
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* fixture.bus.listen((event) =>
      event.type === Permission.Event.Asked.type
        ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const input = { kind: "posts", id: 42, view: "editable" }
    const reading = yield* fixture.execute("wordpress_get_content", input, "read-editable").pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked).pipe(Effect.timeout("2 seconds"))
    expect(request.action).toBe("wordpress_read_editable_content")
    yield* permissions.reply({ requestID: request.id, reply: "always" })
    expect(yield* Fiber.join(reading)).toMatchObject({
      status: "completed",
      output: { result: { content: post.content.raw } },
    })
    expect(yield* fixture.execute("wordpress_get_content", input, "read-again").pipe(Effect.timeout("2 seconds"))).toMatchObject({
      status: "completed",
    })

    const pending = yield* fixture.awaiting(fixture.execute(updateTool, patch, "save-after-read"))
    yield* fixture.forms.cancel(pending.form.id)
    expect(yield* Fiber.join(pending.fiber)).toMatchObject({ status: "error" })
    expect(fixture.writes).toEqual([])
  }),
)

it.live("requires an interactive session even when an unattended run has write permission", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("wordpress_content_api")
    const result = yield* fixture
      .execute(updateTool, patch, "unattended")
      .pipe(Effect.provideService(Permission.Unattended, [{ action: updateTool, resource: "*", effect: "allow" }]))
    expect(result).toMatchObject({ status: "error", error: { message: expect.stringContaining("confirmation") } })
    expect(yield* fixture.forms.list()).toEqual([])
    expect(fixture.writes).toEqual([])
  }),
)

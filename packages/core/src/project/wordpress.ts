export * as ProjectWordPress from "./wordpress.js"

import {
  connect,
  getContent,
  listContent,
  listPages,
  readPage,
  updateContent,
  WordPressError,
} from "@harpress/wordpress"
import { and, eq, isNotNull } from "drizzle-orm"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { Project } from "@opencode/schema/project"
import { Database } from "../database/database.js"
import { ProjectTable } from "./sql.js"

export class ProjectConnectionError extends Error {
  constructor(
    readonly code: "not-project" | "not-connected" | "changed",
    message: string,
  ) {
    super(message)
  }
}

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const fetcher = yield* FetchHttpClient.Fetch
  const db = database.db

  const site = Effect.fnUntraced(function* (projectID: Project.ID) {
    const row = yield* db
      .select({ url: ProjectTable.wordpress_url, connection: ProjectTable.wordpress_connection })
      .from(ProjectTable)
      .where(eq(ProjectTable.id, projectID))
      .get()
      .pipe(Effect.orDie)
    if (!row?.url)
      return yield* Effect.fail(new ProjectConnectionError("not-project", "Choose a registered WordPress project."))
    return { url: row.url, connection: row.connection }
  })

  const connectedSite = Effect.fnUntraced(function* (projectID: Project.ID) {
    const project = yield* site(projectID)
    if (!project.connection)
      return yield* Effect.fail(
        new ProjectConnectionError("not-connected", "Connect WordPress in this project's settings first."),
      )
    return { url: project.url, connection: project.connection }
  })

  const request = <A>(run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: wordpressError })

  const withConnectedSite = Effect.fnUntraced(function* <A>(
    projectID: Project.ID,
    run: (access: Parameters<typeof readPage>[0], signal: AbortSignal) => Promise<A>,
  ) {
    const project = yield* connectedSite(projectID)
    const result = yield* request((signal) => run(project.connection, signal))
    return { site: project.url, result }
  })

  return {
    context: Effect.fnUntraced(function* (projectID: Project.ID) {
      const row = yield* db
        .select({
          name: ProjectTable.name,
          url: ProjectTable.wordpress_url,
          connected: isNotNull(ProjectTable.wordpress_connection).mapWith(Boolean),
        })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectID))
        .get()
        .pipe(Effect.orDie)
      if (row?.url) return { name: row.name ?? row.url, url: row.url, connected: row.connected }
    }),
    status: (projectID: Project.ID) =>
      site(projectID).pipe(Effect.map(({ connection }) => (connection ? { username: connection.username } : null))),
    connect: Effect.fnUntraced(function* (projectID: Project.ID, input: Project.ConnectWordPressInput) {
      const project = yield* site(projectID)
      if (input.url !== project.url)
        return yield* Effect.fail(new ProjectConnectionError("changed", "The WordPress URL changed. Connect again."))
      const verified = yield* request((signal) => connect(project.url, input, signal, fetcher))
      const saved = yield* db
        .update(ProjectTable)
        .set({ wordpress_connection: { ...verified, applicationPassword: input.applicationPassword } })
        .where(and(eq(ProjectTable.id, projectID), eq(ProjectTable.wordpress_url, project.url)))
        .returning({ id: ProjectTable.id })
        .get()
        .pipe(Effect.orDie)
      if (!saved)
        return yield* Effect.fail(new ProjectConnectionError("changed", "The WordPress URL changed. Connect again."))
      return { username: verified.username }
    }),
    disconnect: Effect.fnUntraced(function* (projectID: Project.ID) {
      yield* db
        .update(ProjectTable)
        .set({ wordpress_connection: null })
        .where(and(eq(ProjectTable.id, projectID), isNotNull(ProjectTable.wordpress_url)))
        .run()
        .pipe(Effect.orDie)
      return null
    }),
    readPage: (projectID: Project.ID, input: Parameters<typeof readPage>[1]) =>
      withConnectedSite(projectID, (access, signal) => readPage(access, input, signal, fetcher)),
    listPages: (projectID: Project.ID, input: Parameters<typeof listPages>[1]) =>
      withConnectedSite(projectID, (access, signal) => listPages(access, input, signal, fetcher)),
    listContent: (projectID: Project.ID, input: Parameters<typeof listContent>[1]) =>
      withConnectedSite(projectID, (access, signal) => listContent(access, input, signal, fetcher)),
    getContent: (projectID: Project.ID, input: Parameters<typeof getContent>[1]) =>
      withConnectedSite(projectID, (access, signal) => getContent(access, input, signal, fetcher)),
    updateContent: Effect.fnUntraced(function* <E>(
      projectID: Project.ID,
      input: Parameters<typeof updateContent>[1],
      confirm: (url: string) => Effect.Effect<void, E>,
    ) {
      const before = yield* connectedSite(projectID)
      yield* confirm(before.url)
      const current = yield* site(projectID)
      if (
        current.url !== before.url ||
        current.connection?.restUrl !== before.connection.restUrl ||
        current.connection.username !== before.connection.username ||
        current.connection.applicationPassword !== before.connection.applicationPassword
      )
        return yield* Effect.fail(
          new ProjectConnectionError("changed", "The WordPress connection changed. Review the edit again."),
        )
      const access = current.connection
      const result = yield* request((signal) => updateContent(access, input, signal, fetcher))
      return { site: current.url, result }
    }),
  }
})

function wordpressError(cause: unknown) {
  return cause instanceof WordPressError
    ? cause
    : new WordPressError("unavailable", "Could not reach the WordPress REST API.")
}

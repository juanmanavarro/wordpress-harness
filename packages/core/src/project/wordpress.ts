export * as ProjectWordPress from "./wordpress.js"

import { connect, listPages, readPage, WordPressError } from "@harpress/wordpress"
import { and, eq, isNotNull } from "drizzle-orm"
import { Effect } from "effect"
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

  const withConnectedSite = Effect.fnUntraced(function* <A>(
    projectID: Project.ID,
    run: (access: Parameters<typeof readPage>[0], signal: AbortSignal) => Promise<A>,
  ) {
    const project = yield* site(projectID)
    if (!project.connection)
      return yield* Effect.fail(
        new ProjectConnectionError("not-connected", "Connect WordPress in this project's settings first."),
      )
    const connection = project.connection
    const result = yield* Effect.tryPromise({
      try: (signal) => run(connection, signal),
      catch: wordpressError,
    })
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
      const verified = yield* Effect.tryPromise({
        try: (signal) => connect(project.url, input, signal),
        catch: wordpressError,
      })
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
      withConnectedSite(projectID, (access, signal) => readPage(access, input, signal)),
    listPages: (projectID: Project.ID, input: Parameters<typeof listPages>[1]) =>
      withConnectedSite(projectID, (access, signal) => listPages(access, input, signal)),
  }
})

function wordpressError(cause: unknown) {
  return cause instanceof WordPressError
    ? cause
    : new WordPressError("unavailable", "Could not reach the WordPress REST API.")
}

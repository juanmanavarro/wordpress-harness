import { Project } from "@opencode/core/project"
import { KV } from "@opencode/core/kv"
import { LegacyProjectsReceipt } from "@opencode/core/project/purge-legacy"
import { LegacyCleanup } from "@opencode/schema/project"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { InvalidRequestError, ProjectNotFoundError } from "@opencode/protocol/errors"

const decodeCleanup = Schema.decodeUnknownSync(LegacyCleanup)
const invalidWordPressProject = (error: Project.InvalidWordPressProjectError) =>
  new InvalidRequestError({ message: error.message, kind: "wordpress-project", field: error.field })

export const makeWordPressProjects = Effect.gen(function* () {
  const projects = yield* Project.Service
  const kv = yield* KV.Service

  return {
    create: (input: Project.CreateWordPressInput) =>
      projects.createWordPress(input).pipe(Effect.mapError(invalidWordPressProject)),
    cleanup: () =>
      kv
        .get(LegacyProjectsReceipt)
        .pipe(
          Effect.map((value) => ({
            data: value === undefined ? { projects: [], sessions: [] } : decodeCleanup(value),
          })),
        ),
  }
})

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle("project.list", (ctx) => Project.Service.use((project) => project.list(ctx.query)))
    .handle("project.update", (ctx) =>
      Project.Service.use((project) =>
        project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
          Effect.mapError((error) =>
            error._tag === "Project.InvalidWordPressProjectError"
              ? invalidWordPressProject(error)
              : new ProjectNotFoundError({
                  projectID: ctx.params.projectID,
                  message: `Project not found: ${ctx.params.projectID}`,
                }),
          ),
        ),
      ),
    ),
)

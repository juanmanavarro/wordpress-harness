import { Project } from "@opencode/schema/project"
import { Schema, SchemaGetter, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, ProjectNotFoundError } from "../errors.js"

const root = "/api/project"
const UpdatePayload = Schema.Struct(Struct.omit(Project.UpdateInput.fields, ["projectID"]))
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

export const WordPressProjectCreateEndpoint = HttpApiEndpoint.post("project.create", "/api/experimental/project", {
  payload: Project.CreateWordPressInput,
  success: Project.Info,
  error: InvalidRequestError,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.project.create",
    summary: "Register a WordPress project",
    description:
      "Register a production URL with a working folder. Experimental: may change without compatibility guarantees.",
  }),
)

export const LegacyProjectCleanupEndpoint = HttpApiEndpoint.get(
  "project.cleanup",
  "/api/experimental/project/cleanup",
  {
    success: Schema.Struct({ data: Project.LegacyCleanup }),
  },
).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.project.cleanup",
    summary: "Read the legacy project cleanup receipt",
    description:
      "Read the project and session references removed by migration for client cleanup. Experimental: may change without compatibility guarantees.",
  }),
)

const wordpressConnectionPath = "/api/experimental/project/:projectID/wordpress-connection"
const wordpressConnectionOptions = {
  params: { projectID: Project.ID },
  success: Schema.NullOr(Project.WordPressConnection),
  error: InvalidRequestError,
}

export const WordPressConnectionEndpoints = [
  HttpApiEndpoint.get("project.wordpressConnection", wordpressConnectionPath, wordpressConnectionOptions).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.project.wordpressConnection",
      summary: "Read a project's WordPress connection",
      description:
        "Returns the verified username, when connected. Experimental: may change without compatibility guarantees.",
    }),
  ),
  HttpApiEndpoint.put("project.connectWordPress", wordpressConnectionPath, {
    ...wordpressConnectionOptions,
    payload: Project.ConnectWordPressInput,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.project.connectWordPress",
      summary: "Connect a WordPress project",
      description:
        "Verify and save application credentials for the project's URL. Experimental: may change without compatibility guarantees.",
    }),
  ),
  HttpApiEndpoint.delete(
    "project.disconnectWordPress",
    wordpressConnectionPath,
    wordpressConnectionOptions,
  ).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.project.disconnectWordPress",
      summary: "Disconnect a WordPress project",
      description: "Remove the saved project credentials. Experimental: may change without compatibility guarantees.",
    }),
  ),
] as const

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", root, {
      query: Schema.Struct({
        archived: BooleanFromString.pipe(Schema.optional).annotateKey({
          description: "Set to true to include archived projects.",
        }),
      }),
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.list",
        summary: "List projects",
        description: "List known projects. Archived projects are excluded unless archived=true.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("project.update", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      payload: UpdatePayload,
      success: Project.Info,
      error: [ProjectNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.update",
        summary: "Update project",
        description: "Update the project canonical directory, display metadata, and workspace commands.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Project routes.",
    }),
  )

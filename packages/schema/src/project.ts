export * as Project from "./project.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { AbsolutePath, NonNegativeInt, optional } from "./schema.js"
import { ProjectID } from "./project-id.js"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9._-]*$/u)).annotate({
  identifier: "Project.Vcs",
})
export const Current = Schema.Struct({
  id: ID,
  directory: AbsolutePath,
  canonical: AbsolutePath,
}).annotate({ identifier: "Project.Current" })
export interface Current extends Schema.Schema.Type<typeof Current> {}
export const Icon = Schema.Struct({
  url: optional(Schema.String),
  override: optional(Schema.String),
  color: optional(Schema.String),
}).annotate({ identifier: "Project.Icon" })
export interface Icon extends Schema.Schema.Type<typeof Icon> {}
export const Commands = Schema.Struct({
  start: optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
}).annotate({ identifier: "Project.Commands" })
export interface Commands extends Schema.Schema.Type<typeof Commands> {}
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  active: NonNegativeInt,
  archived: optional(NonNegativeInt),
}).annotate({ identifier: "Project.Time" })
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const WordPressUrl = Schema.Trim.check(Schema.isPattern(/^https:\/\/[^\s/\\?#@]+(?:[/#?][^\s\\]*)?$/i)).annotate(
  { identifier: "Project.WordPressUrl" },
)
export type WordPressUrl = typeof WordPressUrl.Type

export const CreateWordPressInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isNonEmpty()),
  url: WordPressUrl,
  directory: AbsolutePath,
}).annotate({ identifier: "Project.CreateWordPressInput" })
export interface CreateWordPressInput extends Schema.Schema.Type<typeof CreateWordPressInput> {}

export const ConnectWordPressInput = Schema.Struct({
  url: WordPressUrl,
  username: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(254)),
  applicationPassword: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
}).annotate({ identifier: "Project.ConnectWordPressInput" })
export interface ConnectWordPressInput extends Schema.Schema.Type<typeof ConnectWordPressInput> {}

export const WordPressConnection = Schema.Struct({
  username: Schema.String,
}).annotate({ identifier: "Project.WordPressConnection" })
export interface WordPressConnection extends Schema.Schema.Type<typeof WordPressConnection> {}

export const LegacyCleanup = Schema.Struct({
  projects: Schema.Array(Schema.Struct({ id: Schema.String, directories: Schema.Array(Schema.String) })),
  sessions: Schema.Array(Schema.Struct({ id: Schema.String, directory: Schema.String })),
}).annotate({ identifier: "Project.LegacyCleanup" })
export interface LegacyCleanup extends Schema.Schema.Type<typeof LegacyCleanup> {}

export const Info = Schema.Struct({
  id: ID,
  canonical: AbsolutePath,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
  experimental: optional(
    Schema.Struct({ wordpress: optional(Schema.Struct({ url: WordPressUrl, directory: AbsolutePath })) }),
  ),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const UpdateInput = Schema.Struct({
  projectID: ID,
  canonical: optional(AbsolutePath),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  experimental: optional(Schema.Struct({ wordpressUrl: optional(WordPressUrl) })),
}).annotate({ identifier: "Project.UpdateInput" })
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

const Updated = ephemeral({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }

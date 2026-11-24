/// <reference path="./markdown.d.ts" />

import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import wordpress from "../skills/harpress-wordpress/SKILL.md" with { type: "text" }
import content from "../skills/harpress-wordpress-content/SKILL.md" with { type: "text" }
import verify from "../skills/harpress-wordpress-verify/SKILL.md" with { type: "text" }

export const skills: readonly Skill.Info[] = [
  {
    id: "harpress-wordpress",
    name: "WordPress",
    description: "Use when a request involves a connected WordPress site or when identifying the site to work on.",
    content: wordpress,
  },
  {
    id: "harpress-wordpress-content",
    name: "WordPress Content",
    description: "Use when finding, reading, or editing existing content on the connected WordPress site.",
    content,
  },
  {
    id: "harpress-wordpress-verify",
    name: "WordPress Verify",
    description: "Use when checking the current content of a page or post on the connected WordPress site.",
    content: verify,
  },
].map((skill) =>
  Skill.Info.make({
    id: Skill.ID.make(skill.id),
    name: Skill.Name.make(skill.name),
    description: skill.description,
    path: AbsolutePath.make(`skill://harpress-wordpress/${skill.id}/SKILL.md`),
    content: skill.content,
  }),
)

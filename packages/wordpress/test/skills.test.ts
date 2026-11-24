import { expect, test } from "bun:test"
import { skills, WORDPRESS_BUNDLE_VERSION } from "../src/index.js"

test("bundled_skills_have_stable_unique_ids", () => {
  expect(WORDPRESS_BUNDLE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  expect<string[]>(skills.map((skill) => skill.id).sort()).toEqual([
    "harpress-wordpress",
    "harpress-wordpress-content",
    "harpress-wordpress-verify",
  ])

  for (const skill of skills) {
    expect<string>(skill.path).toBe(`skill://harpress-wordpress/${skill.id}/SKILL.md`)
    expect(skill.description?.trim()).toBeTruthy()
    expect(skill.content.trim()).toBeTruthy()
    expect(skill.content).not.toMatch(/\b(?:wp-cli|wp [\w-]+|npx|npm|bunx|bash|python3?)\b/i)
    expect(skill.content).not.toMatch(/```|\]\(|\b[\w/-]+\.(?:md|sh|ps1|py|php|m?js|ts)\b/i)
  }
})

import { expect, test } from "bun:test"
import {
  INITIAL_PROJECT_FORM,
  transitionProjectForm,
  type ProjectFormEvent,
  type ProjectFormState,
} from "./project-form-machine"

test("an expired project save cannot replace the result of a later attempt", () => {
  const events: ProjectFormEvent[] = [
    { type: "edited", field: "name", value: "Shop" },
    { type: "edited", field: "url", value: "https://shop.example.com" },
    { type: "picker.opened" },
    { type: "picker.closed", directory: "/projects/shop" },
    { type: "submitted" },
    { type: "save.failed", attempt: 1, error: "Timed out" },
    { type: "submitted" },
  ]

  const retry = events.reduce<ProjectFormState>(transitionProjectForm, INITIAL_PROJECT_FORM)
  expect(retry).toMatchObject({ status: "saving", attempt: 2 })
  expect(transitionProjectForm(retry, { type: "save.failed", attempt: 1, error: "Old result" })).toBe(retry)

  const closed = transitionProjectForm(retry, { type: "disposed" })
  expect(transitionProjectForm(closed, { type: "save.failed", attempt: 2, error: "Late result" })).toBe(closed)
})

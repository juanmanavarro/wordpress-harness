import { Project } from "@opencode/schema/project"
import { Schema } from "effect"

type Draft = { readonly name: string; readonly url: string; readonly directory: string }

export type ProjectFormState =
  | { readonly status: "editing" | "picking"; readonly draft: Draft; readonly attempt: number; readonly error?: string }
  | { readonly status: "saving"; readonly draft: Draft; readonly attempt: number }
  | { readonly status: "disposed" }

export type ProjectFormEvent =
  | { readonly type: "edited"; readonly field: "name" | "url"; readonly value: string }
  | { readonly type: "picker.opened" }
  | { readonly type: "picker.closed"; readonly directory?: string }
  | { readonly type: "submitted" }
  | { readonly type: "save.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export const INITIAL_PROJECT_FORM = {
  status: "editing",
  draft: { name: "", url: "", directory: "" },
  attempt: 0,
} satisfies ProjectFormState

const isWordPressUrl = Schema.is(Project.WordPressUrl)

export function isProductionUrl(value: string) {
  if (!isWordPressUrl(value)) return false

  try {
    const url = new URL(value)

    return !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

export function projectFormView(state: ProjectFormState) {
  const draft = state.status === "disposed" ? INITIAL_PROJECT_FORM.draft : state.draft
  const invalidUrl = !isProductionUrl(draft.url.trim())

  return {
    draft,
    invalidUrl,
    error: state.status === "editing" ? state.error : undefined,
    editing: state.status === "editing",
    saving: state.status === "saving",
    canSave: state.status === "editing" && !!draft.name.trim() && !!draft.directory && !invalidUrl,
  }
}

export function transitionProjectForm(state: ProjectFormState, event: ProjectFormEvent): ProjectFormState {
  if (state.status === "disposed") return state

  switch (event.type) {
    case "edited":
      if (state.status !== "editing") return state

      return { ...state, draft: { ...state.draft, [event.field]: event.value }, error: undefined }
    case "picker.opened":
      return state.status === "editing" ? { ...state, status: "picking" } : state
    case "picker.closed":
      if (state.status !== "picking") return state

      return event.directory
        ? { ...state, status: "editing", draft: { ...state.draft, directory: event.directory }, error: undefined }
        : { ...state, status: "editing" }
    case "submitted":
      if (!projectFormView(state).canSave) return state

      return { status: "saving", draft: state.draft, attempt: state.attempt + 1 }
    case "save.failed":
      return state.status === "saving" && state.attempt === event.attempt
        ? { ...state, status: "editing", error: event.error }
        : state
    case "disposed":
      return { status: "disposed" }
  }
}

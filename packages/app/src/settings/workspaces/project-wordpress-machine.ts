type Connection = { username: string }

export type ConnectionState =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "disconnected" }
  | { status: "connected"; connection: Connection; error?: string }
  | { status: "disconnecting"; connection: Connection }

type ConnectionEvent =
  | { type: "retry" }
  | { type: "loaded"; connection: Connection | null }
  | { type: "connected"; connection: Connection }
  | { type: "disconnect" }
  | { type: "disconnected" }
  | { type: "failed"; error: string }

export const LOADING_CONNECTION: ConnectionState = { status: "loading" }

export function connectionView(state: ConnectionState) {
  return {
    status: state.status,
    connection: "connection" in state ? state.connection : undefined,
    error: "error" in state ? state.error : undefined,
  }
}

export function transitionConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case "retry":
      return state.status === "failed" ? LOADING_CONNECTION : state
    case "loaded":
      if (state.status !== "loading") return state
      return event.connection ? { status: "connected", connection: event.connection } : { status: "disconnected" }
    case "connected":
      return state.status === "disconnected" ? { status: "connected", connection: event.connection } : state
    case "disconnect":
      return state.status === "connected" ? { status: "disconnecting", connection: state.connection } : state
    case "disconnected":
      return state.status === "disconnecting" ? { status: "disconnected" } : state
    case "failed":
      if (state.status === "loading") return { status: "failed", error: event.error }
      return state.status === "disconnecting"
        ? { status: "connected", connection: state.connection, error: event.error }
        : state
  }
}

type Draft = { username: string; applicationPassword: string }
export type ConnectFormState =
  | { status: "editing"; draft: Draft; error?: string }
  | { status: "saving"; draft: Draft }
  | { status: "saved" }
  | { status: "disposed" }

type ConnectFormEvent =
  | { type: "edit"; field: keyof Draft; value: string }
  | { type: "save" }
  | { type: "saved" }
  | { type: "failed"; error: string }
  | { type: "dispose" }

const emptyDraft = { username: "", applicationPassword: "" }
export const INITIAL_CONNECT_FORM: ConnectFormState = { status: "editing", draft: emptyDraft }

export function connectFormView(state: ConnectFormState) {
  const draft = "draft" in state ? state.draft : emptyDraft
  return {
    draft,
    busy: state.status === "saving",
    canSave: state.status === "editing" && !!draft.username.trim() && !!draft.applicationPassword.trim(),
    error: state.status === "editing" ? state.error : undefined,
  }
}

export function transitionConnectForm(state: ConnectFormState, event: ConnectFormEvent): ConnectFormState {
  switch (event.type) {
    case "edit":
      if (state.status !== "editing") return state
      return { status: "editing", draft: { ...state.draft, [event.field]: event.value } }
    case "save":
      return state.status === "editing" && connectFormView(state).canSave
        ? { status: "saving", draft: state.draft }
        : state
    case "saved":
      return state.status === "saving" ? { status: "saved" } : state
    case "failed":
      return state.status === "saving" ? { status: "editing", draft: state.draft, error: event.error } : state
    case "dispose":
      return { status: "disposed" }
  }
}

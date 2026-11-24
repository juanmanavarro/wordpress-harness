import { expect, test } from "bun:test"
import {
  INITIAL_CONNECT_FORM,
  LOADING_CONNECTION,
  connectFormView,
  transitionConnectForm,
  transitionConnection,
} from "./project-wordpress-machine"

test("keeps the form editable after authentication fails and discards a result after closing", () => {
  const initial = transitionConnectForm(INITIAL_CONNECT_FORM, { type: "edit", field: "username", value: "editor" })
  const edited = transitionConnectForm(initial, { type: "edit", field: "applicationPassword", value: "password" })
  const saving = transitionConnectForm(edited, { type: "save" })
  expect(transitionConnectForm(saving, { type: "save" })).toBe(saving)
  const failed = transitionConnectForm(saving, { type: "failed", error: "Credentials rejected" })
  expect(connectFormView(failed)).toMatchObject({ busy: false, canSave: true, error: "Credentials rejected" })
  const disposed = transitionConnectForm(saving, { type: "dispose" })
  expect(transitionConnectForm(disposed, { type: "saved" })).toBe(disposed)
  expect(connectFormView(disposed).draft.applicationPassword).toBe("")
})

test("keeps a connection visible when disconnect fails and removes it after a successful retry", () => {
  const connection = { username: "editor" }
  const loaded = transitionConnection(LOADING_CONNECTION, { type: "loaded", connection })
  const pending = transitionConnection(loaded, { type: "disconnect" })
  const failed = transitionConnection(pending, { type: "failed", error: "Could not disconnect" })
  expect(failed).toMatchObject({ status: "connected", connection, error: "Could not disconnect" })
  const retry = transitionConnection(failed, { type: "disconnect" })
  expect(transitionConnection(retry, { type: "disconnected" })).toEqual({ status: "disconnected" })
})

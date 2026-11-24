import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { TextInput } from "@opencode/ui/text-input"
import { Match, Show, Switch, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsRow } from "@/settings/row"
import {
  INITIAL_CONNECT_FORM,
  LOADING_CONNECTION,
  connectFormView,
  connectionView,
  transitionConnectForm,
  transitionConnection,
  type ConnectFormState,
  type ConnectionState,
} from "./project-wordpress-machine"

export function ProjectWordPressConnection(props: { projectID: string; url: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const api = useServer().ctx.sdk.api.experimental.project
  const [state, setState] = createSignal<ConnectionState>(LOADING_CONNECTION)
  const view = createMemo(() => connectionView(state()))
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
  const dispatch = (event: Parameters<typeof transitionConnection>[1]) =>
    setState((state) => transitionConnection(state, event))

  const fail = (cause: unknown) => {
    if (!controller.signal.aborted) dispatch({ type: "failed", error: formatServerError(cause, language.t) })
  }

  const load = () => {
    dispatch({ type: "retry" })
    void api
      .wordpressConnection({ projectID: props.projectID }, { signal: signal() })
      .then((connection) => dispatch({ type: "loaded", connection }))
      .catch(fail)
  }
  load()

  const disconnect = () => {
    if (state().status !== "connected") return
    dispatch({ type: "disconnect" })
    void api
      .disconnectWordPress({ projectID: props.projectID }, { signal: signal() })
      .then(() => dispatch({ type: "disconnected" }))
      .catch(fail)
  }

  return (
    <SettingsRow
      title={language.t("project.wordpress.connection")}
      description={
        <Show when={view().connection} fallback={language.t("project.wordpress.description")}>
          {(connection) => language.t("project.wordpress.connected", { username: connection().username })}
        </Show>
      }
    >
      <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Show when={view().error}>
          {(message) => (
            <span role="alert" class="text-v2-state-fg-danger">
              {message()}
            </span>
          )}
        </Show>
        <Switch>
          <Match when={view().status === "loading"}>
            <span role="status">{language.t("common.loading")}</span>
          </Match>
          <Match when={view().status === "failed"}>
            <Button size="small" variant="neutral" onClick={load}>
              {language.t("common.retry")}
            </Button>
          </Match>
          <Match when={view().connection}>
            <Button size="small" variant="neutral" disabled={view().status === "disconnecting"} onClick={disconnect}>
              {language.t("common.disconnect")}
            </Button>
          </Match>
          <Match when={view().status === "disconnected"}>
            <Button
              size="small"
              variant="neutral"
              onClick={() => {
                const projectID = props.projectID
                const url = props.url
                dialog.show(() => (
                  <ConnectWordPressDialog
                    url={url}
                    connect={(input, signal) => api.connectWordPress({ projectID, url, ...input }, { signal })}
                    onConnected={(connection) => dispatch({ type: "connected", connection })}
                  />
                ))
              }}
            >
              {language.t("project.wordpress.connect")}
            </Button>
          </Match>
        </Switch>
      </div>
    </SettingsRow>
  )
}

function ConnectWordPressDialog(props: {
  url: string
  connect: (
    input: { username: string; applicationPassword: string },
    signal: AbortSignal,
  ) => Promise<{ username: string } | null>
  onConnected: (connection: { username: string }) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const usernameID = createUniqueId()
  const passwordID = createUniqueId()
  const [state, setState] = createSignal<ConnectFormState>(INITIAL_CONNECT_FORM)
  const view = createMemo(() => connectFormView(state()))
  const dispatch = (event: Parameters<typeof transitionConnectForm>[1]) =>
    setState((state) => transitionConnectForm(state, event))
  const controller = new AbortController()
  onCleanup(() => {
    dispatch({ type: "dispose" })
    controller.abort()
  })

  const save = () => {
    if (!view().canSave) return
    const next = dispatch({ type: "save" })
    if (next.status !== "saving") return
    void props
      .connect(
        { username: next.draft.username.trim(), applicationPassword: next.draft.applicationPassword.trim() },
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      .then((connection) => {
        if (!connection) throw new Error(language.t("common.requestFailed"))
        props.onConnected(connection)
        if (dispatch({ type: "saved" }).status !== "saved") return
        dialog.close()
      })
      .catch((cause: unknown) => {
        dispatch({ type: "failed", error: formatServerError(cause, language.t) })
      })
  }

  return (
    <Dialog fit containerClass="!bg-v2-background-bg-base" preventBackdropDismiss={view().busy}>
      <DialogHeader hideClose={view().busy}>
        <DialogTitle>{language.t("project.wordpress.connect")}</DialogTitle>
      </DialogHeader>
      <Divider />
      <form
        class="flex w-full min-w-0 flex-col"
        aria-busy={view().busy}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <DialogBody class="min-w-0 gap-4 p-4">
          <p class="text-13-regular text-v2-text-text-muted break-all" dir="ltr">
            {props.url}
          </p>
          <div class="flex flex-col gap-1.5 text-13-medium">
            <label for={usernameID}>{language.t("project.wordpress.username")}</label>
            <TextInput
              id={usernameID}
              class="w-full"
              appearance="large"
              surface="layer-1"
              autocomplete="username"
              autofocus
              required
              maxlength={254}
              readOnly={view().busy}
              value={view().draft.username}
              onInput={(event) => dispatch({ type: "edit", field: "username", value: event.currentTarget.value })}
            />
          </div>
          <div class="flex flex-col gap-1.5 text-13-medium">
            <label for={passwordID}>{language.t("project.wordpress.password")}</label>
            <TextInput
              id={passwordID}
              class="w-full"
              appearance="large"
              surface="layer-1"
              type="password"
              autocomplete="off"
              required
              maxlength={128}
              readOnly={view().busy}
              value={view().draft.applicationPassword}
              onInput={(event) =>
                dispatch({ type: "edit", field: "applicationPassword", value: event.currentTarget.value })
              }
            />
            <p class="text-12-regular text-v2-text-text-muted">{language.t("project.wordpress.passwordHelp")}</p>
          </div>
          <Show when={view().error}>
            {(message) => (
              <p role="alert" class="text-13-regular text-v2-state-fg-danger">
                {message()}
              </p>
            )}
          </Show>
        </DialogBody>
        <Divider />
        <DialogFooter>
          <Button type="button" variant="neutral" disabled={view().busy} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={!view().canSave}>
            {language.t(view().busy ? "project.wordpress.testing" : "project.wordpress.testAndSave")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

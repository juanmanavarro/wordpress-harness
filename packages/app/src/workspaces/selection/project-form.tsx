import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { TextInput } from "@opencode/ui/text-input"
import type { LocationRef } from "@opencode/client/promise"
import { Show, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatServerError } from "@/runtime/server/errors"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { useDirectoryPicker } from "./picker"
import {
  INITIAL_PROJECT_FORM,
  projectFormView,
  transitionProjectForm,
  type ProjectFormState,
} from "./project-form-machine"

type ProjectFormInput = {
  server: ServerConnection.Any
  title?: string
  location?: LocationRef
  onSaved?: (project: Project) => void
}

export function useAddProjectDialog() {
  const dialog = useDialog()

  return (input: ProjectFormInput) => dialog.show(() => <AddProjectDialog {...input} />)
}

function AddProjectDialog(props: ProjectFormInput) {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createSignal<ProjectFormState>(INITIAL_PROJECT_FORM)
  const view = createMemo(() => projectFormView(state()))
  const nameID = createUniqueId()
  const urlID = createUniqueId()
  const urlErrorID = createUniqueId()
  let controller: AbortController | undefined

  onCleanup(() => {
    setState((state) => transitionProjectForm(state, { type: "disposed" }))
    controller?.abort()
  })

  const browse = () => {
    if (!view().editing) return
    setState((state) => transitionProjectForm(state, { type: "picker.opened" }))
    pickDirectory({
      server: props.server,
      location: props.location,
      title: language.t("project.workingFolder"),
      multiple: false,
      stacked: true,
      onSelect: (value) => {
        const directory = Array.isArray(value) ? value[0] : value
        setState((state) => transitionProjectForm(state, { type: "picker.closed", directory: directory ?? undefined }))
      },
    })
  }

  const save = () => {
    if (!view().canSave) return

    const next = setState((state) => transitionProjectForm(state, { type: "submitted" }))
    if (next.status !== "saving") return

    const fail = (error: string) =>
      setState((state) => transitionProjectForm(state, { type: "save.failed", attempt: next.attempt, error }))

    const ctx = global.serverCtx(ServerConnection.key(props.server))
    const fallback = () => language.t("common.requestFailed")

    if (!ctx) return void fail(fallback())

    const abort = new AbortController()
    controller = abort

    const timeout = setTimeout(() => {
      fail(fallback())
      abort.abort()
    }, 15_000)

    void ctx.projects
      .create(
        { name: next.draft.name.trim(), url: next.draft.url.trim(), directory: next.draft.directory },
        abort.signal,
      )
      .then(
        (project) => {
          const current = state()
          if (dialog.closing || current.status !== "saving" || current.attempt !== next.attempt) return

          dialog.close()
          props.onSaved?.(project)
        },
        (error) => fail(formatServerError(error, language.t, fallback())),
      )
      .finally(() => clearTimeout(timeout))
  }

  return (
    <Dialog fit containerClass="!bg-v2-background-bg-base" preventBackdropDismiss={view().saving}>
      <DialogHeader hideClose={view().saving}>
        <DialogTitle>{props.title ?? language.t("home.project.add")}</DialogTitle>
      </DialogHeader>
      <Divider />
      <form
        class="flex w-full min-w-0 flex-col"
        aria-busy={view().saving}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <DialogBody class="min-w-0 gap-4 p-4">
          <div class="flex flex-col gap-1.5 text-13-medium">
            <label for={nameID}>{language.t("project.add.name")}</label>
            <TextInput
              id={nameID}
              appearance="large"
              surface="layer-1"
              class="w-full"
              autofocus
              required
              value={view().draft.name}
              onInput={(event) =>
                setState((state) =>
                  transitionProjectForm(state, { type: "edited", field: "name", value: event.currentTarget.value }),
                )
              }
              readOnly={view().saving}
            />
          </div>
          <div class="flex flex-col gap-1.5 text-13-medium">
            <label for={urlID}>{language.t("project.productionUrl")}</label>
            <TextInput
              id={urlID}
              type="url"
              appearance="large"
              surface="layer-1"
              class="w-full"
              dir="ltr"
              required
              placeholder="https://example.com"
              value={view().draft.url}
              invalid={!!view().draft.url && view().invalidUrl}
              aria-describedby={view().draft.url && view().invalidUrl ? urlErrorID : undefined}
              onInput={(event) =>
                setState((state) =>
                  transitionProjectForm(state, { type: "edited", field: "url", value: event.currentTarget.value }),
                )
              }
              readOnly={view().saving}
            />
            <Show when={view().draft.url && view().invalidUrl}>
              <span id={urlErrorID} class="text-12-regular text-v2-state-fg-danger">
                {language.t("project.productionUrl.https")}
              </span>
            </Show>
          </div>
          <div class="flex flex-col gap-1.5 text-13-medium">
            <span>{language.t("project.workingFolder")}</span>
            <Button
              type="button"
              variant="neutral"
              icon="folder"
              class="self-start whitespace-nowrap"
              disabled={!view().editing}
              onClick={browse}
            >
              {language.t("project.add.chooseFolder")}
            </Button>
            <Show when={view().draft.directory}>
              {(directory) => (
                <code dir="ltr" class="min-w-0 break-all text-13-regular text-v2-text-text-muted" title={directory()}>
                  {directory()}
                </code>
              )}
            </Show>
          </div>
          <Show when={view().error}>
            {(error) => (
              <div role="alert" class="text-13-regular text-v2-state-fg-danger">
                {error()}
              </div>
            )}
          </Show>
        </DialogBody>
        <Divider />
        <DialogFooter>
          <Button type="button" variant="neutral" disabled={!view().editing} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={!view().canSave}>
            {language.t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

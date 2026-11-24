import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("registers a WordPress project and reloads its details from the same database", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const workingFolder = (yield* tmpdirScoped()).path
    const options = {
      app: { version: "test" },
      database: { path: path.join(directory, "opencode.db") },
      config: { directory, project: false, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    }
    const client = (handle: (request: Request) => Promise<Response>) =>
      OpenCode.make({
        baseUrl: "http://opencode.local",
        fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handle(new Request(input, init)), {
          preconnect: fetch.preconnect,
        }),
      })

    const expected = yield* Effect.scoped(
      Effect.gen(function* () {
        const api = client(yield* ServerFetch.make(options))
        yield* Effect.promise(async () => {
          await expect(
            api.experimental.project.create({
              name: "Documentation",
              url: "http://docs.example.test",
              directory: workingFolder,
            }),
          ).rejects.toBeDefined()
          expect(await api.project.list()).toEqual([])
        })
        const project = yield* Effect.promise(() =>
          api.experimental.project.create({
            name: "Documentation",
            url: "https://docs.example.test/wordpress",
            directory: workingFolder,
          }),
        )
        return yield* Effect.promise(() =>
          api.project.update({
            projectID: project.id,
            experimental: { wordpressUrl: "https://www.docs.example.test/wordpress" },
          }),
        )
      }),
    )
    const api = client(yield* ServerFetch.make(options))
    const stored = (yield* Effect.promise(() => api.project.list())).find((project) => project.id === expected.id)

    expect(stored).toMatchObject({
      name: "Documentation",
      experimental: { wordpress: { url: "https://www.docs.example.test/wordpress", directory: workingFolder } },
    })
  }),
)

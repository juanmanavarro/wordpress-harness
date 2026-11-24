import { Buffer } from "node:buffer"
import { Schema } from "effect"

type Credentials = { readonly username: string; readonly applicationPassword: string }
type Access = Credentials & { readonly restUrl: string }

export class WordPressError extends Error {
  constructor(
    readonly code:
      | "authentication"
      | "forbidden"
      | "unavailable"
      | "invalid-input"
      | "invalid-response"
      | "redirect"
      | "not-found"
      | "timeout",
    message: string,
  ) {
    super(message)
  }
}

const User = Schema.Struct({ id: Schema.Number, username: Schema.String })
const PageSummary = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String,
  link: Schema.String,
  title: Schema.Struct({ rendered: Schema.String }),
})
const Page = Schema.Struct({
  ...PageSummary.fields,
  content: Schema.Struct({ rendered: Schema.String }),
})
const candidate = Schema.Struct({ id: Schema.Number, slug: Schema.String, link: Schema.String, title: Schema.String })

export const PageList = Schema.Struct({
  pages: Schema.Array(candidate),
  nextPage: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
})

export const PageRead = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("found"),
    page: Schema.Struct({ ...candidate.fields, content: Schema.String }),
  }),
  Schema.Struct({ status: Schema.Literal("choose"), candidates: Schema.Array(candidate) }),
  Schema.Struct({ status: Schema.Literal("missing") }),
])
type PageRead = typeof PageRead.Type

const ContentKind = Schema.Literals(["pages", "posts"])
const ContentTarget = { kind: ContentKind, id: Schema.Int.check(Schema.isGreaterThan(0)) }
const ContentPatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  excerpt: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter(
    (patch) => patch.title !== undefined || patch.content !== undefined || patch.excerpt !== undefined,
    { description: "At least one editable field" },
  ),
)

export const ListContentInput = Schema.Struct({
  kind: ContentKind,
  page: PageList.fields.nextPage,
  search: Schema.optionalKey(Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200))),
})
export const GetContentInput = Schema.Struct({
  ...ContentTarget,
  view: Schema.optionalKey(Schema.Literals(["published", "editable"])),
})
export const UpdateContentInput = Schema.Struct({ ...ContentTarget, patch: ContentPatch })
export const ContentList = Schema.Struct({ items: Schema.Array(candidate), nextPage: PageList.fields.nextPage })
export const Content = Schema.Struct({
  ...candidate.fields,
  status: Schema.String,
  content: Schema.String,
  excerpt: Schema.String,
})

const ContentView = Schema.Struct({ ...Page.fields, status: Schema.String, excerpt: Page.fields.content })
const contentFields = "id,slug,link,status,title,content,excerpt"
const Raw = Schema.Struct({ raw: Schema.String })
const RestError = Schema.Struct({ code: Schema.String })
const EditableContent = Schema.Struct({
  ...ContentView.fields,
  title: Raw,
  content: Raw,
  excerpt: Raw,
})

export async function connect(
  site: string,
  credentials: Credentials,
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const url = new URL(site)
  if (url.protocol !== "https:" || url.username || url.password)
    throw new WordPressError("invalid-response", "The WordPress site must have an HTTPS URL.")
  if (credentials.username.includes(":"))
    throw new WordPressError("authentication", "Enter a valid WordPress username.")

  // Discovery carries no authentication. Only a REST URL on the configured origin may receive credentials.
  const discovery = await fetcher(url, { method: "HEAD", redirect: "manual", signal }).catch(() => undefined)
  const link = /<([^>]+)>\s*;\s*rel="?https:\/\/api\.w\.org\/"?/i.exec(discovery?.headers.get("link") ?? "")?.[1]
  const advertised = link && URL.canParse(link, url.href) ? new URL(link, url) : undefined
  const rest =
    advertised?.origin === url.origin && !advertised.username && !advertised.password ? advertised : undefined
  const base = new URL(url.pathname.replace(/\/?$/, "/"), url.origin)
  const query = { context: "edit", _fields: "id,username" }
  const root = rest ?? new URL("wp-json/", base)
  const first = await request(fetcher, { ...credentials, restUrl: root.href }, "/users/me", query, signal)
  if (!rest && (first.status === 404 || (first.ok && !json(first)))) {
    await first.body?.cancel()
    const plain = new URL("?rest_route=/", base)
    const response = await request(fetcher, { ...credentials, restUrl: plain.href }, "/users/me", query, signal)
    const user = await received(User, response)
    return { username: user.username, restUrl: plain.href }
  }
  const user = await received(User, first)
  return { username: user.username, restUrl: root.href }
}

export async function readPage(
  access: Access,
  input: { query: string; by?: "slug" | "title" },
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PageRead> {
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const term = input.query.trim()
  const listing = await request(
    fetcher,
    access,
    "/pages",
    { _fields: "id,slug,link,title", per_page: "10", [input.by === "slug" ? "slug" : "search"]: term },
    signal,
  )
  const matches = await received(Schema.Array(PageSummary), listing)
  if (!matches.length) return { status: "missing" }

  const exact = matches.filter((item) => item.title.rendered.trim().toLowerCase() === term.toLowerCase())
  const shortlisted = exact.length ? exact : matches
  if (shortlisted.length !== 1 || Number(listing.headers.get("x-wp-totalpages")) > 1) {
    return { status: "choose", candidates: shortlisted.map(summary) }
  }

  const response = await request(
    fetcher,
    access,
    `/pages/${shortlisted[0].id}`,
    { _fields: "id,slug,link,title,content" },
    signal,
  )
  const page = await received(Page, response)
  return { status: "found", page: { ...summary(page), content: page.content.rendered } }
}

export async function listPages(
  access: Access,
  input: { page?: number },
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<typeof PageList.Type> {
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const page = input.page ?? 1
  const response = await request(
    fetcher,
    access,
    "/pages",
    { _fields: "id,slug,link,title", per_page: "25", page: String(page), orderby: "title", order: "asc" },
    signal,
  )
  const items = await received(Schema.Array(PageSummary), response)
  return {
    pages: items.map(summary),
    ...(page < Number(response.headers.get("x-wp-totalpages")) ? { nextPage: page + 1 } : {}),
  }
}

export async function listContent(
  access: Access,
  value: typeof ListContentInput.Type,
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<typeof ContentList.Type> {
  const input = validateInput(ListContentInput, value)
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const page = input.page ?? 1
  const response = await request(
    fetcher,
    access,
    `/${input.kind}`,
    {
      _fields: "id,slug,link,title",
      status: "publish",
      per_page: "25",
      page: String(page),
      orderby: input.search === undefined ? "title" : "relevance",
      ...(input.search === undefined ? { order: "asc" } : { search: input.search }),
    },
    signal,
  )
  const items = await received(Schema.Array(PageSummary), response, { signal })
  return {
    items: items.map(summary),
    ...(page < Number(response.headers.get("x-wp-totalpages")) ? { nextPage: page + 1 } : {}),
  }
}

export async function getContent(
  access: Access,
  value: typeof GetContentInput.Type,
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<typeof Content.Type> {
  const input = validateInput(GetContentInput, value)
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const editable = input.view === "editable"
  const response = await request(
    fetcher,
    access,
    `/${input.kind}/${input.id}`,
    { _fields: contentFields, context: editable ? "edit" : "view" },
    signal,
  )
  if (editable) return editableContent(await received(EditableContent, response, { signal }))
  const item = await received(ContentView, response, { signal })
  if (item.status !== "publish") throw contentNotFound()
  return { ...summary(item), status: item.status, content: item.content.rendered, excerpt: item.excerpt.rendered }
}

export async function updateContent(
  access: Access,
  value: typeof UpdateContentInput.Type,
  abort: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<typeof Content.Type> {
  const input = validateInput(UpdateContentInput, value)
  const signal = AbortSignal.any([abort, AbortSignal.timeout(12_000)])
  const response = await request(
    fetcher,
    access,
    `/${input.kind}/${input.id}`,
    { _fields: contentFields, context: "edit" },
    signal,
    JSON.stringify(input.patch),
  )
  return editableContent(await received(EditableContent, response, { signal, writing: true }))
}

function validateInput<S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] {
  const decoded = Schema.decodeUnknownOption(schema)(input)
  if (decoded._tag === "None") throw new WordPressError("invalid-input", "Invalid WordPress content arguments.")
  return decoded.value
}

function editableContent(item: typeof EditableContent.Type) {
  return {
    id: item.id,
    slug: item.slug,
    link: item.link,
    status: item.status,
    title: item.title.raw,
    content: item.content.raw,
    excerpt: item.excerpt.raw,
  }
}

function summary(page: typeof PageSummary.Type) {
  return { id: page.id, slug: page.slug, title: page.title.rendered, link: page.link }
}

async function request(
  fetcher: typeof fetch,
  access: Access,
  route: string,
  params: Readonly<Record<string, string>>,
  signal: AbortSignal,
  body?: string,
) {
  const url = new URL(access.restUrl)
  if (url.searchParams.has("rest_route")) url.searchParams.set("rest_route", "/wp/v2" + route)
  else url.pathname = url.pathname.replace(/\/$/, "") + "/wp/v2" + route
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const key = Buffer.from(`${access.username}:${access.applicationPassword.replace(/\s/g, "")}`, "utf8").toString(
    "base64",
  )
  return fetcher(url, {
    headers: {
      accept: "application/json",
      authorization: `Basic ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { method: "POST", body }),
    redirect: "manual",
    signal,
  }).catch(() => {
    if (signal.reason instanceof DOMException && signal.reason.name === "TimeoutError")
      throw timedOut(body !== undefined)
    throw new WordPressError("unavailable", "Could not reach the WordPress REST API.")
  })
}

function json(response: Response) {
  return /\bjson\b/i.test(response.headers.get("content-type") ?? "")
}

async function received<S extends Schema.Decoder<unknown>>(
  schema: S,
  response: Response,
  options?: { signal: AbortSignal; writing?: boolean },
): Promise<S["Type"]> {
  const inspectNotFound = options !== undefined && response.status === 404
  if (!json(response) || (!response.ok && !inspectNotFound)) {
    await response.body?.cancel()
    if (response.status === 401)
      throw new WordPressError("authentication", "WordPress rejected the username or application password.")
    if (response.status === 403)
      throw new WordPressError(
        "forbidden",
        options?.writing ? "The WordPress account cannot edit this item." : "WordPress denied access to the REST API.",
      )
    if (response.status >= 300 && response.status < 400)
      throw new WordPressError("redirect", "WordPress redirected the REST request. Check the production URL.")
    if (response.status !== 404 && !response.ok)
      throw new WordPressError("unavailable", "The WordPress REST API returned an error.")
    throw new WordPressError("invalid-response", "The site did not return a WordPress REST response.")
  }
  const body: unknown = await response.json().catch(() => {
    if (options?.signal.reason instanceof DOMException && options.signal.reason.name === "TimeoutError")
      throw timedOut(options.writing === true)
  })
  if (inspectNotFound) {
    const error = Schema.decodeUnknownOption(RestError)(body)
    if (error._tag === "Some" && error.value.code === "rest_post_invalid_id") throw contentNotFound()
    throw new WordPressError("invalid-response", "The WordPress REST route was not found. Check the site connection.")
  }
  const decoded = Schema.decodeUnknownOption(schema)(body)
  if (decoded._tag === "None")
    throw new WordPressError("invalid-response", "The site did not return a WordPress REST response.")
  return decoded.value
}

function contentNotFound() {
  return new WordPressError("not-found", "This WordPress content could not be found.")
}

function timedOut(writing: boolean) {
  return new WordPressError(
    "timeout",
    writing
      ? "WordPress did not confirm the update in time. Read the item before attempting another edit."
      : "The WordPress REST API request timed out.",
  )
}

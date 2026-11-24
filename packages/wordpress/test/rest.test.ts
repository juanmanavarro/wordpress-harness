import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Schema } from "effect"
import {
  connect,
  getContent,
  listContent,
  listPages,
  readPage,
  updateContent,
  UpdateContentInput,
} from "../src/rest.js"

const credentials = { username: "editor", applicationPassword: "abcd efgh" }
const site = "https://example.test/blog/"
const signal = new AbortController().signal
const key = "Basic " + Buffer.from("editor:abcdefgh").toString("base64")

function transport(reply: (url: URL, options: RequestInit) => Response | Promise<Response>) {
  return Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => reply(new URL(String(input)), options ?? {}),
    { preconnect: fetch.preconnect },
  )
}

test("discovers the REST root and verifies the WordPress username and application password", async () => {
  const fetcher = transport((url, options) => {
    const headers = new Headers(options.headers)
    if (options.method === "HEAD") {
      expect(url.href).toBe(site)
      expect(headers.has("authorization")).toBe(false)
      return new Response(null, {
        headers: { link: '<https://example.test/blog/?rest_route=/>; rel="https://api.w.org/"' },
      })
    }
    expect(url.origin).toBe("https://example.test")
    expect(url.searchParams.get("rest_route")).toBe("/wp/v2/users/me")
    expect(headers.get("authorization")).toBe(key)
    return Response.json({ id: 42, username: "editor" })
  })
  expect(await connect(site, credentials, signal, fetcher)).toEqual({
    username: "editor",
    restUrl: "https://example.test/blog/?rest_route=/",
  })
})

test("keeps credentials at the configured origin and reports an authentication failure", async () => {
  const fetcher = transport((url, options) => {
    if (options.method === "HEAD")
      return new Response(null, { headers: { link: '<https://other.test/wp-json/>; rel="https://api.w.org/"' } })
    expect(url.href).toStartWith(site + "wp-json/wp/v2/users/me?")
    expect(options.redirect).toBe("manual")
    return Response.json({ code: "rest_not_logged_in" }, { status: 401 })
  })
  await expect(connect(site, credentials, signal, fetcher)).rejects.toMatchObject({ code: "authentication" })
})

test("selects a page by its slug when several pages have the same title", async () => {
  const contact = { id: 1, slug: "contact", title: { rendered: "Contact" }, link: site + "contact" }
  const help = { ...contact, id: 2, slug: "support", link: site + "support" }
  const fetcher = transport((url, options) => {
    expect(url.origin).toBe("https://example.test")
    expect(new Headers(options.headers).get("authorization")).toBe(key)
    if (url.searchParams.get("search") === "Contact") return Response.json([contact, help])
    if (url.searchParams.get("slug") === "support") return Response.json([help])
    expect(url.pathname).toBe("/blog/wp-json/wp/v2/pages/2")
    return Response.json({ ...help, content: { rendered: "<p>Talk to support.</p>" } })
  })
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const result = await readPage(access, { query: "Contact" }, signal, fetcher)
  expect(result).toMatchObject({ status: "choose", candidates: [{ slug: "contact" }, { slug: "support" }] })
  expect(await readPage(access, { query: "support", by: "slug" }, signal, fetcher)).toMatchObject({
    status: "found",
    page: { id: 2, content: "<p>Talk to support.</p>" },
  })
})

test("lists page titles without requiring a matching search term or a slug", async () => {
  const link = site + "services/"
  const fetcher = transport((url, options) => {
    expect(url.pathname).toBe("/blog/wp-json/wp/v2/pages")
    expect(url.searchParams.has("search")).toBe(false)
    expect(url.searchParams.has("slug")).toBe(false)
    expect(url.searchParams.get("page")).toBe("2")
    expect(new Headers(options.headers).get("authorization")).toBe(key)
    return Response.json([{ id: 42, slug: "services", link, title: { rendered: "Services" } }], {
      headers: { "x-wp-totalpages": "3" },
    })
  })

  expect(await listPages({ ...credentials, restUrl: site + "wp-json/" }, { page: 2 }, signal, fetcher)).toEqual({
    pages: [{ id: 42, slug: "services", link, title: "Services" }],
    nextPage: 3,
  })
})

const entry = {
  id: 42,
  slug: "contact",
  link: site + "contact/",
  status: "publish",
  title: { rendered: "Contact", raw: "Contact" },
  content: { rendered: "<p>Hours</p>", raw: "<!-- wp:paragraph --><p>Hours</p><!-- /wp:paragraph -->" },
  excerpt: { rendered: "<p>Summary</p>", raw: "Summary" },
}

test("searches published posts using the discovered plain-permalink REST root", async () => {
  const plain = { ...credentials, restUrl: site + "?rest_route=/" }
  const fetcher = transport((url) => {
    expect(url.pathname).toBe("/blog/")
    expect(url.searchParams.get("rest_route")).toBe("/wp/v2/posts")
    expect(url.searchParams.get("status")).toBe("publish")
    expect(url.searchParams.get("search")).toBe("contact")
    expect(url.searchParams.get("page")).toBe("2")
    return Response.json([entry], { headers: { "x-wp-totalpages": "3" } })
  })
  expect(await listContent(plain, { kind: "posts", search: "contact", page: 2 }, signal, fetcher)).toEqual({
    items: [{ id: 42, slug: "contact", link: site + "contact/", title: "Contact" }],
    nextPage: 3,
  })
})

test("reads editable block markup by ID and keeps unpublished records out of the published view", async () => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const fetcher = transport((url) => {
    expect(url.pathname).toBe("/blog/wp-json/wp/v2/pages/42")
    return Response.json({ ...entry, status: "draft" })
  })
  const result = await getContent(
    access,
    { kind: "pages", id: 42, view: "editable" },
    signal,
    transport((url, options) => {
      expect(url.searchParams.get("context")).toBe("edit")
      return fetcher(url, options)
    }),
  )
  expect(result).toMatchObject({
    id: 42,
    status: "draft",
    content: "<!-- wp:paragraph --><p>Hours</p><!-- /wp:paragraph -->",
  })
  await expect(getContent(access, { kind: "pages", id: 42 }, signal, fetcher)).rejects.toMatchObject({
    code: "not-found",
  })
})

test.each(["pages", "posts"] as const)("updates only the supplied editable fields on %s", async (kind) => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const patch = { title: "Contacto", excerpt: "", status: "draft", slug: "different" }
  const fetcher = transport((url, options) => {
    expect(url.pathname).toBe(`/blog/wp-json/wp/v2/${kind}/42`)
    expect(url.searchParams.get("context")).toBe("edit")
    expect(options.method).toBe("POST")
    expect(options.redirect).toBe("manual")
    expect(new Headers(options.headers).get("content-type")).toBe("application/json")
    expect(new Headers(options.headers).get("authorization")).toBe(key)
    expect(options.body).toBe('{"title":"Contacto","excerpt":""}')
    return Response.json({ ...entry, title: { raw: "Contacto" }, excerpt: { raw: "" } })
  })
  expect(await updateContent(access, { kind, id: 42, patch }, signal, fetcher)).toEqual({
    id: 42,
    slug: "contact",
    link: site + "contact/",
    status: "publish",
    title: "Contacto",
    content: "<!-- wp:paragraph --><p>Hours</p><!-- /wp:paragraph -->",
    excerpt: "",
  })
})

test("rejects an invalid target or an update without any editable field", () => {
  const decode = Schema.decodeUnknownOption(UpdateContentInput)
  expect(decode({ kind: "users", id: 42, patch: { title: "Contacto" } })._tag).toBe("None")
  expect(decode({ kind: "pages", id: 0, patch: { title: "Contacto" } })._tag).toBe("None")
  expect(decode({ kind: "pages", id: 42, patch: { status: "draft" } })._tag).toBe("None")
})

test("rejects invalid calls to the REST client before sending any request", async () => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const fetcher = transport(() => {
    throw new Error("Invalid content arguments reached the WordPress transport")
  })
  await expect(listContent(access, { kind: "posts", page: -1 }, signal, fetcher)).rejects.toMatchObject({
    code: "invalid-input",
  })
  await expect(getContent(access, { kind: "pages", id: 0 }, signal, fetcher)).rejects.toMatchObject({
    code: "invalid-input",
  })
  await expect(updateContent(access, { kind: "pages", id: 42, patch: {} }, signal, fetcher)).rejects.toMatchObject({
    code: "invalid-input",
  })
})

test.each([
  [401, "authentication"],
  [403, "forbidden"],
  [404, "invalid-response"],
  [302, "redirect"],
  [200, "invalid-response"],
] as const)("reports an actionable write failure for a WordPress response with status %s", async (status, code) => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const fetcher = transport(() => new Response("<html>Unexpected</html>", { status }))
  await expect(
    updateContent(access, { kind: "pages", id: 42, patch: { title: "Contacto" } }, signal, fetcher),
  ).rejects.toMatchObject({ code })
})

test("distinguishes missing content from a broken REST route", async () => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  const missingItem = transport(() => Response.json({ code: "rest_post_invalid_id" }, { status: 404 }))
  const missingRoute = transport(() => Response.json({ code: "rest_no_route" }, { status: 404 }))
  await expect(getContent(access, { kind: "posts", id: 42 }, signal, missingItem)).rejects.toMatchObject({
    code: "not-found",
  })
  await expect(listContent(access, { kind: "posts" }, signal, missingRoute)).rejects.toMatchObject({
    code: "invalid-response",
  })
})

test("reports an unconfirmed update after a timeout and does not resend it", async () => {
  const access = { ...credentials, restUrl: site + "wp-json/" }
  let writes = 0
  const fetcher = transport((_url, options) => {
    writes += 1
    options.signal?.throwIfAborted()
    throw new Error("Expected an aborted request")
  })
  const expired = AbortSignal.abort(new DOMException("Request expired", "TimeoutError"))
  await expect(
    updateContent(access, { kind: "pages", id: 42, patch: { title: "Contacto" } }, expired, fetcher),
  ).rejects.toMatchObject({
    code: "timeout",
    message: expect.stringContaining("Read the item"),
  })
  expect(writes).toBe(1)
})

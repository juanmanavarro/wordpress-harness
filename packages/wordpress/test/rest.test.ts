import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { connect, listPages, readPage } from "../src/rest.js"

const credentials = { username: "editor", applicationPassword: "abcd efgh" }
const site = "https://example.test/blog/"
const signal = new AbortController().signal
const key = "Basic " + Buffer.from("editor:abcdefgh").toString("base64")

function transport(reply: (url: URL, options: RequestInit) => Response) {
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

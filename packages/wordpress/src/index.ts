import pkg from "../package.json" with { type: "json" }

export { skills } from "./skills.js"
export { connect, listPages, readPage, PageList, PageRead, WordPressError } from "./rest.js"

export const WORDPRESS_BUNDLE_VERSION: string = pkg.version

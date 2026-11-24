import { Effect } from "effect"
import { purgeLegacyProjects } from "../../project/purge-legacy.js"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261124153425_wordpress-projects",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`wordpress_url\` text;`)
      yield* tx.run(`ALTER TABLE \`project\` ADD \`wordpress_directory\` text;`)
      yield* purgeLegacyProjects(tx)
    })
  },
}

export default migration

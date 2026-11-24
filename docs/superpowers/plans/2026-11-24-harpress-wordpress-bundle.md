# Paquete WordPress integrado en Harpress

> Para quien implemente este plan, usar `superpowers:executing-plans` y completar las tareas en orden. Los pasos se marcan con casillas. Este documento propone la implementación, todavía no modifica el producto.

**Goal** — Instalar Harpress y disponer de las skills y del MCP de WordPress, con la conexión del sitio como configuración del cliente.

**Architecture** — Crear el paquete privado `@harpress/wordpress` en `packages/wordpress` e importarlo como plugin interno del motor. El paquete incluye las skills como texto compilado y sirve un MCP mediante HTTP en loopback dentro del proceso del motor, con puerto asignado por el sistema y token efímero. El motor lo registra mediante `ctx.mcp.transform` y conserva su descubrimiento de herramientas, permisos y ciclo de conexión existentes.

**Tech Stack** — TypeScript, Effect, SDK de plugins del fork, SDK MCP ya presente en el monorepo, Bun para compilar el motor y Electron para distribuir la aplicación.

**Spec** — El alcance propuesto está definido en la sección siguiente de este mismo documento, a partir de la petición de incluir skills y MCP desde la instalación.

## Alcance propuesto

La entrega incluye un paquete interno versionado con la aplicación, tres skills propias, un MCP funcional y la conexión de WordPress mediante la pantalla de integraciones existente. El cliente introduce URL, usuario y contraseña de aplicación. La cuenta del proveedor de modelos sigue siendo una configuración independiente.

Las skills iniciales serán `harpress-wordpress`, para reconocer el sitio y elegir herramientas, `harpress-wordpress-content`, para editar páginas y entradas, y `harpress-wordpress-verify`, para comprobar el resultado. Su contenido describirá únicamente capacidades implementadas. Se redactarán para operaciones sobre sitios conectados y no requerirán WP-CLI, PHP ni acceso al disco del servidor.

El MCP inicial ofrecerá cinco herramientas, `list_sites`, `get_site`, `list_content`, `get_content` y `update_content`. La edición se limita a título, contenido y extracto de páginas y entradas existentes. Conserva su estado de publicación. Crear, borrar o publicar contenido, editar Elementor, modificar PHP, instalar plugins y mantener WordPress quedan para módulos posteriores.

El conector inicial utiliza la REST API nativa y contraseñas de aplicación sobre HTTPS. No exige un plugin adicional en los sitios compatibles. REST bloqueada, autenticación deshabilitada y permisos insuficientes se mostrarán como errores de conexión o de operación con una explicación útil.

## Global Constraints

- El usuario final no instala skills, MCP, Node, Bun, Python ni herramientas de terminal.
- El paquete se distribuye dentro del motor compilado de Harpress y funciona sin el checkout del proyecto.
- No hay descargas de paquetes, `npx` ni instalación dinámica durante el primer arranque.
- Las skills y el catálogo MCP están disponibles incluso sin un sitio conectado. En ese estado, `list_sites` devuelve una lista vacía.
- Cada operación sobre contenido recibe un `siteId` explícito, derivado de la conexión guardada. Cambiar la cuenta activa no cambia el destino de una llamada ya iniciada.
- Los secretos se resuelven desde las credenciales del motor y no aparecen en argumentos de herramientas, respuestas MCP, prompts, URLs ni logs.
- El paquete depende del SDK público y de Schema. No importa Core ni Server. El adaptador interno de Core puede consumir el paquete.
- Las APIs del servidor conservan su activación asíncrona actual. Un fallo del módulo no bloquea el arranque general de Harpress.
- Se conservan las configuraciones y extensiones del usuario. Los identificadores internos usan el prefijo `harpress` para evitar colisiones.
- La incorporación del paquete no renombra los paquetes internos `@opencode/*` ni cambia los identificadores de configuración existentes.
- La implementación no incluye publicar, desplegar, hacer push ni modificar sitios reales durante las pruebas automáticas.

## Review Focus

- Instalación limpia sin runtimes ni checkout. La prueba del artefacto en la tarea 6 debe demostrar que los recursos están realmente compilados.
- Dos sitios con el mismo ID de página. La tarea 3 prueba que una edición solo llega al `siteId` recibido.
- Credenciales revocadas o desconexión. Las tareas 2 y 3 prueban que dejan de usarse y no se filtran en errores.
- Recarga del plugin y cierre del motor. La tarea 4 prueba que se cierran servidor, conexiones y registros anteriores.
- Sitios en un subdirectorio y respuestas REST inválidas. La tarea 3 prueba resolución de la raíz REST, paginación y errores HTTP o HTML.

## Estructura de archivos

Los archivos nuevos se crean junto a sus tests. Los archivos existentes indicados son los puntos de integración comprobados en el fork.

| Archivo | Responsabilidad |
| --- | --- |
| `packages/wordpress/package.json`, `tsconfig.json` | Workspace privado, exports y comprobaciones |
| `packages/wordpress/src/index.ts` | Factoría del plugin y composición del módulo |
| `packages/wordpress/src/contracts.ts` | Tipos compartidos del sitio, contenido y acceso a credenciales |
| `packages/wordpress/src/skills.ts` y `skills/*/SKILL.md` | Catálogo y textos incluidos en compilación |
| `packages/wordpress/src/integration.ts` | Registro del formulario WordPress y resolución de conexiones |
| `packages/wordpress/src/rest.ts` | Cliente REST tipado, autenticación y normalización de errores |
| `packages/wordpress/src/mcp.ts` | Servidor MCP, herramientas y cierre de recursos |
| `packages/core/src/plugin/wordpress.ts` | Adaptador interno del paquete al motor |
| `packages/core/src/plugin/internal.ts`, `package.json` | Registro estático y dependencia workspace |
| `packages/desktop/script/build.ts` | Exigir el motor construido desde este fork |
| `packages/desktop/script/verify-wordpress-bundle.ts` | Comprobación funcional del motor empaquetado |
| `bun.lock` | Resolución de las dependencias del nuevo workspace |

## Tarea 1 — Paquete y skills compiladas

**Interfaces** — Exportar `WORDPRESS_BUNDLE_VERSION: string` y `skills: readonly Skill.Info[]`. Los IDs son los tres indicados en el alcance, con rutas virtuales `skill://harpress-wordpress/.../SKILL.md`. El paquete es privado y no se publica en npm.

- [ ] Crear `packages/wordpress/test/skills.test.ts` con `bundled_skills_have_stable_unique_ids`, que verifica los tres IDs, descripción y contenido no vacíos, y ausencia de referencias a comandos o archivos externos necesarios para ejecutarlas.
- [ ] Ejecutar `bun test test/skills.test.ts` desde `packages/wordpress` y comprobar que falla antes de añadir el catálogo.
- [ ] Crear el workspace siguiendo las opciones TypeScript del paquete de plugin existente y añadir las skills como imports de texto, siguiendo el precedente de `packages/core/src/plugin/skill.ts`. Inicialmente incluir solo SKILL.md autosuficientes, sin scripts auxiliares.
- [ ] Ejecutar de nuevo el test y `bun run typecheck` desde el nuevo paquete. Deben pasar. Actualizar `bun.lock` mediante la instalación workspace.
- [ ] Revisar el diff de esta tarea. Si se solicitan commits durante la ejecución, preparar únicamente sus archivos con mensaje `feat(wordpress): bundle WordPress skills`.

## Tarea 2 — Conexión de sitios con las integraciones existentes

**Interfaces** — Definir `SiteInfo = { id: string; name: string; url: string }` y `SiteAccess = { site: SiteInfo; username: string; applicationPassword: string }` en `src/contracts.ts`. Definir `SiteStore` con `list(): Promise<readonly SiteInfo[]>` y `resolve(siteId: string): Promise<SiteAccess>`. Exportar `registerIntegration(ctx: Context): Effect.Effect<SiteStore, unknown, Scope.Scope>` desde `src/integration.ts`.

- [ ] Crear `test/integration.test.ts`. `site_connections_are_distinct` guarda dos conexiones y resuelve cada una por su identificador. `disconnected_credentials_are_unavailable` comprueba que una conexión borrada ya no se resuelve. `public_site_info_excludes_credentials` comprueba que el listado nunca contiene contraseña.
- [ ] Ejecutar `bun test test/integration.test.ts` y comprobar los fallos iniciales.
- [ ] Registrar la integración `harpress-wordpress` mediante `ctx.integration.transform`. Usar un método `key`, cuya clave es la contraseña de aplicación, y campos de formulario `url`, `username` y `name`, guardados como metadata. Seguir el precedente de `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts` para los campos y metadata.
- [ ] Implementar `SiteStore` con las APIs existentes de conexiones y credenciales. Usar el identificador estable de conexión como `siteId`, resolver en cada llamada y admitir varias conexiones. Comprobar el almacenamiento actual antes de describir sus garantías en la UI, sin introducir un segundo almacén de contraseñas.
- [ ] Verificar en la pantalla de integraciones que se puede añadir, volver a abrir y desconectar WordPress. Si el formulario genérico no expone algún campo o la integración, corregir ese punto con los componentes existentes, sin crear un panel de sitios independiente.
- [ ] Ejecutar los tests de integración y typecheck. Revisar que el paquete no importa Core ni Server. Mensaje de commit previsto `feat(wordpress): add site connections`.

## Tarea 3 — Conector REST de páginas y entradas

**Interfaces** — En `contracts.ts`, definir `ContentKind = "pages" | "posts"`, `ContentPatch = { title?: string; content?: string; excerpt?: string }` y `ContentItem = { id: number; kind: ContentKind; title: string; content: string; excerpt: string; status: string; modified: string; link: string }`. Exportar `createRestClient(access: SiteAccess, fetcher?: typeof fetch): WordPressRest` desde `rest.ts`. Definir `WordPressRest` con `getSite(): Promise<SiteInfo & { restUrl: string }>`, `listContent(input: { kind: ContentKind; page: number; search?: string }): Promise<{ items: readonly ContentItem[]; page: number; totalPages: number }>`, `getContent(input: { kind: ContentKind; id: number }): Promise<ContentItem>` y `updateContent(input: { kind: ContentKind; id: number; patch: ContentPatch }): Promise<ContentItem>`. `title`, `content` y `excerpt` contienen los valores editables `raw` de WordPress.

- [ ] Crear `test/rest.test.ts` con un servidor HTTP de fixture. Cubrir autenticación, sitio instalado en subdirectorio, contenido en contexto `edit`, paginación, 401, 403, timeout y respuesta HTML en lugar de JSON. Las conexiones de producción requieren HTTPS, el fixture utiliza transporte inyectado.
- [ ] Añadir `same_content_id_on_two_sites_edits_only_requested_site`. Dos servidores tienen la página 42, y editar el sitio A deja B intacto. Añadir `update_preserves_status_and_unmodified_fields` y `redirect_does_not_forward_credentials_to_another_origin`.
- [ ] Ejecutar `bun test test/rest.test.ts` y comprobar fallos iniciales.
- [ ] Implementar el cliente REST usando la URL raíz del sitio y el enlace de descubrimiento REST cuando esté disponible. Pedir contenido editable y enviar únicamente los campos del patch, conservando el estado. Resolver los secretos mediante `SiteStore` al iniciar cada operación, con una única instantánea del destino.
- [ ] Normalizar errores con códigos estables `not_connected`, `unauthorized`, `forbidden`, `unavailable` e `invalid_response`. Incluir mensajes útiles sin cabeceras Authorization ni secretos. No reenviar credenciales a otro origen en redirects.
- [ ] Ejecutar los tests y typecheck. Mensaje de commit previsto `feat(wordpress): add REST content adapter`.

## Tarea 4 — MCP incluido y ciclo de vida

**Interfaces** — Exportar `startMcp(input: { sites: SiteStore }): Promise<{ url: string; token: string; close(): Promise<void> }>` desde `src/mcp.ts`. Usar transporte Streamable HTTP del SDK MCP compatible con el cliente del fork. Las herramientas se registran como `list_sites`, `get_site`, `list_content`, `get_content`, `update_content`. Todas salvo el listado de sitios reciben `siteId`; las de contenido también reciben `kind` y, cuando corresponda, `id` y `patch`.

- [ ] Crear `test/mcp.test.ts` con un cliente MCP real. Verificar negociación, descubrimiento de las cinco herramientas, listado vacío sin conexiones, lectura y edición contra el fixture de la tarea 3. Comprobar que entradas desconocidas o un patch vacío se rechazan antes de enviar una petición REST.
- [ ] Añadir tests de token ausente o incorrecto y `close_releases_listener`. El listener debe enlazar únicamente `127.0.0.1` en un puerto asignado por el sistema, sin acceso desde otras interfaces. Validar Host y Origin en el transporte local.
- [ ] Ejecutar `bun test test/mcp.test.ts` y confirmar los fallos iniciales.
- [ ] Implementar el servidor usando las versiones MCP ya presentes en el repo. Compartir las funciones REST de la tarea 3. Marcar lecturas y escritura correctamente en sus annotations. No ofrecer una herramienta genérica de ejecución de comandos o HTTP arbitrario.
- [ ] Exportar `createPlugin(): Plugin` desde `src/index.ts`. Registrar skills e integración, arrancar el MCP en el scope del plugin y registrar `harpress-wordpress` con `ctx.mcp.transform`, tipo `remote`, URL loopback, `oauth: false` y cabecera Bearer del token efímero. La etiqueta `remote` es del transporte del motor, el servidor corre localmente.
- [ ] Liberar el listener al descargar o recargar el plugin. Tratar los fallos del módulo con el mecanismo existente de diagnóstico sin detener Harpress. Verificar que dos instancias usan puertos y tokens distintos.
- [ ] Ejecutar todos los tests del paquete y typecheck. Mensaje de commit previsto `feat(wordpress): embed WordPress MCP server`.

## Tarea 5 — Registro interno y permisos del motor

**Interfaces** — `packages/core/src/plugin/wordpress.ts` exporta `Plugin` a partir de `createPlugin()`. El registro usa el ID `harpress.wordpress` y origen builtin. No escribe entradas permanentes en el `opencode.json` del cliente.

- [ ] Crear `packages/core/test/plugin/wordpress.test.ts` reutilizando los fixtures de plugins. Comprobar que un perfil limpio descubre las tres skills y el MCP builtin sin plugins instalados.
- [ ] Añadir `reload_does_not_duplicate_wordpress_registration` y una prueba del recorrido real de permisos del motor, denegar `update_content` evita que el fixture reciba la escritura. Conservar las decisiones existentes de permisos del usuario.
- [ ] Ejecutar `bun run test test/plugin/wordpress.test.ts` desde `packages/core` y confirmar los fallos iniciales.
- [ ] Añadir la dependencia workspace y el adaptador. Registrar el plugin junto a los builtins en `internal.ts`, con el MCP por defecto antes de aplicar la configuración MCP del usuario para respetar su desactivación explícita. Verificar el orden efectivo en el test.
- [ ] Ejecutar el test nuevo y las regresiones `bun run test test/plugin/skill.test.ts test/plugin/mcp-codemode-defaults.test.ts` desde Core. Todos deben pasar. Mensaje de commit previsto `feat(core): register Harpress WordPress bundle`.

## Tarea 6 — Instalador y prueba desde un perfil limpio

**Interfaces** — `verify-wordpress-bundle.ts` recibe la ruta al ejecutable compilado como argumento y termina con código 0 únicamente si ese motor expone las skills y el MCP esperados. Usa un perfil temporal, los APIs existentes de lectura y readiness del motor y limpia procesos al terminar.

- [ ] Añadir tests de política de build en `packages/desktop/script/build.test.ts`, extraer la decisión de selección del motor si hace falta. La ausencia del motor local debe fallar con un mensaje accionable y nunca descargar un motor original que no incluya WordPress.
- [ ] Ejecutar `bun run test script/build.test.ts` desde Desktop y confirmar el fallo inicial.
- [ ] Actualizar `packages/desktop/script/build.ts` para exigir el motor del fork en todos los artefactos distribuibles. Conservar el flujo de desarrollo desde fuentes. Las skills y el servidor MCP se incluyen en el motor compilado, sin un segundo ejecutable ni rutas absolutas del checkout.
- [ ] Crear y ejecutar la comprobación funcional del ejecutable. Confirmar que puede leer los textos de las skills y negociar MCP sin instalar dependencias. Integrar la comprobación en el build de Desktop antes de generar el instalador.
- [ ] Ejecutar `bun run check` desde la raíz. Ejecutar todos los tests de `packages/wordpress`, el test de integración Core y los de build Desktop desde sus paquetes. No ejecutar `bun test` en la raíz.
- [ ] Construir el motor para la plataforma actual con `bun run script/build.ts --single` desde `packages/cli` y ejecutar el build y pack de Desktop con sus scripts existentes. Verificar el artefacto real con usuario limpio, sin repositorio, sin Node/Bun en PATH y sin skills o MCP globales. Repetir el smoke del artefacto en cada sistema operativo que vaya a distribuirse, informando cuáles se han probado realmente.
- [ ] Probar desde el instalador la conexión de un WordPress de pruebas, lectura de una página, edición por chat y verificación por segunda lectura. Cerrar y abrir Harpress y comprobar que conserva la conexión y recarga el paquete sin duplicados.
- [ ] Revisar el diff final, documentar el flujo y límites del módulo en `packages/wordpress/README.md`. Mensaje de commit previsto `build(desktop): ship the Harpress WordPress engine`.

## Criterio de entrega

En una máquina limpia, instalar Harpress proporciona automáticamente las tres skills y el MCP. Después de conectar un sitio de pruebas, una conversación puede leer y modificar el título o contenido de una página y comprobar el resultado. Las actualizaciones de Harpress actualizan el paquete interno conservando las conexiones guardadas. El informe de entrega distingue comprobaciones del código, pruebas de desarrollo y pruebas efectivas del instalador.

## Referencias

- [SDK de plugins del servidor OpenCode](https://opencode.ai/docs/build/plugins/server/), para registros de skills, MCP e integraciones. Los tipos del fork son la referencia al implementar.
- [Autenticación REST de WordPress](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/), para contraseñas de aplicación sobre HTTPS.
- [Páginas REST de WordPress](https://developer.wordpress.org/rest-api/reference/pages/), para lectura y actualización de contenido.
- [Skills oficiales de WordPress](https://github.com/WordPress/agent-skills), como referencia para futuras capacidades de desarrollo. Cualquier contenido incorporado deberá conservar su licencia y procedencia.

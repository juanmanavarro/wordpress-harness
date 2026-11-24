# Acceso del agente a la REST API de WordPress

> Para implementar el plan, usar `superpowers:executing-plans` y completar las tareas en orden.

**Objetivo** — Buscar, leer y editar páginas y entradas existentes desde el chat del proyecto WordPress en Harpress.

**Arquitectura** — `@harpress/wordpress` adapta la REST API nativa. `ProjectWordPress` resuelve la conexión guardada del proyecto y el plugin `harpress.wordpress` registra las operaciones como herramientas nativas compatibles con Code Mode.

**Tecnología** — TypeScript, Effect Schema, Bun y contraseñas de aplicación de WordPress sobre HTTPS.

## Alcance propuesto

Harpress ya conecta cada proyecto a un sitio y expone `wordpress_list_pages` y `wordpress_read_page` para páginas publicadas. La conexión guarda la raíz REST descubierta y la cuenta de WordPress. Las tres herramientas propuestas amplían esa integración.

| Herramienta | Entrada | Resultado |
| --- | --- | --- |
| `wordpress_list_content` | `kind: pages \| posts`, `page?`, `search?` | Resúmenes de contenido publicado con ID, slug, título y enlace. Incluye `nextPage` cuando quedan resultados. |
| `wordpress_get_content` | `kind`, `id`, `view?: published \| editable` | Contenido publicado por defecto. En modo `editable`, campos `raw` y estado para preparar y verificar una edición. |
| `wordpress_update_content` | `kind`, `id`, `patch: { title?, content?, excerpt? }` | ID, enlace, estado y valores guardados de los campos enviados. |

Los nombres equivalentes en Code Mode son `wordpress.list_content`, `wordpress.get_content` y `wordpress.update_content`. `kind` selecciona las colecciones nativas `/wp/v2/pages` y `/wp/v2/posts`. El proyecto activo determina el sitio y los resultados del listado permiten resolver el ID. [Referencia de páginas](https://developer.wordpress.org/rest-api/reference/pages/) · [Referencia de entradas](https://developer.wordpress.org/rest-api/reference/posts/)

El primer alcance cubre edición de contenido existente. Crear, publicar, borrar, gestionar medios, WooCommerce o editar campos propios de Elementor requieren ampliar el catálogo. Las herramientas tipadas permiten dar permisos distintos a cada operación y validar los datos antes de tocar el sitio. Un cliente REST genérico tendría más cobertura, pero exigiría definir qué rutas y métodos se pueden usar con las credenciales del proyecto. El plan anterior ya recoge la opción de distribuir un MCP y sirve de antecedente para el alcance editorial. [Plan del paquete integrado](2026-11-24-harpress-wordpress-bundle.md)

## Reglas de la integración

- Usar la contraseña de aplicación guardada en el proyecto, con peticiones HTTPS a su origen y redirecciones manuales. Mantener las credenciales dentro del motor. [Autenticación REST de WordPress](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- Mantener los nombres, esquemas y permiso de las dos herramientas de lectura existentes. Aplicar `wordpress_read_page` a la lectura publicada, `wordpress_read_editable_content` a la lectura en contexto `edit` y `wordpress_update_content` a la escritura. Autorizar la lectura editable y autorizar la escritura son decisiones independientes.
- Pedir autorización de lectura editable por defecto en el motor, con un recurso que identifica el proyecto, el tipo y el ID. Cada escritura requiere una confirmación nueva, incluso con aprobación automática de permisos. El formulario muestra el sitio y los campos afectados y requiere una respuesta del cliente. El agente Plan tiene la escritura denegada.
- Encapsular las herramientas nuevas detrás de `wordpress_content_api`. Usar las reglas habituales de activación experimental del proyecto. Mantener el catálogo y las instrucciones de sesión alineados con la disponibilidad de las herramientas.
- Tratar los valores devueltos por WordPress como datos. Para cambios de contenido, usar el valor `raw` y preservar los bloques y el marcado que queden fuera de la edición solicitada.

## Tarea 1. Ampliar el cliente REST

**Archivos** — `packages/wordpress/src/rest.ts`, `packages/wordpress/src/index.ts`, `packages/wordpress/test/rest.test.ts`.

- [x] Añadir pruebas que comprueben la búsqueda de entradas con paginación, la lectura por ID con `context=edit`, una edición que envía exclusivamente `{ "title": "Contacto" }` y la conservación del estado y de los demás campos. Cubrir un sitio en subdirectorio con `?rest_route=` y otro con `/wp-json/`.
- [x] Añadir los esquemas y funciones `listContent(access, { kind, search?, page? }, signal)`, `getContent(access, { kind, id, view? }, signal)` y `updateContent(access, { kind, id, patch }, signal)`. Reutilizar el transporte y la decodificación existentes. Para editar, usar `POST /wp/v2/{kind}/{id}` con JSON y devolver el contenido editable que WordPress guardó.
- [x] Fijar los casos de entrada y respuesta. Un ID inválido o un patch vacío termina antes de la petición. La lectura publicada comprueba `status: publish` también al consultar por ID. `excerpt: ""` borra el extracto. Las propiedades ajenas a `title`, `content` y `excerpt` jamás llegan al cuerpo de escritura. Distinguir 401, 403, 404, redirección, timeout y respuesta no REST. Un timeout de escritura informa que el resultado es incierto y requiere una lectura antes de repetirla.
- [x] Ejecutar `bun test test/rest.test.ts` y `bun typecheck` desde `packages/wordpress`.

## Tarea 2. Conectar las operaciones al proyecto y a los permisos

**Archivos** — `packages/core/src/project/wordpress.ts`, `packages/core/src/plugin/wordpress.ts`, `packages/core/src/plugin/plan.ts`, `packages/schema/src/agent.ts`, `packages/schema/src/config/flag.ts` y `packages/core/test/plugin/wordpress.test.ts`.

- [x] Añadir `listContent`, `getContent` y `updateContent` a `ProjectWordPress` usando `withConnectedSite`. El destino sale de `location.project.id` y la conexión guardada. Resolver la conexión al ejecutar y comprobar que sigue siendo la del sitio mostrado en la solicitud antes de escribir si hubo una aprobación pendiente.
- [x] Registrar las tres herramientas bajo el namespace `wordpress` y la bandera `wordpress_content_api`. Mantener los endpoints existentes de Harpress para conectar, desconectar y consultar el sitio. Si la bandera cambia un esquema público consumido por el cliente, regenerar con `bun run generate` desde `packages/client`.
- [x] Usar `Permission.assert` con `Permission.invocation(context)` para las lecturas. Definir el valor por defecto `ask` para `wordpress_read_editable_content` después del `allow` general de los agentes y `deny` para escritura en Plan. Aplicar `Permission.assertNotDenied` y pedir confirmación con `Form.ask` antes de cada `POST` en Code Mode y ejecución directa. Solo una respuesta explícita de guardado permite continuar.
- [x] Probar el registro con la bandera activa e inactiva, y que la lectura original sigue disponible. Verificar con el servicio real de permisos que una aprobación guardada de lectura editable deja pendiente el permiso de escritura y que rechazar la escritura deja cero `POST`. Aprobar una edición en el proyecto A debe producir una única escritura en A aunque B tenga el mismo ID. Cubrir la desconexión y el cambio de URL mientras se espera la decisión.
- [x] Ejecutar `bun run test test/plugin/wordpress.test.ts test/plugin/permission-assert.test.ts` y `bun typecheck` desde `packages/core`.

## Tarea 3. Enseñar al agente el flujo y probarlo en Harpress

**Archivos** — `packages/core/src/plugin/wordpress.ts` y las tres skills de `packages/wordpress/skills/`.

- [x] Actualizar las instrucciones para que el agente localice el contenido, aclare coincidencias ambiguas por título y enlace, lea la versión editable, indique el cambio previsto y use la herramienta de escritura. Después, hacer una segunda lectura para verificar los campos y presentar el enlace. Si WordPress no concede acceso, indicar si procede revisar la conexión o los permisos de la cuenta.
- [x] Ejecutar `bun test` desde `packages/wordpress` y `bun run check` desde la raíz. Conectar un WordPress de pruebas con un proyecto nuevo y probar las herramientas del motor con una página de bloques y una entrada. Verificar las opciones del formulario en ambas variantes de la interfaz. Comprobar el catálogo de herramientas con la bandera activada y la carga de las skills en un perfil limpio del motor empaquetado.

## Criterio de entrega

En un proyecto conectado de pruebas, «Cambia el título de la página Contacto a Contacta con nosotros» identifica la página correcta, solicita permiso, escribe solo el título y confirma por una segunda lectura que WordPress guardó el cambio y mantuvo el estado. Al rechazar la solicitud, el contenido queda intacto.

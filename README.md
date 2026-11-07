# WeatherMapZ Backend

Backend de WeatherMapZ con Node.js + Express.

## Requisitos

- Node.js 22 o superior
- npm
- Docker (para la base de datos PostgreSQL/PostGIS que usan los usuarios y los imports de datos
  urbanos)

## Instalación

```bash
npm install
cp .env.example .env      # después, rellena DB_PASSWORD, ORS_API_KEY y JWT_SECRET
```

## Base de datos (PostGIS)

`docker-compose.yml` arranca `postgis/postgis:17-3.5` con un volumen persistente `pgdata`. En el
primer arranque también crea la base de datos de test (`DB_TEST_NAME`). Compose lee los valores
`DB_*` de `backend/.env`.

```bash
docker compose up -d db       # o: npm run db:up
npm run db:migrate            # base de datos de desarrollo
npm run db:migrate:test       # base de datos de test (los tests de integración también lo hacen solos)
```

Las migraciones están en `src/repositories/migrations` (sequelize-cli) y `npm run db:migrate`
aplica todas las pendientes, en orden:

| Migración | Crea |
| --- | --- |
| `20261006000001-enable-postgis` | extensión `postgis` |
| `20261006000002-create-import-tracking` | `import_runs`, `import_rejections` |
| `20261006000003-create-urban-elements` | `buildings`, `trees`, `street_segments` |
| `20261006000004-add-building-height-suspicious` | `buildings.height_suspicious` |
| `20261009000001-create-users` | `users` (PBI-4) |
| `20261019000001-create-associations` | `segment_trees`, `segment_buildings`, `association_runs`, `unassociated_elements` e índice `street_segments_geog_gist` |
| `20261106000002-create-green-areas` | `green_areas` (PBI-10) |
| `20261106000003-create-segment-vegetation` | `vegetation_runs`, `segment_vegetation` (PBI-10) |

Una base de datos que ya tenía las tres primeras migraciones solo necesita volver a ejecutar
`npm run db:migrate`; la columna nueva se añade con `false` en las filas existentes y
`npm run import:buildings` la rellena. Una base de datos con los datos de la PBI-3.1 ya cargados
solo necesita `npm run db:migrate` (aplica `20261019000001-create-associations`) y
`npm run associate`; no hace falta reimportar.

Todas las geometrías se guardan en EPSG:4326 con índices GIST.

### Tabla `buildings`

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | serial | Clave primaria |
| `source`, `source_id` | text | Origen (`idezar`) e `identifier` de IDEZAR; únicos en conjunto |
| `height_m` | double, not null | Altura usada para las sombras (ver ADR-001 en el `docs/DECISIONS.md` del workspace) |
| `height_source` | text | `measured`, `floors_estimate` o `default` |
| `height_suspicious` | boolean, por defecto `false` | Altura medida aceptada pero atípica, marcada para revisión |
| `floors` | smallint | `storeys_above_ground` (null si se desconoce o es 0) |
| `geom` | `geometry(MultiPolygon, 4326)` | Huella del edificio (índice GIST) |
| `import_run_id` | integer | Última ejecución de import que escribió la fila |

### Tabla `users`

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | serial | Clave primaria |
| `name` | varchar(100), not null | Nombre que se muestra en la aplicación |
| `email` | varchar(254), not null | Guardado en minúsculas; único sin distinguir mayúsculas (índice `users_email_lower_idx`) |
| `password_hash` | varchar(100) | Hash bcrypt de la contraseña (nunca la contraseña); null en cuentas creadas solo con Google |
| `google_id` | varchar(255), único | Identificador de la cuenta de Google vinculada; null si no se ha usado Google |
| `route_profiles_seeded` | boolean, not null | Si ya se le copiaron las rutas predefinidas (PBI-6) |
| `created_at`, `updated_at` | timestamptz | Fechas de alta y última modificación |

La restricción `users_credentials_check` obliga a que cada usuario tenga contraseña, cuenta de
Google o ambas.

## Imports de datos urbanos (PBI-3.1)

Se ejecutan después de las migraciones, en este orden:

```bash
npm run import:all            # edificios, árboles, red peatonal y zonas verdes (unos 20 minutos)
# o uno a uno:
npm run import:buildings      # IDEZAR citygml3d:building
npm run import:trees          # IDEZAR idezar_base:arboles_2022
npm run import:streets        # vías peatonales de OpenStreetMap vía Overpass, troceadas en tramos
npm run import:green-areas    # parques y jardines públicos de OpenStreetMap (PBI-10, unos 40 s)
```

Cada ejecución se guarda en `import_runs` con `source_count` (lo que anuncia la fuente),
`imported_count` y `rejected_count`. Cada registro rechazado se guarda con su motivo y sus datos
originales en `import_rejections`. Si importados + rechazados no coincide con el número de la
fuente, la ejecución queda en `mismatch` y el comando sale con código 1. Repetir un import
actualiza las filas existentes; nunca las duplica. Las fuentes, campos y licencias están en
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md), y las decisiones tomadas (altura de los edificios,
filtro de la red, troceo) en DECISIONS.md (ADR-001 a ADR-008), en la carpeta docs del Drive del
equipo (fuera de este repositorio).

Cada import, al empezar, marca como `stale` la última asociación a tramos de los tipos que puede
cambiar y avisa en el log: después de importar hay que volver a ejecutar `npm run associate`
(ver la sección siguiente y el ADR-010). `import:green-areas` no toca las asociaciones; deja
desactualizado el índice de vegetación (ver "Índice de vegetación por tramo").

### Atribución de los datos

Origen de los datos: Ayuntamiento de Zaragoza (IDEZAR), edificios: vigencia 2026-10-01;
arbolado: inventario 2022 (capa `arboles_2022`).

© OpenStreetMap contributors, ODbL.

## Asociación a tramos peatonales (PBI-3.2)

Después de los imports, `npm run associate` liga cada árbol y cada edificio a los tramos de
`street_segments` que tiene cerca. Todo se calcula en PostGIS (unos 3 minutos con los datos
reales):

```bash
npm run import:all            # 1. datos
npm run associate             # 2. árboles y edificios
npm run associate -- --type=trees       # o un solo tipo (--type=buildings)
```

1. **Tramo más cercano**, medido en metros (los edificios, desde su polígono). Si está a
   `ASSOC_MAX_NEAREST_M` (150 m) o menos, se guarda con `is_nearest = true`; si no, el elemento va a
   `unassociated_elements` con `reason = 'isolated'`, su tramo más cercano y la distancia
   (`no_segment` si no hay tramos, `invalid_geometry` si su geometría no es válida).
2. **Asociaciones por radio**: cada elemento asociado se liga además a todos los tramos que tiene
   a `R` metros o menos (`is_nearest = false`). Árboles: `R = ASSOC_TREE_RADIUS_M` (25 m).
   Edificios: `R = max(ASSOC_BUILDING_MIN_RADIUS_M (30 m), height_m × ASSOC_BUILDING_HEIGHT_FACTOR (1,5))`.

Cada tipo se recalcula desde cero en una transacción (repetir el comando da el mismo resultado) y
se guarda en `association_runs`. El comando imprime una tabla por tipo (total, asociados y %,
aislados, asociaciones por radio, tramos por elemento, media y p95 de la distancia, segundos) y
sale con código 1 si asociados + no asociados no coincide con el total, si algún elemento está en
las dos tablas (`mismatch`) o si un tipo queda por debajo de `ASSOC_MIN_PCT` (95 %,
`below_threshold`). Si la última ejecución de un tipo está en `stale`, un import posterior ha
podido cambiar los datos y hay que volver a ejecutar el comando. Los criterios y la medición que
los justifica: ver DECISIONS.md (PBI-3.2, ADR-009 y ADR-010) en la carpeta docs del Drive del
equipo.

| Tabla | Contenido |
| --- | --- |
| `segment_trees` | `segment_id`, `tree_id`, `distance_m`, `is_nearest`; PK `(segment_id, tree_id)`, un solo `is_nearest` por árbol |
| `segment_buildings` | lo mismo con `building_id` |
| `unassociated_elements` | `element_type` (`tree` / `building`), `element_id`, `nearest_segment_id`, `nearest_distance_m`, `reason`, `association_run_id` |
| `association_runs` | una fila por tipo y ejecución: `params`, `total`, `nearest_ok`, `isolated`, `no_segment`, `invalid_geometry`, `radius_links`, `pct_associated`, `avg_segments_per_element`, `status`, `details` |

Las claves foráneas a `street_segments`, `trees` y `buildings` son `ON DELETE CASCADE`: si un
import borra un elemento o un tramo, sus asociaciones desaparecen con él.

Como acceso general a PBI-3.2, `src/services/geo/associationService.js` ofrece
`getTreesBySegment(segmentId)`, `getBuildingsBySegment(segmentId)` y
`getNearestSegmentForElement(type, id)`, con `distance_m`, `is_nearest` y los atributos urbanos
(`height_m`, `height_source`, `crown_diameter_m`). PBI-5.2 no limita las sombras a estos enlaces:
su radio fijo puede quedarse corto con el Sol bajo, por lo que hace una preselección dinámica
según la longitud solar efectiva. Los endpoints de consulta están en la sección de la PBI-3.3.

## Consulta de elementos urbanos por tramo (PBI-3.3)

Cuatro endpoints de lectura que exponen las asociaciones de la PBI-3.2. Todos exigen sesión
(`Authorization: Bearer <token>`; sin ella, `401`) y devuelven los errores con el formato común
`{ "error": { "message", "fields"? } }`. No calculan nada al vuelo: "asociados o cercanos" es lo que
hay en `segment_trees` y `segment_buildings` (tramo más cercano + radio). Las decisiones: ver
DECISIONS.md (PBI-3.3 y ADR-027) en la carpeta docs del Drive del equipo.

### `GET /api/segments/:id/urban-elements`

Árboles y edificios asociados a un tramo, ordenados por `distanceM`.

| Parámetro | Dónde | Descripción |
| --- | --- | --- |
| `id` | ruta | Id del tramo: entero positivo. |
| `types` | query, opcional | `trees`, `buildings` o `trees,buildings` (por defecto, los dos). El tipo no pedido no aparece. |

```bash
curl --header "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/segments/36202/urban-elements"
```

Respuesta `200 OK` (recortada; geometrías en GeoJSON, EPSG:4326):

```json
{
  "segment": {
    "id": 36202, "sourceId": "399096155:2", "osmWayId": 399096155,
    "name": "Paseo de la Independencia", "highway": "tertiary", "lengthM": 83.226,
    "geometry": { "type": "LineString", "coordinates": ["…"] }
  },
  "trees": [
    {
      "id": 31552, "sourceId": "341363", "species": "Tilia x hybrida", "heightM": 7.5,
      "crownDiameterM": null, "distanceM": 2.612, "isNearest": true,
      "geometry": { "type": "Point", "coordinates": [-0.883603, 41.649371] }
    }
  ],
  "buildings": [
    {
      "id": 29594, "sourceId": "ES.SDGC.BU.6432202XM7163A01", "heightM": 37.4,
      "heightSource": "measured", "heightSuspicious": false, "floors": 10,
      "distanceM": 15.247, "isNearest": false, "associationRadiusM": 56.1,
      "geometry": { "type": "MultiPolygon", "coordinates": ["…"] }
    }
  ],
  "summary": {
    "trees": 61, "nearestTrees": 10, "buildings": 15, "nearestBuildings": 0,
    "associationStale": false
  }
}
```

- `distanceM`: metros desde el elemento al tramo (los edificios, desde su polígono). `isNearest`:
  este es el tramo más cercano del elemento; si es `false`, se asoció por radio.
- `associationRadiusM`: radio con el que se asoció el edificio, `max(30, 1,5 × heightM)`.
- `crownDiameterM`, `heightM` y `species` son `null` cuando la fuente no los tiene; no se estiman.
- `summary.trees` y `summary.buildings` cuentan todos los elementos devueltos; `nearestTrees` y
  `nearestBuildings`, solo los que tienen `isNearest`. Solo aparecen los tipos pedidos.
- `associationStale`: `true` si la última asociación de algún tipo pedido está desactualizada tras
  un import; hay que volver a ejecutar `npm run associate`.

| Código | Significado |
| --- | --- |
| `400` | `id` no es un entero positivo, o `types` tiene valores distintos de `trees` y `buildings` (con `fields`). |
| `401` | Sin sesión. |
| `404` | `No existe el tramo indicado.` |

### `GET /api/segments/nearest?lat=&lng=`

Tramo más cercano a un punto: los mismos campos que `segment` y `distanceM` en metros. Si el punto
está a más de `ASSOC_MAX_NEAREST_M` (150 m) del tramo más cercano, no hay resultado.

```bash
curl --header "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/segments/nearest?lat=41.6488&lng=-0.8891"
```

```json
{
  "id": 52904, "sourceId": "710633478:0", "osmWayId": 710633478, "name": "Calle Hernán Cortés",
  "highway": "secondary", "lengthM": 21.366, "geometry": { "type": "LineString", "coordinates": ["…"] },
  "distanceM": 0.241
}
```

| Código | Significado |
| --- | --- |
| `400` | `lat` o `lng` ausentes, no numéricos o fuera de rango, o el punto está fuera de la caja de Zaragoza (con `fields`). |
| `401` | Sin sesión. |
| `404` | `No hay ningún tramo a menos de 150 m del punto indicado.` |

### `GET /api/segments/by-source/:sourceId`

El tramo con ese `source_id` de OpenStreetMap (`<vía>:<secuencia>`, p. ej. `399096155:2`), que es
estable entre bases de datos, a diferencia del `id`. Responde con el objeto `segment` de arriba,
sin `distanceM`.

| Código | Significado |
| --- | --- |
| `400` | `sourceId` vacío o de más de 100 caracteres. |
| `401` | Sin sesión. |
| `404` | `No existe el tramo indicado.` |

### `GET /api/data/status`

Última importación de cada dataset y última asociación de cada tipo. No incluye URLs de las
fuentes ni parámetros internos.

```bash
curl --header "Authorization: Bearer $TOKEN" http://localhost:3000/api/data/status
```

```json
{
  "imports": [
    {
      "dataset": "trees", "status": "success", "startedAt": "2026-10-06T15:48:14.526Z",
      "finishedAt": "2026-10-06T16:04:59.691Z", "sourceCount": 172543,
      "importedCount": 172543, "rejectedCount": 0
    }
  ],
  "associations": [
    {
      "type": "building", "status": "success", "startedAt": "2026-10-19T15:44:09.239Z",
      "finishedAt": "2026-10-19T15:45:50.957Z", "total": 38963, "nearestOk": 38690,
      "isolated": 273, "pctAssociated": 99.299, "stale": false
    }
  ],
  "vegetation": {
    "status": "success", "startedAt": "2026-11-06T22:40:52.572Z",
    "finishedAt": "2026-11-06T22:41:55.025Z", "segments": 91872, "streetSegments": 91872,
    "greenPercentage": 20.306, "treeRadiusM": 8, "stale": false, "staleReasons": []
  }
}
```

`imports` tiene una entrada por dataset (`buildings`, `green_areas`, `streets`, `trees`) y
`associations` una por tipo (`building`, `tree`); un dataset o tipo sin ejecuciones no aparece.
`stale: true` (con `status: "stale"`) indica que un import posterior ha podido cambiar los datos.
`vegetation` es la última ejecución de `npm run compute:vegetation` (`null` si nunca se ha
ejecutado); su `stale` se explica en "Índice de vegetación por tramo". Códigos: `200` y `401`.

## Índice de vegetación por tramo (PBI-10, fase A)

`npm run compute:vegetation` calcula para cada tramo de `street_segments` qué parte de su longitud
es verde: la que está a `VEGETATION_TREE_RADIUS_M` (8 m) o menos de un árbol, o dentro de un parque
o jardín público de OpenStreetMap (`green_areas`). Mide presencia de verde, no sombra: la sombra de
las copas ya la calcula la PBI-5 y este índice no la usa (ADR-026 en el `docs/DECISIONS.md` del
workspace). Todo se calcula en PostGIS, en EPSG:25830:

```bash
npm run import:all            # 1. datos (incluye import:green-areas)
npm run associate             # 2. árboles y edificios a tramos
npm run compute:vegetation    # 3. índice de vegetación (unos 60 s con los datos reales)
```

- Los árboles cercanos salen de `segment_trees` (PBI-3.2), que ya liga cada tramo con los árboles a
  25 m o menos; cada uno es un disco de 8 m de radio. Por eso el radio del índice no puede superar
  `ASSOC_TREE_RADIUS_M`.
- La longitud verde es la del tramo dentro de la unión de discos y zonas verdes: un trozo junto a
  un árbol dentro de un parque cuenta una vez.
- `green_ratio = green_length_m / length_m`, entre 0 y 1.

Se recalcula desde cero en una transacción, por lotes de `VEGETATION_BATCH_SIZE` tramos (5000),
cada uno con un `statement_timeout` de `VEGETATION_BATCH_TIMEOUT_MS` (60 s), y se guarda en
`vegetation_runs`. El comando imprime los totales y la distribución de `green_ratio` por longitud,
y sale con código 1 si algún tramo se queda sin fila (`mismatch`) o si falla. No arranca si la
última asociación de árboles no está en `success` (p. ej. `stale` tras un import) o si no hay un
import de zonas verdes con `success`: dice qué comando falta.

| Tabla | Contenido |
| --- | --- |
| `green_areas` | `source`, `source_id` (`way/<id>` o `relation/<id>`), `kind` (`park` / `garden`), `name`, `geom` (MultiPolygon 4326), `import_run_id` |
| `segment_vegetation` | una fila por tramo: `length_m`, `tree_length_m`, `green_area_length_m`, `green_length_m`, `green_ratio`, `trees_count` (árboles a 8 m o menos), `vegetation_run_id` |
| `vegetation_runs` | una fila por ejecución: `params`, `tree_association_run_id`, `green_areas_import_run_id`, `segments`, `street_segments`, `length_m`, `green_length_m`, `status`, `details` (duración y distribución) |

**Desactualizado.** En `GET /api/data/status`, `vegetation.stale` es `true` si la última
asociación de árboles o el último import de zonas verdes ya no son los que usó el cálculo
(`tree_association_changed`, `green_areas_import_changed`) o si esa asociación se ha marcado
`stale` por un import posterior (`tree_association_stale`). La solución es volver a ejecutar
`npm run associate` si hace falta y después `npm run compute:vegetation`. Las filas de un tramo
borrado por un import desaparecen con él (`ON DELETE CASCADE`).

Con los datos reales (2026-11-06): 91.872 tramos y 5.595,8 km, en 61-62 s. El 20,3 % de la
longitud es verde (17,9 % junto a árboles y 5,5 % en zonas verdes, que se solapan). Distribución
de `green_ratio` por longitud: 0 % en el 72,8 % de la red, (0, 20] % en el 3,6 %, (20, 40] % en el
1,9 %, (40, 60] % en el 1,8 %, (60, 80] % en el 2,7 % y (80, 100] % en el 17,3 %. Los valores de
los lugares de referencia están en la checklist.

## Posición solar y sombras sobre tramos (PBI-5.1 y PBI-5.2)

`src/domain/solar/solarPosition.js` calcula acimut (grados desde el norte, sentido horario) y
elevación aparente con SunCalc. Recibe fecha y hora civil, coordenadas y, opcionalmente, una zona
IANA; usa `Europe/Madrid` por defecto. Luxon convierte esa hora a UTC y rechaza horas inexistentes
o ambiguas durante los cambios de horario de verano.

`src/services/shadow/shadowService.js` expone `calculateSegmentShadows(...)` para los servicios de
routing que se implementen después. Recibe los mismos datos solares y una lista no vacía de IDs de
`street_segments`. No se ha añadido un endpoint ni se persisten resultados: una sombra solo es
válida para el instante solicitado.

La consulta PostGIS de `src/repositories/shadowRepository.js`:

1. transforma tramos y elementos urbanos a EPSG:25830 para trabajar en metros;
2. desplaza cada huella en dirección opuesta al acimut una distancia
   `altura / tan(elevación)`;
3. modela cada edificio con la envolvente convexa de la huella y su copia desplazada;
4. modela la copa de cada árbol como un círculo de 16 segmentos y proyecta la cápsula resultante;
5. intersecta los polígonos con las líneas completas de los tramos y une solapes antes de calcular
   `shadedLengthM` y `shadeRatio`.

La envolvente convexa es exacta para huellas convexas y conservadora para edificios cóncavos o
multipartes: puede sobreestimar la sombra en sus entrantes. No se modelan relieve, fachadas,
transparencia de copas ni oclusión entre objetos. Con elevación menor o igual a cero el servicio
devuelve `sun_below_horizon` y no proyecta geometrías.

Con el Sol por debajo de `SHADOW_MIN_SUN_ELEVATION_DEG` (10° por defecto) tampoco se proyecta y el
servicio devuelve `sun_too_low`: la sombra mide `altura / tan(elevación)` y, cerca del horizonte, la
búsqueda llega a abarcar casi toda la ciudad (a 0,2° una ruta de 1 km procesaba más de 2.000
edificios y árboles). Además, la consulta se ejecuta con un `statement_timeout` de
`SHADOW_QUERY_TIMEOUT_MS` (20 s por defecto); si se supera, la API responde `504`. Ver ADR-015.

En rutas largas, los edificios y árboles candidatos se buscan con un recuadro por tramo (unidos y
partidos con `ST_Subdivide`), no con el de toda la ruta, y cada candidato se mide una vez contra la
ruta en EPSG:25830. La asociación ruta-tramo también busca por cada trozo recto de la ruta y tiene
el mismo límite de tiempo. Una ruta de 3,7 km pasó de ~30 s a ~3 s en local (ADR-016).

Los edificios usan `height_m` y conservan `height_source` y `height_suspicious` en cada asociación.
Un árbol solo participa si tiene `height_m` y `crown_diameter_m` positivos; nunca se rellenan esos
campos. `dataQuality` devuelve los totales utilizables y los omitidos por altura, copa o geometría.
La respuesta conserva tanto `segmentId`/`segmentSourceId` como `elementId`/`sourceId`.

## Desarrollo

```bash
npm run dev
```

La API se sirve en <http://localhost:3000/api>. Para registrarse e iniciar sesión hacen falta la
base de datos arrancada con las migraciones aplicadas y `JWT_SECRET` en el `.env` (ver
[Autenticación](#autenticación-pbi-4)).

## Tests

```bash
npm test                      # tests unitarios y HTTP, sin base de datos
npm run test:integration      # tests con PostGIS; necesitan `docker compose up -d db`
npm run test:all              # ambos, con cobertura combinada
```

Los tests nunca llaman a APIs externas; las respuestas de IDEZAR y Overpass salen de fixtures en
`src/tests/fixtures`.

### Cobertura conjunta con PostGIS

La verificación local del 2026-10-20, ejecutada con PostgreSQL/PostGIS mediante
`npm run test:all -- --runInBand`, completó 25 suites y 262 tests sin fallos. La cobertura
combinada de tests unitarios, HTTP e integración fue:

| Métrica | Cobertura |
| --- | ---: |
| Sentencias | 97,91 % |
| Ramas | 91,15 % |
| Funciones | 97,48 % |
| Líneas | 98,60 % |

Estas cifras incluyen `src/tests/integration/shadows.test.js`, que ejecuta la proyección y la
asociación de sombras de PBI-5.2 contra PostGIS. Pueden variar al añadir código o pruebas; el
resultado vigente debe comprobarse volviendo a ejecutar el comando.

## Comprobaciones

```bash
npm run check
npm run lint                  # ESLint (airbnb-base + compatibilidad con Prettier)
npm run format:check          # Prettier
```

Para ejecutar localmente las mismas comprobaciones que GitHub Actions:

```bash
npm run ci
```

Este comando ejecuta ESLint, comprueba el formato con Prettier, valida la sintaxis y lanza los
tests unitarios y HTTP. El workflow se ejecuta en cada pull request hacia `main`. Las llamadas a
OpenRouteService están simuladas en los tests, por lo que CI no necesita `ORS_API_KEY`.

## Arranque en producción

```bash
npm start
```

## Despliegue en producción (Azure)

Producción corre en una máquina virtual de Azure con Docker Compose: Caddy (HTTPS), frontend, backend y PostGIS.
Cada push a `main` ejecuta el workflow `Deploy`, que pasa `npm run ci`, publica la imagen en GHCR
y la despliega por SSH aplicando antes las migraciones. La configuración del servidor y los pasos
para crearlo están en [deploy/README.md](deploy/README.md).

## Variables de entorno

- `NODE_ENV`: entorno de ejecución.
- `PORT`: puerto HTTP. Valor local por defecto: `3000`.
- `CORS_ORIGIN`: origen permitido del frontend. Valor local por defecto: `http://localhost:5173`.
- `LOG_LEVEL`: `debug`, `info` (por defecto), `warn`, `error` o `silent` (por defecto en los tests).
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: conexión a PostgreSQL/PostGIS; también
  las usa `docker-compose.yml`. `DB_TEST_NAME`: nombre de la base de datos de test.
- `DATABASE_URL`, `TEST_DATABASE_URL`: cadenas de conexión opcionales que sustituyen a los valores `DB_*`.
- `IDEZAR_WFS_URL`, `OVERPASS_URL`: endpoints de las fuentes del import (valores por defecto en `src/config/importConfig.js`).
- `IMPORT_WFS_PAGE_SIZE` (2000), `IMPORT_BATCH_SIZE` (500): tamaño de página del import y de cada transacción.
- `BUILDING_FLOOR_HEIGHT_M` (3), `BUILDING_GROUND_FLOOR_EXTRA_M` (1), `BUILDING_DEFAULT_HEIGHT_M` (4),
  `BUILDING_MIN_HEIGHT_M` (2), `BUILDING_MAX_HEIGHT_M` (150), `BUILDING_MIN_HEIGHT_PER_FLOOR_M` (2),
  `BUILDING_MAX_HEIGHT_PER_FLOOR_M` (8), `BUILDING_MAX_SINGLE_STOREY_HEIGHT_M` (40),
  `BUILDING_SUSPICIOUS_SINGLE_STOREY_HEIGHT_M` (15), `BUILDING_SUSPICIOUS_HEIGHT_PER_FLOOR_M` (6):
  estimación de la altura de los edificios (ver ADR-001 en el `docs/DECISIONS.md` del workspace).
- `ASSOC_MAX_NEAREST_M` (150), `ASSOC_KNN_CANDIDATES` (10), `ASSOC_TREE_RADIUS_M` (25),
  `ASSOC_BUILDING_MIN_RADIUS_M` (30), `ASSOC_BUILDING_HEIGHT_FACTOR` (1.5), `ASSOC_MIN_PCT` (95),
  `ASSOC_BATCH_SIZE` (20000): asociación a tramos peatonales (`src/config/associationConfig.js`;
  ver ADR-009 en el `docs/DECISIONS.md` del workspace).
- Open-Meteo no requiere clave ni variable de entorno en esta integración. `GET /api/weather/current`
  consulta Zaragoza y usa caché en memoria durante cinco minutos.
- `SHADOW_MIN_SUN_ELEVATION_DEG` (10), `SHADOW_QUERY_TIMEOUT_MS` (20000): elevación solar mínima
  para proyectar sombras y tiempo máximo de la consulta de sombras (`src/config/shadowConfig.js`;
  ver ADR-015 en el `docs/DECISIONS.md` del workspace). Son opcionales.
- `VEGETATION_TREE_RADIUS_M` (8), `VEGETATION_BATCH_SIZE` (5000), `VEGETATION_BATCH_TIMEOUT_MS`
  (60000): radio de los árboles, tramos por lote y tiempo máximo de cada lote del índice de
  vegetación (`src/config/vegetationConfig.js`; ver ADR-026 en el `docs/DECISIONS.md` del
  workspace). Son opcionales; el radio no puede superar `ASSOC_TREE_RADIUS_M`.
- `ORS_API_KEY`: clave de API de OpenRouteService / HeiGIT que usan el autocompletado y el cálculo
  de rutas. Guárdala solo en el `backend/.env` ignorado por Git o en el entorno del servidor.
  `OPENROUTESERVICE_API_KEY` sigue funcionando como alternativa para configuraciones antiguas.
- `OPENROUTESERVICE_GEOCODING_BASE_URL`: URL base de la API de geocodificación. Valor local por defecto: `https://api.heigit.org/pelias/v1`.
- `OPENROUTESERVICE_DIRECTIONS_BASE_URL`: URL base de la API de rutas. Valor local por defecto:
  `https://api.openrouteservice.org/v2/directions`.
- `JWT_SECRET` (**obligatoria y secreta**): clave con la que se firman los tokens de sesión. Debe
  ser larga y aleatoria; se puede generar con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Sin ella, el
  registro y el inicio de sesión devuelven `503`. Usa una distinta en cada entorno.
- `JWT_EXPIRES_IN`: duración de la sesión en el formato de `jsonwebtoken` (`7d`, `12h`...). Por
  defecto `7d`.
- `FRONTEND_URL`: URL del frontend a la que vuelve el usuario tras el login con Google. Por defecto
  `http://localhost:5173`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (**secreta**): credenciales del cliente OAuth de
  Google. Son opcionales: sin ellas solo funciona el acceso con email y contraseña, y el botón de
  Google vuelve al login con un aviso.
- `GOOGLE_CALLBACK_URL`: dirección a la que Google devuelve al usuario. Por defecto
  `http://localhost:5173/api/auth/google/callback` (pasa por el proxy de Vite). Debe coincidir
  exactamente con un "URI de redirección autorizado" del cliente OAuth.

## Meteorología actual (PBI-7)

`GET /api/weather/current` requiere sesión. Consulta Open-Meteo Forecast para el centro de Zaragoza
(`41.6488, -0.8891`), solicita `temperature_2m`, `wind_speed_10m` y `wind_direction_10m`, y fija
`timezone=Europe/Madrid`. Devuelve `{ weather }` con valores y unidades del proveedor, hora local
del dato, zona horaria y fecha de consulta. Una caché en memoria de cinco minutos evita llamadas
redundantes; peticiones simultáneas comparten la misma llamada en curso. Los errores del proveedor
se traducen a errores controlados. No se necesita clave ni variable de entorno nueva.

```bash
curl http://localhost:3000/api/weather/current \\
  --header "Authorization: Bearer <token>"
```

La aplicación debe conservar la atribución y licencia de Open-Meteo cuando presente estos datos.
Esta PBI añade el servicio backend; no añade un panel meteorológico en el frontend ni incorpora
todavía el viento al coste de las rutas (la PBI-8.1 lo usa para la exposición por tramo).

## Exposición al viento por tramo (PBI-8.1)

`src/domain/wind/windExposure.js` puntúa de 0 a 100 cuánto expone un tramo al viento (ADR-024):

- **Orientación:** `segmentRepository.getSegmentPieces` divide el tramo en sus segmentos rectos
  con `ST_DumpSegments` en EPSG:25830 y devuelve el rumbo (`ST_Azimuth`) y la longitud de cada
  uno. Vale para calles en cualquier dirección, también en diagonal o curvas.
- **Alineación (0-1):** media ponderada por longitud de `|cos(viento − rumbo)|`. La calle es un
  eje: el viento que entra por un extremo o por el otro puntúa igual; a favor y en contra se
  distinguen en la PBI-8.2.
- **Intensidad (0-1):** 0 por debajo de 10 km/h, 1 desde 50 km/h y lineal entre medias.
- **Exposición:** `100 × alineación × intensidad`.

### `GET /api/segments/:id/wind-exposure`

Requiere sesión. Sin parámetros usa el viento actual de Open-Meteo (`GET /api/weather/current`,
caché de cinco minutos). Con `windSpeed` (km/h, 0-200) y `windDirection` (grados desde el norte de
donde viene el viento, 0-360), siempre los dos juntos, calcula con ese viento sin llamar al
proveedor.

Ejemplo real del 2026-11-03 con el Paseo de la Independencia (`399096155:2`) y un cierzo de 30 km/h
desde 300°. El `id` depende de la base de datos (36044 en esta importación); se obtiene con
`GET /api/segments/by-source/399096155:2`.

```bash
curl --header "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/segments/36044/wind-exposure?windSpeed=30&windDirection=300"
```

```json
{
  "segmentId": 36044, "segmentSourceId": "399096155:2", "name": "Paseo de la Independencia",
  "lengthM": 83.23,
  "wind": { "speedKmh": 30, "directionDeg": 300, "source": "request", "time": null },
  "openness": 0.2,
  "street": { "widthM": 51.14, "heightM": 29.84, "hwRatio": 0.622, "samples": 5 },
  "status": "available", "reason": null,
  "orientationDeg": 36.17, "alignment": 0.207, "intensity": 0.5, "windExposure": 10.34
}
```

(Decimales recortados; valores del 2026-11-07, con la apertura de la PBI-8.3. Antes de ella la
alineación era 0,107 y la exposición 5,37.) El Paseo va de noreste a suroeste (36°), casi
perpendicular a ese cierzo, así que la exposición es baja; como es una calle ancha (apertura 0,2),
parte del viento que la cruza también cuenta. Con el viento de
Open-Meteo, `wind.source` es `open-meteo` y `wind.time` la hora local del dato. `orientationDeg` es
el eje dominante del tramo (0-180°); es `null` si ningún eje domina. Si el tramo no tiene geometría
utilizable, `status` es `unavailable`, `reason` `invalid_segment_geometry` y los valores `null`.

| Código | Significado |
| --- | --- |
| `400` | `id` no válido, o `windSpeed`/`windDirection` no numéricos, fuera de rango o solo uno de los dos (con `fields`). |
| `401` | Sin sesión. |
| `404` | `No existe el tramo indicado.` |
| `502`/`504` | Error o timeout de Open-Meteo cuando no se indica el viento. |

Desde la PBI-8.3 la respuesta incluye también `openness` y `street` (ver abajo).

## Apertura de la calle (PBI-8.3)

Cada tramo tiene una **apertura** de 0 (cañón estrecho) a 1 (espacio abierto) que decide si el
viento que cruza la calle también cuenta (ADR-028):

- **Medida:** `npm run compute:openness` toma un punto de muestra cada 20 m de cada tramo y, desde
  cada uno, una línea perpendicular de hasta 40 m a cada lado. El primer edificio que corta da la
  distancia a la fachada y su altura. Anchura W = distancia a la izquierda + a la derecha (un lado
  sin edificios cuenta 40 m y altura 0); altura H = media de las dos fachadas.
- **Apertura** (Oke, 1988): H/W ≤ 0,3 → 1; H/W ≥ 0,65 → 0; lineal entre medias. El tramo guarda la
  media de sus muestras en `segment_openness` (migración `20261107000001-create-segment-openness`).
  Un tramo sin edificios cerca (parque, ribera) tiene apertura 1, y uno sin apertura calculada
  cuenta como abierto.
- **Viento:** la parte a lo largo de la calle se canaliza siempre (PBI-8.1 y PBI-8.2); la que la
  cruza solo llega si la calle es abierta y molesta la mitad:
  `alineación = parte a lo largo + apertura × 0,5 × |sin θ|`, con tope 1. Con viento perpendicular,
  un cañón da 0 y una plaza 0,5; lo alineado sigue puntuando más que lo perpendicular.
- **Dónde se usa:** `GET /api/segments/:id/wind-exposure` devuelve `openness` (la usada) y `street`
  (`widthM`, `heightM`, `hwRatio`, `samples`, o `null` si no se ha calculado). En
  `POST /api/routes/weighted`, cada trozo de la ruta toma la apertura del tramo más cercano a menos
  de 10 m (una sola consulta para todas las rutas, que se salta con viento en calma), y
  `windExposure.openness` es la media de la ruta.

```bash
npm run compute:openness
```

Recalcula todos los tramos dentro de una transacción, por lotes, e imprime cuántos tramos tienen
apertura, la media ponderada por longitud y la distribución. Termina con código 0 solo si todos los
tramos de `street_segments` tienen apertura. Hay que volver a lanzarlo tras importar calles o
edificios; el CD no lo hace. Variables opcionales en `.env.example` (`OPENNESS_*`).

#### Resultados con datos reales (2026-11-07)

Con las 89.974 calles de OSM y los 38.963 edificios de IDEZAR, `compute:openness` tarda unos 2
minutos. Media ponderada por longitud: 0,88 (el término municipal incluye mucho camino periurbano);
el 85,7 % de la longitud tiene apertura ≥ 0,75 y el 8,2 % < 0,25. Calles conocidas del centro
(media ponderada por longitud de sus tramos):

| Calle | Anchura (m) | Altura (m) | Apertura |
| --- | --- | --- | --- |
| Calle Mayor (Casco) | 11,8 | 21,1 | 0,04 |
| Calle de Alfonso I | 16,4 | 24,4 | 0,07 |
| Calle de San Miguel | 14,4 | 25,2 | 0,09 |
| Calle del Coso | 32,0 | 24,3 | 0,28 |
| Calle Manifestación | 25,4 | 18,3 | 0,30 |
| Paseo de la Independencia | 52,4 | 28,1 | 0,33 |
| Paseo de Sagasta | 48,7 | 26,5 | 0,35 |
| Avenida de Cesáreo Alierta | 61,1 | 15,2 | 0,80 |
| Paseo de Echegaray y Caballero (ribera) | 63,2 | 9,0 | 0,97 |
| Caminos del Parque Grande | — | — | 0,93 |

Las calles estrechas del Casco son cañones, los paseos con edificios altos quedan en 0,3-0,35 y la
ribera y los parques son abiertos. Un tramo de la Calle Mayor alineado con el cierzo (123°, apertura
0) da 49,9 de exposición con 30 km/h desde 300°: el cañón canaliza el viento a lo largo.

En las rutas, con un cierzo de 50 km/h en cinco trayectos de prueba, la apertura sube la exposición
(por ejemplo, de 27 a 56 en Universidad → Romareda, una zona abierta) y aumenta algo la diferencia
entre alternativas (hasta 12 puntos en Delicias → Pilar, donde la alternativa va por calles más
abiertas). Las alternativas de ORS siguen pareciéndose, así que la ruta rápida sigue ganando a
menudo (ADR-025).

## Autenticación (PBI-4)

Los usuarios se registran con nombre, email y contraseña, o con su cuenta de Google. Al
registrarse o iniciar sesión, la API devuelve un token JWT que el frontend guarda y envía en cada
petición con la cabecera `Authorization: Bearer <token>`. El token caduca según `JWT_EXPIRES_IN`;
cerrar sesión consiste en que el frontend lo borre, así que no hay endpoint de logout.

Las contraseñas se guardan con bcrypt (coste 10) y deben tener entre 8 caracteres y 72 bytes. El
objeto `user` de las respuestas es siempre `{ id, name, email }` y nunca incluye el hash.

### Endpoints protegidos

`/api/routes/*`, `/api/route-profiles/*`, `/api/geocoding/*`, `/api/segments/*` y `/api/data/*` exigen un token válido. Sin cabecera, o con un token
caducado o manipulado, responden:

```json
{ "error": { "message": "Necesitas iniciar sesión." } }
```

con código `401`. `/api/health` sigue siendo público.

### Errores de validación

Los `400` de autenticación incluyen `fields`, con un mensaje por cada campo incorrecto, para que
el frontend lo muestre junto a ese campo:

```json
{
  "error": {
    "message": "Revisa los datos marcados.",
    "fields": {
      "email": "Introduce un correo electrónico válido.",
      "password": "La contraseña debe tener al menos 8 caracteres."
    }
  }
}
```

### `POST /api/auth/register`

Crea una cuenta con email y contraseña. Cuerpo: `name` (1-100 caracteres), `email` y `password`.

```bash
curl --request POST http://localhost:3000/api/auth/register \
  --header "Content-Type: application/json" \
  --data '{ "name": "Ana López", "email": "ana@correo.es", "password": "segura123" }'
```

Respuesta `201 Created`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "name": "Ana López", "email": "ana@correo.es" }
}
```

| Código | Significado |
| --- | --- |
| `400` | Algún campo falta o no es válido (con `fields`). |
| `409` | Ya existe una cuenta con ese email (`fields.email`). |
| `503` | Falta `JWT_SECRET` en el servidor. |
| `500` | Error interno inesperado. |

### `POST /api/auth/login`

Inicia sesión con email y contraseña. Cuerpo: `email` y `password`.

```bash
curl --request POST http://localhost:3000/api/auth/login \
  --header "Content-Type: application/json" \
  --data '{ "email": "ana@correo.es", "password": "segura123" }'
```

Respuesta `200 OK`: el mismo formato que el registro (`{ token, user }`).

| Código | Significado |
| --- | --- |
| `400` | Falta el email o la contraseña (con `fields`). |
| `401` | `El correo o la contraseña no son correctos.` Es el mismo mensaje para un email que no existe, una contraseña incorrecta o una cuenta creada solo con Google, para no revelar qué emails están registrados. |
| `503` | Falta `JWT_SECRET` en el servidor. |

### `GET /api/auth/me`

Devuelve el usuario de la sesión. El frontend lo usa al arrancar para comprobar que el token
guardado sigue siendo válido.

```bash
curl http://localhost:3000/api/auth/me --header "Authorization: Bearer <token>"
```

Respuesta `200 OK`:

```json
{ "user": { "id": 1, "name": "Ana López", "email": "ana@correo.es" } }
```

Devuelve `401` si el token falta, no es válido, ha caducado o el usuario ya no existe.

### `GET /api/auth/google` y `GET /api/auth/google/callback`

No se llaman con `fetch`: el navegador navega a ellos.

1. `GET /api/auth/google` redirige (`302`) a la pantalla de Google para elegir la cuenta.
2. Google vuelve a `GOOGLE_CALLBACK_URL` (`/api/auth/google/callback`) con un código que el
   backend canjea por el id, el email y el nombre del usuario.
3. El backend redirige al frontend:
   - si todo va bien, a `FRONTEND_URL/#authToken=<token>`. El token va en el fragmento (`#`), que
     el navegador nunca envía a ningún servidor, y el frontend lo borra de la barra de direcciones
     al leerlo;
   - si Google no está configurado, el usuario cancela o la cuenta no es válida, a
     `FRONTEND_URL/#authError=google`.

Para resolver la cuenta, el backend busca primero un usuario vinculado a ese id de Google. Si no
existe, busca uno con el mismo email y lo vincula, solo si Google indica que el email está
verificado. Si tampoco existe, crea una cuenta nueva sin contraseña.

### Configurar el login con Google

1. En <https://console.cloud.google.com>, crea un proyecto.
2. En **Google Auth Platform** (o "Pantalla de consentimiento de OAuth"), configura la app con
   público **Externo** y añade en **Usuarios de prueba** las cuentas que vayan a entrar. Mientras
   la app esté en modo "Prueba", Google bloquea cualquier otra cuenta.
3. En **Clientes**, crea un **ID de cliente de OAuth** de tipo **Aplicación web** con:
   - origen de JavaScript autorizado: `http://localhost:5173`;
   - URI de redirección autorizado: `http://localhost:5173/api/auth/google/callback`.
4. Copia el ID y el secreto del cliente en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del `.env`
   (nunca en `.env.example`) y reinicia el backend.

En producción hay que añadir en el cliente OAuth el origen y la URI de callback del dominio real, y
poner esa URI en `GOOGLE_CALLBACK_URL` y el dominio en `FRONTEND_URL`.

## Contrato del autocompletado (PBI-1)

`GET /api/geocoding/autocomplete?text=Plaza%20del%20Pilar&limit=5`

Necesita la cabecera `Authorization: Bearer <token>` (ver [Autenticación](#autenticación-pbi-4)).

Devuelve `{ results: [{ id, label, lat, lng, source: "search" }] }`.
Un texto de menos de 3 caracteres devuelve una lista vacía; la longitud máxima es 200.
`limit` vale 5 por defecto y debe ser un entero de 1 a 10. Las consultas no válidas devuelven 400.
El adaptador valida, normaliza y elimina duplicados de los resultados del proveedor.
La búsqueda se centra en Zaragoza y solo devuelve lugares dentro de su término municipal.

Los errores usan `{ error: { message } }`: 401 sin sesión, 503 si falta configuración, 429 si se agota la cuota
del proveedor, 504 si el proveedor supera el timeout de 8 segundos y 502 si falla el proveedor o
la red, o la respuesta no es válida. Nunca se reenvían cuerpos de respuesta del proveedor ni
credenciales. Los tests automáticos simulan las peticiones externas.

### `GET /api/geocoding/reverse?lat=41.6497&lng=-0.8834`

Nombre de lo que hay en un punto del mapa. Necesita sesión. Devuelve
`{ place: { label: "Paseo de la Independencia 31" } }`, o `{ place: null }` si no hay nada a menos de
150 m. Un lugar (venue) a 15 m o menos gana a la dirección de su edificio. Si el punto
falta o queda fuera del término municipal devuelve 400; los demás errores son los del autocompletado.

Desde la raíz del workspace, `docker compose up` carga `backend/.env` mediante `env_file`.
Crea ese fichero (ignorado por Git) a partir de `.env.example` antes de arrancar Compose; no
sobrescribas una clave existente. El frontend llega a la API a través del proxy de desarrollo de
Vite.

## Rutas con pesos (PBI-6)

Cada usuario tiene sus rutas guardadas con un peso de 0 a 100 % para la sombra, otro para el sol y
otro para el viento (PBI-8.2), y el tiempo extra máximo respecto a la ruta rápida, de 0 a 40 %
(ADR-023). La primera vez que las lista recibe una copia de las tres predefinidas: Rápida (0/0/0),
Sombreada (50/0/0) y Soleada (0/50/0), las tres con un 25 % de tiempo extra y el viento a 0. Las
rutas guardadas antes de la PBI-8.2 tienen el viento a 0 (migración
`20261106000001-add-route-profile-wind-weight`).

### `GET /api/route-profiles`

```json
{ "profiles": [{ "id": 1, "name": "Rápida", "presetKey": "fastest", "weights": { "shade": 0, "sun": 0, "wind": 0 }, "maxDetourPercentage": 25 }] }
```

### `POST /api/route-profiles` y `PUT /api/route-profiles/:id`

Cuerpo `{ "name": "Verano", "weights": { "shade": 80, "sun": 0, "wind": 20 }, "maxDetourPercentage": 10 }`
(un peso que falta cuenta como 0; `maxDetourPercentage` es opcional; por defecto, 25). Responden `201` o `200` con
`{ "profile": ... }`. Errores: `400` con `fields` si el nombre (1 a 40 caracteres) o un peso no son
válidos, `409` si el nombre ya existe para ese usuario o tiene ya 20 rutas, y `404` si la ruta no es
suya.

### `DELETE /api/route-profiles/:id`

Responde `204`. Borra la ruta solo para ese usuario, también si es predefinida.

### `POST /api/routes/weighted`

El mismo cuerpo que `POST /api/routes/shaded` más `"weights": { "shade": 80, "sun": 0, "wind": 0 }`
y, opcionales, `"maxDetourPercentage": 10` (de 0 a 40; por defecto, 25) y
`"wind": { "speedKmh": 40, "directionDeg": 300 }`. Devuelve
`{ "comparison": { "status", "weights", "wind", "fastest", "selected", "additionalDurationSeconds",
"shadeChangePercentagePoints", "windChangePoints", "candidatesEvaluated", "strategy" } }`.
`selected` es la alternativa elegida con esos pesos o `null`; `status` es `selected`,
`no_better_alternative`, `insufficient_exposure_data`, `sun_below_horizon`, `sun_too_low` o, con los
pesos a 0, `fastest_only` (solo se pide la ruta rápida).

#### El viento en las rutas (PBI-8.2)

- **Coste** (ADR-023 y ADR-025):
  `duración × (1 + (peso_sombra × %sol + peso_sol × %sombra + peso_viento × exposición_viento) / 10000)`.
  La mejora mínima de 5 puntos se mide sobre la media de esos tres valores ponderada por los pesos.
- **Exposición al viento de cada ruta** (`fastest.windExposure` y `selected.windExposure`, de 0 a
  100): media ponderada por longitud de los trozos rectos de la geometría de la ruta, con el sentido
  de marcha. Viento de cara: `|cos θ|` completo; a favor: `0,5 × |cos θ|`; cruzado: 0. Se multiplica
  por la intensidad de la PBI-8.1 (0 por debajo de 10 km/h, 1 desde 50 km/h).
- **Viento usado** (`wind`): el de la petición (`source: "request"`) o, sin él, el actual de
  Open-Meteo (`source: "open-meteo"`, con `time`), aunque la ruta se pida para otra fecha u hora.
  Si Open-Meteo falla y el viento no pesa, `wind` es `null` y cada `windExposure` es
  `unavailable` con `reason: "weather_unavailable"`; si el viento pesa, se devuelve el error
  (`502`/`504`).
- **Solo viento:** si la sombra y el sol están a 0, no se calculan sombras (`exposure.reason` es
  `not_requested`) y la ruta funciona también de noche.
- `windChangePoints` es la exposición al viento de `selected` menos la de `fastest` (negativa si
  está más resguardada). `shadeChangePercentagePoints` es `null` si no hay sombras.
- `wind` no válido (velocidad de 0 a 200 km/h, dirección de 0 a 360°) → `400` con `fields`.

## Contrato de la ruta rápida (PBI-2)

`POST /api/routes/fastest`

Calcula la ruta peatonal más rápida entre dos coordenadas, sin considerar sombra, sol, viento ni
otros factores de confort. Necesita la cabecera `Authorization: Bearer <token>` (ver
[Autenticación](#autenticación-pbi-4)).

### Petición

El cuerpo JSON debe incluir `origin` y `destination`. Cada punto debe contener una latitud entre
`-90` y `90` y una longitud entre `-180` y `180`:

```json
{
  "origin": { "lat": 41.6488, "lng": -0.8891 },
  "destination": { "lat": 41.656, "lng": -0.878 }
}
```

Ejemplo:

```bash
curl --request POST http://localhost:3000/api/routes/fastest \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer <token>" \
  --data '{
    "origin": { "lat": 41.6488, "lng": -0.8891 },
    "destination": { "lat": 41.656, "lng": -0.878 }
  }'
```

### Respuesta correcta

Devuelve `200 OK` con una geometría GeoJSON `LineString`, la distancia total en metros y la
duración estimada en segundos:

```json
{
  "route": {
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [-0.8891, 41.6488],
        [-0.884, 41.652],
        [-0.878, 41.656]
      ]
    },
    "distance": 1250.4,
    "duration": 930.2,
    "steps": [
      {
        "instruction": "Gire a la derecha a Calle de Alfonso I",
        "name": "Calle de Alfonso I",
        "distance": 135.2,
        "duration": 97.4,
        "wayPoints": [1, 2]
      }
    ]
  }
}
```

`steps` es el paso a paso en español. `wayPoints` son los índices de inicio y fin del tramo en
`geometry.coordinates`. `name` es `null` en vías sin nombre en OpenStreetMap. Si el proveedor no da
pasos válidos, `steps` es una lista vacía y la ruta sigue siendo válida. Las rutas de
`POST /api/routes/shaded` incluyen el mismo campo.

### Errores

Todos los errores usan `{ "error": { "message": "..." } }`:

| Código | Significado |
| --- | --- |
| `400` | Faltan coordenadas, no son numéricas, están fuera de rango o algún punto queda fuera del término municipal de Zaragoza. |
| `401` | No hay sesión o el token no es válido. |
| `429` | Se ha agotado la cuota de OpenRouteService. |
| `502` | El proveedor no está disponible o ha devuelto una respuesta inválida. |
| `503` | El servidor no tiene configurada la clave de OpenRouteService. |
| `504` | OpenRouteService no ha respondido antes del timeout de 8 segundos. |
| `500` | Error interno inesperado. |

Las respuestas nunca incluyen credenciales, cuerpos del proveedor ni detalles internos. Los
tests automáticos simulan OpenRouteService y no consumen cuota.

## Exposición por tramo (PBI-5.3)

`src/services/shadow/exposureService.js` reutiliza PBI-5.2 para obtener, en una sola consulta por
lote, `shadePercentage` y `sunPercentage` de cada ID de `street_segments`. Los resultados incluyen
el instante UTC y la hora civil de referencia. Un cero calculado se devuelve como `available`; un
tramo inexistente, inválido, de longitud cero o calculado con el Sol bajo el horizonte se devuelve
como `unavailable` con una razón y porcentajes `null`. No hay endpoint ni persistencia propios.

## Contrato de la Ruta Sombreada (PBI-5.4)

`POST /api/routes/shaded` requiere sesión. Recibe origen, destino, fecha y hora civil; la zona IANA
es opcional y por defecto es `Europe/Madrid`:

```json
{
  "origin": { "lat": 41.6488, "lng": -0.8891 },
  "destination": { "lat": 41.656, "lng": -0.878 },
  "date": "2026-06-21",
  "time": "14:00",
  "timeZone": "Europe/Madrid"
}
```

La respuesta contiene siempre la candidata rápida con su estado de exposición. `shaded` solo
contiene una geometría diferente si una alternativa tiene cobertura suficiente, mejora al menos
5 puntos de sombra, no supera un 25 % de duración adicional y vence según el coste de ADR-014.
En caso contrario vale `null`:

```json
{
  "comparison": {
    "status": "selected",
    "fastest": {
      "geometry": { "type": "LineString", "coordinates": [[-0.8891, 41.6488], [-0.878, 41.656]] },
      "distance": 1250,
      "duration": 900,
      "exposure": { "status": "available", "shadePercentage": 22, "sunPercentage": 78 }
    },
    "shaded": {
      "geometry": { "type": "LineString", "coordinates": [[-0.8891, 41.6488], [-0.88, 41.652], [-0.878, 41.656]] },
      "distance": 1370,
      "duration": 990,
      "exposure": { "status": "available", "shadePercentage": 68, "sunPercentage": 32 }
    },
    "additionalDurationSeconds": 90,
    "shadeImprovementPercentagePoints": 46
  }
}
```

Origen y destino deben estar dentro del término municipal de Zaragoza (`importConfig.zaragozaBbox`);
si no, responde `400` sin llamar a OpenRouteService.

Estados posibles: `selected`, `no_better_alternative`, `insufficient_exposure_data`,
`sun_below_horizon` y `sun_too_low` (Sol por debajo de `SHADOW_MIN_SUN_ELEVATION_DEG`; no se
proyectan sombras). Los errores de autenticación, validación y proveedor usan el mismo formato y
códigos controlados que `/api/routes/fastest`; si el cálculo de sombras supera
`SHADOW_QUERY_TIMEOUT_MS`, responde `504`. El endpoint necesita los datos urbanos ya cargados,
pero no añade migraciones ni dependencias.

## Checklist de verificación manual

### PBI-8.3 - Apertura de la calle en la exposición al viento

Con las calles y los edificios importados (`npm run import:streets` e `import:buildings`) y la
migración aplicada.

- [ ] `npm run compute:openness` termina con `status=success` y tantos `segments` como
      `street_segments`.
- [ ] `GET /api/segments/<id>/wind-exposure?windSpeed=30&windDirection=300` del Paseo de la
      Independencia (`399096155:2`) → `openness` ≈ 0,2, `street.widthM` ≈ 51 y `windExposure` ≈ 10.
- [ ] Un tramo de la Calle Mayor → `openness` 0 y, con viento perpendicular a la calle, exposición ≈ 0.
- [ ] Un camino del Parque Grande o del Paseo de Echegaray y Caballero → `openness` ≈ 1 y, con viento
      perpendicular, exposición ≈ 50 con 50 km/h.
- [ ] Antes de lanzar `compute:openness` (o con un tramo nuevo), `street` es `null` y `openness` 1.
- [ ] `npm run ci` y `npm run test:integration -- src/tests/integration/openness.test.js` pasan.

### PBI-10 (fase A) - Índice de vegetación por tramo

Valores reales del 2026-11-06, sobre los datos de las PBI-3.1 y 3.2 (asociación al día). Las
consultas SQL se pegan en `docker compose exec db psql -U weathermapz -d weathermapz`.

- [ ] `npm run db:migrate` aplica `20261106000002-create-green-areas` y
      `20261106000003-create-segment-vegetation`.
- [ ] `npm run compute:vegetation` sin zonas verdes importadas sale con código 1 y el mensaje
      `green areas import is missing; run "npm run import:green-areas"`, sin crear filas en
      `vegetation_runs`.
- [ ] `npm run import:green-areas` → `SUCCESS ... source=793 imported=793 rejected=0` y
      `"stats":{"park":365,"garden":428}` (unos 40 s). Repetirlo no cambia
      `SELECT count(*) FROM green_areas;` (793).
- [ ] `SELECT count(*) FROM green_areas WHERE source_id = 'way/42365048';` → 1 (Parque Grande José
      Antonio Labordeta, 44,4 ha).
- [ ] `npm run compute:vegetation` → tabla con `success`, `91872` tramos de `91872`, `5595.8` km,
      `green_%` 20.3, `trees_%` 17.9, `green_areas_%` 5.5, unos 61 s; y la distribución
      0: 50610 tramos / 72,8 %, 0-20: 3938 / 3,6 %, 20-40: 2998 / 1,9 %, 40-60: 2888 / 1,8 %,
      60-80: 3681 / 2,7 %, 80-100: 27757 / 17,3 %.
- [ ] Repetirlo da lo mismo:
      `SELECT count(*), round(sum(green_length_m)::numeric, 1), sum(trees_count) FROM segment_vegetation;`
      → `91872 | 1136307.2 | 252597` las dos veces.
- [ ] El Paseo de la Independencia (`399096155:2`) es verde entero:
      `SELECT v.green_ratio, v.trees_count FROM segment_vegetation v JOIN street_segments s ON s.id = v.segment_id WHERE s.source_id = '399096155:2';`
      → `1 | 21`.
- [ ] Lugares de referencia, ponderados por longitud, con esta consulta:

      ```sql
      WITH ref AS (
        SELECT s.id, CASE
          WHEN s.name IN ('Paseo de la Independencia', 'Paseo Independencia') THEN 'Independencia'
          WHEN s.name LIKE 'Gran Vía de Santiago%' THEN 'Gran Vía'
          WHEN s.name = 'Paseo de Fernando el Católico' THEN 'Fernando el Católico'
          WHEN s.name = 'Calle de Alfonso I' THEN 'Alfonso I'
          WHEN s.name = 'Calle de Don Jaime I' THEN 'Don Jaime I' END AS lugar
        FROM street_segments s
        UNION ALL
        SELECT s.id, 'Parque Grande' FROM street_segments s
        JOIN green_areas a ON a.source_id = 'way/42365048'
        WHERE ST_Intersects(s.geom, a.geom)
          AND ST_Length(ST_Intersection(s.geom, a.geom)::geography) >= 0.5 * s.length_m
      )
      SELECT lugar, count(*) AS tramos,
        round((100 * sum(v.green_length_m) / sum(v.length_m))::numeric, 1) AS verde,
        round((100 * sum(v.tree_length_m) / sum(v.length_m))::numeric, 1) AS arbolado,
        round((100 * sum(v.green_area_length_m) / sum(v.length_m))::numeric, 1) AS zona_verde,
        round((100.0 * sum(v.trees_count) / sum(v.length_m))::numeric, 1) AS arboles_100m
      FROM ref r JOIN segment_vegetation v ON v.segment_id = r.id
      WHERE lugar IS NOT NULL GROUP BY lugar ORDER BY verde DESC;
      ```

      | Lugar | Tramos | Verde % | Junto a árboles % | En zona verde % | Árboles a ≤ 8 m / 100 m |
      | --- | --- | --- | --- | --- | --- |
      | Parque Grande (tramos con la mitad o más dentro) | 797 | 99,7 | 76,1 | 98,9 | 25,3 |
      | Paseo de la Independencia | 58 | 85,8 | 85,8 | 0,0 | 23,8 |
      | Calle de Don Jaime I | 26 | 64,4 | 64,4 | 0,0 | 15,6 |
      | Gran Vía | 90 | 59,1 | 40,4 | 28,5 | 6,8 |
      | Paseo de Fernando el Católico | 104 | 58,5 | 57,4 | 15,8 | 11,4 |
      | Calle de Alfonso I | 16 | 0,0 | 0,0 | 0,0 | 0,0 |

      Gran Vía tiene zona verde porque su bulevar central está etiquetado en OSM como
      `leisure=park` (`way/1065467174`).
- [ ] Con el servidor arrancado y `$token` como en la PBI-3.3,
      `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/data/status` →
      `imports` incluye `green_areas` (`importedCount` 793) y `vegetation` tiene `status`
      `success`, `segments` 91872, `greenPercentage` ≈ 20.3 y `stale` false.
- [ ] `npm run associate -- --type=trees` (92 s en la PBI-3.2; 455 s en esta medición, con poca RAM
      libre) → `vegetation.stale` true con
      `staleReasons` `["tree_association_changed"]`; `npm run import:green-areas` añade
      `green_areas_import_changed`; `npm run compute:vegetation` lo deja en false.
- [ ] `npm run lint`, `npm run format:check` y `npm run test:all` (con la BD levantada) en verde.
### PBI-8.2 - El viento en el cálculo de rutas

Con el servidor arrancado, `$token` como en la PBI-3.3 y la migración aplicada (`npm run db:migrate`).

- [ ] `GET /api/route-profiles` devuelve las rutas con `weights.wind` (0 en las ya guardadas).
- [ ] `POST /api/route-profiles` con `"weights": { "wind": 80 }` guarda la ruta con `wind: 80`;
      con `"wind": 101` → `400` con `fields.wind`.
- [ ] `POST /api/routes/weighted` con `"weights": { "wind": 100 }`, un viento fuerte en contra
      (`"wind": { "speedKmh": 50, "directionDeg": <rumbo del trayecto> }`) y un trayecto con
      alternativas: `fastest.windExposure.exposure` alto y, si hay una alternativa más resguardada
      dentro del tiempo extra, `status: "selected"` con `windChangePoints` negativo.
- [ ] La misma petición con `"weights": { "wind": 0 }` → `fastest_only`.
- [ ] Con el viento en sentido contrario (`directionDeg` + 180) la exposición de la ruta rápida
      baja a la mitad aproximadamente.
- [ ] Con solo viento y una hora de noche (`"time": "23:00"`) también se calcula (no hay
      `sun_below_horizon`).
- [ ] Sin `wind` en la petición, `comparison.wind.source` es `open-meteo`.
- [ ] `npm run ci` y `npm run test:integration -- src/tests/integration/routeProfiles.test.js`
      pasan con la BD de test levantada.

### PBI-8.1 - Exposición al viento por tramo

Valores reales del 2026-11-03 (solo hacen falta las calles: `npm run import:streets`). Con el
servidor arrancado y `$token` obtenido como en la PBI-3.3. Usa `curl.exe` en PowerShell. `<id>` es
el del Paseo de la Independencia: `GET /api/segments/by-source/399096155:2` (36044 en esa BD).

- [ ] Sin cabecera `Authorization`, `curl.exe -i http://localhost:3000/api/segments/<id>/wind-exposure`
      devuelve `401`.
- [ ] `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/segments/<id>/wind-exposure`
      → `wind.source` `open-meteo`, con la misma velocidad y dirección que `GET /api/weather/current`,
      y `windExposure` entre 0 y 100 (con 10,1 km/h desde 305° salió 0,005: casi calma).
- [ ] `?windSpeed=30&windDirection=300` → `orientationDeg` ≈ 36,2, `alignment` ≈ 0,107,
      `windExposure` ≈ 5,4.
- [ ] `?windSpeed=50&windDirection=36.2` → ≈ 100; con `126.2` (perpendicular) → ≈ 0,4; con `216.2`
      (sentido contrario) → otra vez ≈ 100.
- [ ] Con `?windSpeed=5&windDirection=0` → `intensity` 0 y `windExposure` 0.
- [ ] `?windSpeed=30` sin `windDirection` → `400` con `fields.windDirection`;
      `?windSpeed=30&windDirection=400` → `400`; `/api/segments/999999999/wind-exposure` → `404`.
- [ ] `npm run ci` y `npm run test:integration -- src/tests/integration/segmentQueries.test.js`
      pasan con la BD de test levantada.

### PBI-5.3 y PBI-5.4 - Exposición y Ruta Sombreada

- [ ] `npm run ci` valida porcentajes, ponderación por longitud, coste, alternativas, API y
      regresión de la ruta rápida.
- [ ] Con PostGIS, `npm run test:integration -- --runInBand
      src/tests/integration/routeSegments.test.js src/tests/integration/shadows.test.js` valida la
      asociación de corredores, el rechazo de cruces y la unión de sombras solapadas.
- [ ] Con datos urbanos, sesión y ORS configurado, `POST /api/routes/shaded` devuelve una
      alternativa real o `shaded: null` con estado explícito; nunca duplica la rápida con otro color.
- [ ] No hay migraciones, persistencia ni dependencias nuevas. Las variables
      `SHADOW_MIN_SUN_ELEVATION_DEG` y `SHADOW_QUERY_TIMEOUT_MS` son opcionales (ADR-015).
- [ ] Con `date` = `2026-10-29` y `time` = `17:55` (Sol a 0,9°), `POST /api/routes/shaded`
      responde en pocos segundos con `status: "sun_too_low"`; antes la consulta tardaba minutos.
- [ ] Con `time` = `12:00` del mismo día (Sol a 33,8°) sigue calculando la exposición.

### PBI-5.1 y PBI-5.2 - Posición solar y sombras

- [ ] `npm test -- --runInBand` valida la referencia NOAA de Zaragoza, horario de verano,
      entradas inválidas, dirección y longitud de los vectores y Sol bajo el horizonte.
- [ ] Con PostGIS arrancado, `npm run test:integration -- --runInBand
      src/tests/integration/shadows.test.js` proyecta un edificio y un árbol sintéticos hacia el
      oeste, comprueba que no sombrean el tramo este y verifica longitudes de 4 m.
- [ ] La misma prueba confirma que árboles sin altura o sin diámetro de copa se contabilizan como
      incompletos y no producen sombras inventadas.
- [ ] `npm run ci` termina correctamente. No hay migraciones, variables de entorno ni endpoints
      nuevos para estas PBIs.

### PBI-3.3 - Consulta de elementos urbanos por tramo

Valores reales del 2026-11-02, sobre los datos de las PBI-3.1 y 3.2. En PowerShell, `curl` es un
alias de `Invoke-WebRequest`: usa `curl.exe` o `Invoke-RestMethod`.

- [ ] Con el servidor arrancado (`npm start`; `JWT_SECRET` definido en `.env`) y un usuario
      (`POST /api/auth/register`, solo la primera vez), obtén el token:
      `$token = (Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType "application/json" -Body '{"email":"ana@correo.es","password":"segura123"}').token`
- [ ] Sin cabecera `Authorization`, las cuatro consultas devuelven `401`:
      `curl.exe -i http://localhost:3000/api/data/status`
- [ ] `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/segments/by-source/399096155:2`
      → "Paseo de la Independencia", `tertiary`, 83,2 m; anota su `id` (36202 en la BD de desarrollo).
- [ ] `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/segments/36202/urban-elements`
      → `summary`: `trees` 61, `nearestTrees` 10, `buildings` 15, `associationStale` false.
- [ ] `curl.exe -H "Authorization: Bearer $token" "http://localhost:3000/api/segments/36202/urban-elements?types=buildings"`
      → solo `segment`, `buildings` y `summary`, sin `trees`.
- [ ] `curl.exe -H "Authorization: Bearer $token" "http://localhost:3000/api/segments/nearest?lat=41.6488&lng=-0.8891"`
      → Calle Hernán Cortés (`710633478:0`) a unos 0,24 m.
- [ ] `curl.exe -H "Authorization: Bearer $token" "http://localhost:3000/api/segments/nearest?lat=41.80&lng=-0.70"`
      → `404` ("No hay ningún tramo a menos de 150 m…"); con `lat=40&lng=-3` → `400`.
- [ ] `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/segments/0/urban-elements`
      → `400` con `fields.id`; con `/api/segments/999999999/urban-elements` → `404`.
- [ ] `curl.exe -H "Authorization: Bearer $token" http://localhost:3000/api/data/status`
      → `imports` de `buildings`, `streets` y `trees` en `success`; `associations` de `building`
      (99,299 %, 273 aislados) y `tree` (100 %), ambas con `stale: false`.
- [ ] Tras `npm run import:trees`, la misma consulta muestra el tipo `tree` con `stale: true` y
      `urban-elements?types=trees` devuelve `associationStale: true`; `npm run associate` lo deja
      otra vez en `false`.
- [ ] `npm run test:integration -- src/tests/integration/segmentQueries.test.js` pasa con la BD de
      test levantada.

### PBI-3.2 - Asociación de edificios y arbolado a tramos peatonales

Valores reales del 2026-10-19, sobre los datos de la PBI-3.1.

- [ ] Con los datos de la PBI-3.1 cargados, `npm run db:migrate` solo aplica
      `20261019000001-create-associations` (`SELECT name FROM sequelize_meta;` → 6 migraciones,
      contando `20261009000001-create-users` de la PBI-4).
- [ ] `npm run associate` termina con `success` en `tree` y `building`, en unos 3 minutos, y con
      código de salida 0.
- [ ] `SELECT element_type, status, total, nearest_ok, isolated, radius_links, pct_associated FROM association_runs ORDER BY id DESC LIMIT 2;`
      → `tree`: 172.543 / 172.543 / 0 / 1.008.612 / 100,000; `building`: 38.963 / 38.690 /
      273 / 428.619 / 99,299.
- [ ] Cuadre:
      `SELECT (SELECT count(*) FROM buildings), (SELECT count(*) FROM segment_buildings WHERE is_nearest), (SELECT count(*) FROM unassociated_elements WHERE element_type = 'building');`
      → 38.963 = 38.690 + 273 (con `trees`, `segment_trees` y `'tree'`: 172.543 = 172.543 + 0).
- [ ] Ningún elemento en las dos tablas:
      `SELECT count(*) FROM unassociated_elements u JOIN segment_buildings sb ON sb.building_id = u.element_id WHERE u.element_type = 'building';` → 0.
- [ ] Aislados más lejanos:
      `SELECT element_id, round(nearest_distance_m) FROM unassociated_elements ORDER BY nearest_distance_m DESC LIMIT 5;`
      → 23461 (588), 2974 (461), 2971 (453), 23379 (442), 22830 (429): edificios de campo o de la
      periferia.
- [ ] El radio de los edificios depende de la altura:
      `SELECT count(*) FROM segment_buildings sb JOIN buildings b ON b.id = sb.building_id WHERE NOT sb.is_nearest AND sb.distance_m > GREATEST(30, b.height_m * 1.5);` → 0.
- [ ] `npm run associate -- --type=trees` otra vez: `SELECT count(*) FROM segment_trees;` sigue en
      1.181.155.
- [ ] Tras cualquier `npm run import:*`, el log avisa de que hay que ejecutar `npm run associate`
      y `SELECT element_type, status FROM association_runs ORDER BY id DESC LIMIT 2;` muestra `stale`
      en el tipo afectado.

### PBI-4 - Registro e inicio de sesión

- [ ] `npm run db:migrate` aplica `20261009000001-create-users` y `\d users` (en
      `docker compose exec db psql -U weathermapz -d weathermapz`) muestra la tabla.
- [ ] Sin `JWT_SECRET` en el `.env`, `POST /api/auth/register` devuelve `503`; con él, `201`.
- [ ] Registrarse dos veces con el mismo email, aunque cambien las mayúsculas, devuelve `409`.
- [ ] La contraseña no se guarda en texto plano:
      `SELECT email, left(password_hash, 7) FROM users;` → empieza por `$2b$10$`.
- [ ] Login con contraseña incorrecta o email inexistente → `401` con el mismo mensaje.
- [ ] `GET /api/auth/me` con el token del login → `200` con `{ user }`; sin token → `401`.
- [ ] `POST /api/routes/fastest` y `GET /api/geocoding/autocomplete` sin token → `401`; con
      token → funcionan como antes.
- [ ] Sin `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GET /api/auth/google` redirige a
      `FRONTEND_URL/#authError=google`.
- [ ] Con Google configurado, el login con una cuenta de prueba vuelve al frontend con sesión y
      crea la fila en `users` con `google_id` (o lo añade a la cuenta con el mismo email).
- [ ] Cancelar en la pantalla de Google vuelve al login del frontend con un aviso.

### PBI-3.1 - Importación de edificios y arbolado

- [ ] `docker compose up -d db` y `npm run db:migrate` terminan sin errores y aplican las cuatro
      migraciones de la PBI-3.1 (`SELECT name FROM sequelize_meta;`; seis desde la PBI-3.2). En
      una base de datos que ya tenía las tres primeras, `npm run db:migrate` solo añade
      `20261006000004-add-building-height-suspicious`.
- [ ] `npm run import:all` termina con `SUCCESS` en `buildings`, `trees` y `streets`, y con código
      de salida 0.
- [ ] Los conteos coinciden con la fuente:
      `SELECT dataset, source_count, imported_count, rejected_count, status FROM import_runs ORDER BY id DESC LIMIT 3;`
      Compara `source_count` con el `numberMatched` de
      `https://idezar-sig.zaragoza.es/servicios/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=citygml3d:building&resultType=hits`
      (y de `idezar_base:arboles_2022`).
- [ ] `SELECT count(*) FROM buildings;`, `trees` y `street_segments` coinciden con `imported_count`.
- [ ] Los rechazos son visibles: `SELECT dataset, reason, count(*) FROM import_rejections GROUP BY 1, 2;`
- [ ] Volver a ejecutar `npm run import:trees` no cambia `SELECT count(*) FROM trees;`.
- [ ] `SELECT height_source, count(*) FROM buildings GROUP BY 1;` → measured ≈ 38.712,
      floors_estimate ≈ 248, default ≈ 3 (valores del 2026-10-06; cambian un poco si se actualiza
      la fuente).
- [ ] `SELECT count(*) FROM buildings WHERE height_suspicious;` → ≈ 727.
- [ ] Un edificio de una planta con 12 m medidos conserva sus 12 m:
      `SELECT height_m, height_source, height_suspicious FROM buildings WHERE source_id = 'ES.SDGC.BU.1250607XM8015A07';`
      → `12 | measured | f`.
- [ ] Las alturas de una planta no se recortan:
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY height_m), percentile_cont(0.9) WITHIN GROUP (ORDER BY height_m) FROM buildings WHERE floors = 1;`
      → 4.6 y 7.8.

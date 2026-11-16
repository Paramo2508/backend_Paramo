# Despliegue en producción (Azure)

WeatherMapZ se despliega en una única máquina virtual de Azure (suscripción Azure for Students) con
Docker Compose:

```text
Internet ──443/80──► caddy ──/api/*──► backend (Node, :3000) ──► db (PostGIS)
                       └────resto────► frontend (nginx, :8080)
```

- **caddy** es el único contenedor con puertos publicados. Obtiene y renueva solo el certificado
  HTTPS de Let's Encrypt para `DOMAIN`.
- **backend** y **frontend** son imágenes que GitHub Actions publica en GHCR desde cada repositorio.
- **db** usa `postgis/postgis:17-3.5` con el volumen `pgdata`. No es accesible desde fuera del
  servidor.

Nada de esto depende de Azure: el mismo script y el mismo Compose sirven en cualquier VM Ubuntu
24.04 x64 con Docker.

Ficheros de esta carpeta:

| Fichero | Uso |
| --- | --- |
| `docker-compose.yml` | Servicios de producción. El workflow lo copia a `/opt/weathermapz/` en cada despliegue. |
| `Caddyfile` | Proxy y HTTPS. También se copia en cada despliegue. |
| `production.env.example` | Plantilla del `/opt/weathermapz/.env` del servidor (secretos; nunca en Git). |
| `setup-server.sh` | Preparación inicial de la VM (Docker, cortafuegos, swap, usuario `deploy`). |

## 1. Crear la máquina virtual

Necesitas una clave SSH personal para administrar la VM. Si no tienes una (`~/.ssh/id_ed25519.pub`),
créala con `ssh-keygen -t ed25519`.

En [portal.azure.com](https://portal.azure.com), **Máquinas virtuales → Crear → Máquina virtual de
Azure**:

**Datos básicos**

- Suscripción: **Azure for Students**.
- Grupo de recursos: nuevo, `weathermapz-rg`.
- Nombre de la máquina virtual: `weathermapz-vm`.
- Región: `(Europe) Spain Central`, la que usa producción. La suscripción de estudiante solo
  permite `austriaeast`, `spaincentral`, `denmarkeast`, `norwayeast` y `belgiumcentral`; otras
  regiones (por ejemplo West Europe) dan error de región no permitida.
- Opciones de disponibilidad: no se requiere redundancia de la infraestructura.
- Tipo de seguridad: estándar.
- Imagen: **Ubuntu Server 24.04 LTS - x64 Gen2**.
- Tamaño: **Standard_B2ats_v2** (2 vCPU AMD x64, 1 GB de RAM), el más pequeño x64 disponible en
  esas regiones; `Standard_B1ms` (2 GB) no está disponible en ninguna. Comprueba el precio mensual
  que muestra el portal (unos 15 $/mes entre VM, disco e IP).
- Tipo de autenticación: **Clave pública SSH**. Usuario: `azureuser`. Origen de la clave: usar una
  clave pública existente y pega el contenido de tu `~/.ssh/id_ed25519.pub`.
- Puertos de entrada públicos: permitir **SSH (22), HTTP (80) y HTTPS (443)**.

**Discos**

- Tipo de disco del SO: **SSD estándar** (más barato que el Premium y suficiente).
- Marca **Eliminar con la máquina virtual**.

**Redes**

- Deja la red virtual y la IP pública nuevas que propone.
- Marca **Eliminar la IP pública y la NIC cuando se elimine la VM**.

**Administración**

- **Apagado automático: desactivado.** El servidor debe estar siempre encendido.

**Revisar y crear → Crear.**

Cuando termine, abre el recurso de la **dirección IP pública** de la VM → **Configuración**:

- Asignación: **Estática**, para que la IP no cambie al reiniciar.
- Etiqueta de nombre DNS: `weathermapz` (o la que esté libre). El dominio queda como
  `weathermapz.<región>.cloudapp.azure.com`; ese es el valor de `DOMAIN`.

**Presupuesto.** En **Administración de costos → Presupuestos**, crea uno de 20 € al mes sobre la
suscripción con alerta al 50 % y al 90 %, para enterarte antes de que se acabe el crédito.

## 2. Preparar el servidor

Crea en tu equipo una clave SSH **solo para GitHub Actions** (sin passphrase):

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-weathermapz" -f weathermapz-deploy
```

Desde la raíz del repositorio backend, ejecuta el script en la VM con `sudo`, pasándole la clave
pública:

```bash
ssh azureuser@<DOMAIN> 'sudo sh -s' -- "$(cat weathermapz-deploy.pub)" < deploy/setup-server.sh
```

Después crea el `.env` de producción en el servidor:

```bash
scp deploy/production.env.example azureuser@<DOMAIN>:/tmp/weathermapz.env
ssh azureuser@<DOMAIN> 'sudo install -m 600 -o deploy -g deploy /tmp/weathermapz.env /opt/weathermapz/.env && rm /tmp/weathermapz.env'
ssh -t azureuser@<DOMAIN> 'sudo nano /opt/weathermapz/.env'
```

Rellena `DOMAIN`, `DB_PASSWORD` y `JWT_SECRET` (genera ambos con `openssl rand -hex 32`),
`ORS_API_KEY` y, si queréis login con Google, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
`BACKEND_IMAGE` y `FRONTEND_IMAGE` deben ser el nombre de cada repositorio de la organización en
minúsculas.

`ORS_API_KEY` es la clave de OpenRouteService **de producción**, distinta de la de desarrollo que
cada uno tiene en su `backend/.env` local (#160). Solo vive en este `.env` del servidor: no va en
Git ni en los secretos de GitHub Actions, porque el workflow no la necesita (los tests usan
OpenRouteService simulado).

## 3. Configurar GitHub (en los dos repositorios de la organización)

En **Settings → Secrets and variables → Actions**, a nivel de **repositorio** (no de entorno: el
`if` del job lee `DEPLOY_HOST` antes de cargar el entorno `production`, que GitHub crea solo en el
primer despliegue):

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | El dominio (`weathermapz.<región>.cloudapp.azure.com`) o la IP pública |
| Variable | `DEPLOY_USER` | `deploy` |
| Variable | `DEPLOY_DOMAIN` | El mismo valor que `DOMAIN` |
| Secret | `DEPLOY_SSH_KEY` | Contenido de `weathermapz-deploy` (la clave **privada**) |
| Secret | `DEPLOY_KNOWN_HOSTS` | Salida de `ssh-keyscan -t ed25519 <DEPLOY_HOST>` |

Comprueba la huella de `ssh-keyscan` con la de
`ssh azureuser@<DOMAIN> 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'` antes de guardarla.
Después borra la clave privada de tu equipo.

Si `DEPLOY_HOST` no está definida (por ejemplo, en los forks), el workflow publica la imagen pero se
salta el despliegue.

## 4. Primer despliegue

1. Ejecuta **Actions → Deploy → Run workflow** en el repositorio **backend**. Copia
   `docker-compose.yml` y `Caddyfile`, arranca PostGIS, aplica las migraciones y arranca el
   backend y Caddy.
2. Ejecuta el mismo workflow en el repositorio **frontend_web**.
3. Abre `https://<DOMAIN>` y `https://<DOMAIN>/api/health`.

A partir de ahí, cada merge a `main` despliega solo su parte.

Las imágenes de GHCR son privadas por defecto. El workflow inicia sesión en GHCR desde el servidor
con el token temporal del job y la cierra al terminar, así que no hace falta hacerlas públicas.
Cada repositorio guarda ese login en su propio directorio (`DOCKER_CONFIG=~/.docker-ghcr-backend` o
`~/.docker-ghcr-frontend` del usuario `deploy`): el token de un repo no puede descargar la imagen
del otro, y con un login compartido dos Deploys simultáneos se pisaban y fallaban con `denied`.

## 5. Importar los datos urbanos y asociarlos a los tramos

Se hace a mano, una vez y cada vez que se quiera refrescar: primero los imports (unos 20 minutos,
con las zonas verdes de la PBI-10), después la asociación de árboles y edificios a los tramos
peatonales (unos 3 minutos) y por último el índice de vegetación (PBI-10, unos 60 s en local).
Después de cualquier `import:*` hay que volver a ejecutar `associate` y `compute:vegetation`.

```bash
ssh azureuser@<DOMAIN>
sudo -iu deploy
cd /opt/weathermapz
docker compose run --rm backend npm run import:all
docker compose run --rm backend npm run associate
docker compose run --rm backend npm run compute:vegetation
```

Con 1 GB de RAM, si alguno de los comandos se queda sin memoria (el contenedor sale con código 137 o
`sudo dmesg` muestra "Out of memory"), amplía la VM un rato a `Standard_B2als_v2` (4 GB), repite el
comando y vuelve a `Standard_B2ats_v2`. Azure cobra por horas.

## 6. Login con Google

En Google Cloud Console → Credentials → el cliente OAuth:

- Authorized JavaScript origins: `https://<DOMAIN>`
- Authorized redirect URIs: `https://<DOMAIN>/api/auth/google/callback`

## Operación

Siempre desde `/opt/weathermapz` como `deploy` (`sudo -iu deploy`):

```bash
docker compose ps                               # estado de los servicios
docker compose logs -f backend                  # logs (también caddy, frontend, db)
docker compose exec db psql -U weathermapz      # consola SQL
docker compose exec db pg_dump -U weathermapz weathermapz | gzip > backup-$(date +%F).sql.gz
```

**Host de OpenRouteService.** Desde #160 (cambio a `api.heigit.org`) el backend usa por defecto
`https://api.heigit.org/openrouteservice/v2/directions` y `https://api.heigit.org/pelias/v1`; el
host antiguo `api.openrouteservice.org` está obsoleto y con una décima parte de la cuota. No hay
que tocar `/opt/weathermapz/.env`, salvo que alguien haya puesto a mano
`OPENROUTESERVICE_DIRECTIONS_BASE_URL` o `OPENROUTESERVICE_GEOCODING_BASE_URL` con el host antiguo:
en ese caso, borra esas líneas y ejecuta `docker compose up -d --force-recreate backend`.

**Volver a una versión anterior.** Cada imagen también se publica con el SHA del commit. Pon
`BACKEND_TAG=<sha>` (o `FRONTEND_TAG`) en `.env` y ejecuta `docker compose up -d backend`. Quita la
línea antes del siguiente despliegue normal. Las migraciones no se deshacen solas.

### Cambiar la clave de OpenRouteService

La clave de producción (#160) se crea en el dashboard de
[openrouteservice.org](https://openrouteservice.org/dev/#/home) con un nombre que la distinga de la
de desarrollo (por ejemplo `weathermapz-prod` y `weathermapz-dev`) y se pasa a quien gestione el
servidor por un canal privado, nunca por Git ni por el chat del equipo. Para ponerla o cambiarla:

```bash
ssh -t azureuser@<DOMAIN> 'sudo nano /opt/weathermapz/.env'   # ORS_API_KEY=<clave de producción>
ssh azureuser@<DOMAIN>
sudo -iu deploy
cd /opt/weathermapz
docker compose up -d --force-recreate backend   # el contenedor vuelve a leer el .env
docker compose logs --since 2m backend          # no debe aparecer "ORS_API_KEY is not set"
```

Comprueba después que la búsqueda de lugares de `https://<DOMAIN>` sugiere direcciones. Si la clave
falta, el backend arranca igual, escribe ese aviso en el log, `/api/health` responde y la búsqueda
de lugares y las rutas responden `503`.

**Crédito.** Consulta el saldo en el portal (busca "Education") o en
`microsoftazuresponsorships.com/balance`. Si se acaba, otra persona del equipo puede activar su
propio Azure for Students y migrar: nueva VM con este mismo procedimiento y `pg_dump`/`psql` de la
base de datos.

**Al acabar el curso**, elimina el grupo de recursos `weathermapz-rg` para borrarlo todo de una vez.

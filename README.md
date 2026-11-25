# albergue-api

API del sistema del **Albergue Luis Aarón**, reconstruida a partir del esquema real de la base
(Neon/PostgreSQL) y del contrato que consume el frontend (`AlbergueAncla`, React + Vite).
Reemplaza al backend original (que no estaba publicado en GitHub).

## Estado actual (desplegado)

| Qué | Dónde |
|---|---|
| API en producción | <https://albergue-api.onrender.com> (`/healthz`) |
| Frontend | <https://albergueluisaaron.web.app> |
| Código de la API | <https://github.com/ninetieth6945/albergue-api> |
| Panel de Render | <https://dashboard.render.com/web/srv-dc34qt68bjmc73eirlcg> |
| Base de datos | Neon, proyecto `albergue`, rama `production`, base `neondb` |

El despliegue de la API es automático: cada `git push` a `main` reconstruye la imagen.
Los secretos viven solo en Render (archivo local de referencia: `.env.produccion`, ignorado por git).

## Arquitectura gratuita

| Pieza | Servicio | Plan |
|---|---|---|
| Frontend | Firebase Hosting (`albergueluisaaron`) | Spark (gratis) |
| Base de datos | Neon PostgreSQL 18 (`neondb`) | Free (1 GB) |
| API | Render Web Service (Docker) | Free (512 MB, duerme a los 15 min) |
| Autenticación | Firebase Authentication (`albergueluisaaron`) | Spark |
| Comprobantes | Guardados como `bytea` en la propia base (tabla `archivos`) | — |

No se usa disco persistente: Render borra el sistema de archivos al reiniciar, por eso los
archivos viven en Neon. El frontend ya comprime las fotos a WebP (máx. 1600 px) antes de subirlas.

## Requisitos

- Node.js 20+ y npm.
- Una base Neon con el esquema restaurado (ya está lista).
- Cuenta de servicio de Firebase con permiso para *Firebase Authentication*.

## Desarrollo local

```bash
npm install
cp .env.example .env      # completa DATABASE_URL
npm start                 # http://localhost:3004/healthz
```

Para probar sin token de Firebase (solo local):

```env
ALLOW_ANONYMOUS=true
```

En producción **no** se debe definir `ALLOW_ANONYMOUS` (`NODE_ENV=production` ya exige token).

### Catálogos mínimos

La base viene sin datos. Para crear los tipos de apoyo y destinos de donación iniciales:

```bash
npm run seed:catalogos
```

Hospitales, municipios/localidades, habitaciones y camas se capturan desde **Catálogos** en el sistema.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena **pooled** de Neon (`-pooler` y `pgbouncer=true`). |
| `FIREBASE_SERVICE_ACCOUNT` | Sí (producción) | JSON de la cuenta de servicio en **una sola línea**. También acepta `FIREBASE_SERVICE_ACCOUNT_BASE64`, `FIREBASE_SERVICE_ACCOUNT_FILE` o `GOOGLE_APPLICATION_CREDENTIALS`. |
| `ADMIN_EMAILS` | Recomendada | Correos separados por coma que se crean como Administrador (nivel 3) la primera vez que inician sesión. |
| `CORS_ORIGIN` | Recomendada | Orígenes permitidos, separados por coma. |
| `ARCHIVOS_SECRET` | Recomendada | Secreto largo para firmar los enlaces de comprobantes. Si cambia, los enlaces viejos dejan de funcionar. |
| `PORT` | No | Render la inyecta. Local: 3004. |
| `ALLOW_ANONYMOUS` | No | Solo para desarrollo local sin Firebase. Nunca en producción. |
| `TZ_OFFSET` | No | Desfase usado en filtros de fecha (por defecto `-06:00`). |

### Cuenta de servicio de Firebase

El archivo `/home/diego/Downloads/env` ya contiene el JSON en una línea. Para pasarlo a Render:
copia **todo** el valor de `FIREBASE_SERVICE_ACCOUNT=` (sin las comillas externas) como secreto.
No lo subas al repositorio.

## Autenticación y permisos

- El frontend inicia sesión con Firebase y envía `Authorization: Bearer <idToken>`.
- La API valida el token y busca el perfil en `users` por correo.
- Si el correo está en `ADMIN_EMAILS` y no existe el perfil, se crea con nivel 3.
- Cuenta desactivada (`active = 'N'`) → 403.
- `/users/*` (excepto `/users/me`) y `/auditoria` requieren nivel 3.
- Un usuario autenticado sin fila en `users` recibe 403 y no puede operar.

> **Primer ingreso:** agrega tu correo en `ADMIN_EMAILS`, inicia sesión y ya podrás crear usuarios
> (la contraseña se crea/actualiza en Firebase Authentication desde `/users/create` y `/users/update`).

## Endpoints

Todos devuelven `{ data, meta: { page, pageSize, total, totalPages } }` salvo los indicados.
`/users/get` usa `{ data, pagination }` (como espera la pantalla de Usuarios).

```
GET    /healthz
GET    /users/me                     → { data: usuario }
GET    /users/get?page&limit&filter
POST   /users/create                 (crea/actualiza la contraseña en Firebase)
PUT    /users/update                 { id_user, ... }
DELETE /users/:id

GET    /beneficiarios?q&tipo&estatus&id_paciente_relacionado&desde&hasta&orden
GET    /beneficiarios/:id            (incluye familiares, contactos, diagnósticos)
POST   /beneficiarios                (folio BEN-00001 automático)
PUT    /beneficiarios/:id
DELETE /beneficiarios/:id            (409 si tiene estancias o apoyos)
GET    /beneficiarios/:id/contactos
POST   /beneficiarios/:id/contactos
PUT    /contactos-emergencia/:id
DELETE /contactos-emergencia/:id
GET    /beneficiarios/:id/diagnosticos   (audita cada consulta)
POST   /beneficiarios/:id/diagnosticos
PUT    /diagnosticos/:id
DELETE /diagnosticos/:id

GET    /estancias?enCurso&id_paciente&desde&hasta
POST   /estancias                    (valida persona y cama libres)
PUT    /estancias/:id                (acepta { enCurso: true|false })
POST   /estancias/:id/salida
DELETE /estancias/:id
GET    /estancias/ocupacion          → { totales, habitaciones[{ camas[{ ocupada, estancia }] }] }

GET    /apoyos?q&id_beneficiario&id_tipo_apoyo&desde&hasta&activo
GET    /apoyos/resumen?desde&hasta
POST   /apoyos
PUT    /apoyos/:id
DELETE /apoyos/:id

GET    /donantes?q&tipo&recurrente&desde&hasta&activo&orden
POST   /donantes
PUT    /donantes/:id
DELETE /donantes/:id                 (409 si tiene donaciones)
GET    /donaciones?q&tipo&id_donante&desde&hasta&activo
GET    /donaciones/resumen?desde&hasta
POST   /donaciones                   (los artículos con medicamento entran al inventario)
PUT    /donaciones/:id
DELETE /donaciones/:id               (revierte el inventario generado)

GET/POST/PUT/DELETE  /municipios, /localidades, /hospitales, /tipos-apoyo, /destinos-donacion
GET/POST/PUT/DELETE  /habitaciones (incluye camas), /camas
GET    /habitaciones?activa&q

GET    /medicamentos?q&activo&orden   (incluye stock calculado)
GET    /medicamentos/:id              (incluye lotes con stock)
POST   /medicamentos
PUT    /medicamentos/:id
DELETE /medicamentos/:id
POST   /medicamentos/:id/lotes
DELETE /medicamentos/:id/lotes/:loteId
GET    /medicamentos/caducidades?dias=60
GET    /inventario/movimientos?tipo&id_medicamento&desde&hasta
POST   /inventario/movimientos        (una salida sin lote se reparte FIFO entre lotes)

GET    /alimentos ... (misma estructura que medicamentos)
GET    /alimentos/caducidades?dias=60
GET    /inventario-alimentos/movimientos
POST   /inventario-alimentos/movimientos

POST   /archivos                     (multipart, campo "archivo", máx. 15 MB, JPG/PNG/WebP/PDF)
GET    /archivos/:id/contenido?firma=...   (público con firma HMAC; también acepta Bearer)
DELETE /archivos/:id

GET    /auditoria?accion&entidad&entidadId&desde&hasta
```

## Despliegue en Render (gratis, sin tarjeta)

El servicio ya está creado con el plan **Free**. Para publicar cambios basta con:

```bash
git push origin main
```

El workflow `.github/workflows/deploy.yml` avisa a Render (con el secreto `RENDER_API_KEY`) para
que reconstruya la imagen. También se puede lanzar a mano desde **Actions → desplegar en Render**,
o desde el panel de Render con **Manual Deploy → Deploy latest commit**.

Si se quiere recrear desde cero: **New → Blueprint**, elegir el repo y Render lee `render.yaml`.
Las variables de entorno se capturan en **Environment** del servicio (valores en `.env.produccion`).

### Frontend

El frontend guarda la dirección de la API en `AlbergueAncla/.env.production`
(`VITE_API_URL=https://albergue-api.onrender.com`), así que basta con:

```bash
cd ../AlbergueAncla
npm run build
firebase deploy --only hosting
```

### Evitar que Render duerma

El plan Free duerme tras 15 minutos sin tráfico. El workflow
`.github/workflows/keep-alive.yml` hace `GET /healthz` cada 10 minutos desde GitHub Actions
(gratis en repos públicos), lo que mantiene el servicio despierto sin depender de tu equipo.
GitHub desactiva los workflows programados tras 60 días sin actividad en el repo: basta con
entrar a **Actions → mantener API despierta → Run workflow** una vez al mes.

## Notas y límites

- **Neon Free**: 1 GB. Los comprobantes cuentan ahí; el frontend comprime fotos, pero conviene
  borrar comprobantes viejos si el uso crece.
- **Render Free**: 512 MB de RAM y CPU compartida. Suficiente para este sistema.
- **Enlaces de archivos**: se firman con `ARCHIVOS_SECRET` y no caducan. Si rotas el secreto,
  actualiza los comprobantes existentes o mantén el secreto anterior.
- **Borrados**: los catálogos en uso responden 409 (no se pueden borrar); desactívalos con el
  interruptor. Los beneficiarios con historial tampoco se borran: cambia su estatus.
- **Zona horaria**: los filtros de fecha asumen México centro (`-06:00`).

## Seguridad pendiente (importante)

Estos secretos estuvieron expuestos fuera de este repositorio; conviene rotarlos:

1. Contraseña de Neon (`neondb_owner`).
2. Llave de la cuenta de servicio de Firebase (el `gas-station.json` del backend viejo).
3. Token de GitHub que está en `/home/diego/Downloads/tsc.txt`.

Al rotarlos, actualiza `DATABASE_URL` y `FIREBASE_SERVICE_ACCOUNT` en Render y vuelve a desplegar.

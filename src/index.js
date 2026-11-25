import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { prisma } from './prisma.js'
import { inicializarFirebase, autenticar, exigirPerfil, firebaseConfigurado } from './auth.js'
import { ApiError } from './lib/utils.js'

import archivos from './routes/archivos.js'
import users from './routes/users.js'
import auditoria from './routes/auditoria.js'
import beneficiarios from './routes/beneficiarios.js'
import estancias from './routes/estancias.js'
import apoyos from './routes/apoyos.js'
import donaciones from './routes/donaciones.js'
import donantes from './routes/donantes.js'
import catalogos from './routes/catalogos.js'
import medicamentos from './routes/medicamentos.js'
import alimentos from './routes/alimentos.js'
import movimientos from './routes/movimientos.js'

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// ── CORS ──────────────────────────────────────────────────────────────────
const origenes = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true) // curl, apps móviles, health checks
      if (origenes.includes(origin) || localhost.test(origin) || origenes.length === 0) return cb(null, true)
      cb(new ApiError(403, `Origen no permitido por CORS: ${origin}`))
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
)

// ── Salud y raíz (sin autenticación) ─────────────────────────────────────
const salud = async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, db: 'ok', uptime: Math.round(process.uptime()), ts: new Date().toISOString() })
  } catch (e) {
    res.status(503).json({ ok: false, db: 'error', message: e.message })
  }
}
app.get('/healthz', salud)
app.get('/health', salud)

app.get('/', (req, res) => {
  res.json({
    name: 'albergue-api',
    version: '1.0.0',
    description: 'API del sistema del Albergue Luis Aarón',
    health: '/healthz',
  })
})

// Los archivos se montan antes del middleware global porque su GET se firma con HMAC
// (las etiquetas <img>/<a> no envían la cabecera Authorization).
app.use(archivos)

// ── Autenticación ────────────────────────────────────────────────────────
app.use(autenticar)

// /users/me debe responder 404 (no 403) cuando la cuenta aún no tiene perfil.
app.use(users)
app.use(auditoria)

// A partir de aquí se exige perfil activo en la base.
app.use(exigirPerfil)

app.use(beneficiarios)
app.use(estancias)
app.use(apoyos)
app.use(donaciones)
app.use(donantes)
app.use(catalogos)
app.use(medicamentos)
app.use(alimentos)
app.use(movimientos)

app.use((req, res, next) => {
  next(new ApiError(404, `Ruta no encontrada: ${req.method} ${req.path}`))
})

// ── Manejo de errores ────────────────────────────────────────────────────
const nombresDeCampo = {
  folio: 'folio',
  curp: 'CURP',
  email: 'correo',
  nombre: 'nombre',
  id_habitacion: 'habitación y nombre',
  id_user: 'identificador',
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)

  if (err instanceof ApiError) {
    return res.status(err.status).json({ message: err.message, ...(err.details ? { details: err.details } : {}) })
  }

  if (err?.code === 'P2002') {
    const destino = Array.isArray(err.meta?.target) ? err.meta.target : [err.meta?.target].filter(Boolean)
    const campos = destino.map((c) => nombresDeCampo[c] ?? c).join(', ')
    return res.status(409).json({
      message: `Ya existe un registro con ese ${campos || 'valor'}`,
      details: destino.map((campo) => ({ campo, mensaje: 'Valor duplicado' })),
    })
  }

  if (err?.code === 'P2003' || err?.code === 'P2014') {
    return res.status(409).json({
      message: 'No se puede completar la operación: el registro está en uso por otros datos.',
    })
  }

  if (err?.code === 'P2025') {
    return res.status(404).json({ message: 'Registro no encontrado' })
  }

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'El archivo supera el límite de 15 MB' })
  }

  if (err?.name === 'PrismaClientValidationError') {
    return res.status(400).json({ message: 'Datos inválidos para la operación' })
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'El cuerpo de la petición no es un JSON válido' })
  }

  console.error('[error]', err)
  res.status(err?.status && err.status < 500 ? err.status : 500).json({
    message: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err?.message || 'Error interno',
  })
})

// ── Arranque ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3004
const HOST = '0.0.0.0'

if (!process.env.DATABASE_URL) {
  console.error('[inicio] Falta DATABASE_URL')
  process.exit(1)
}

inicializarFirebase()
if (process.env.NODE_ENV === 'production' && !firebaseConfigurado()) {
  console.warn('[inicio] ATENCIÓN: sin Firebase configurado, ninguna petición autenticada funcionará.')
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[inicio] albergue-api escuchando en http://${HOST}:${PORT}`)
  console.log(`[inicio] CORS: ${origenes.length ? origenes.join(', ') : 'todos los orígenes (desarrollo)'}`)
  console.log(`[inicio] Firebase: ${firebaseConfigurado() ? 'configurado' : 'NO configurado'}`)
})

const cerrar = async (senal) => {
  console.log(`[cierre] ${senal}: cerrando servidor…`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', () => void cerrar('SIGTERM'))
process.on('SIGINT', () => void cerrar('SIGINT'))

export default app

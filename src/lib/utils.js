// Utilidades compartidas: errores, paginación, validación y enlaces de archivos.
import crypto from 'node:crypto'

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

// Envuelve handlers async para que los errores lleguen al manejador de Express.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export const aEntero = (v, def = null) => {
  if (v === undefined || v === null || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : def
}

export const aBooleano = (v) => {
  if (v === true || v === 'true' || v === '1' || v === 1) return true
  if (v === false || v === 'false' || v === '0' || v === 0) return false
  return undefined
}

export const num = (v) => (v === null || v === undefined ? null : Number(v))

export const texto = (v) => (v === undefined || v === null ? null : String(v).trim() || null)

export const enteroONull = (v) => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new ApiError(400, 'Valor numérico inválido')
  return Math.trunc(n)
}

export const requerido = (v, campo, mensaje = 'Es obligatorio') => {
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new ApiError(400, 'Datos incompletos', [{ campo, mensaje }])
  }
}

export const invalido = (campo, mensaje) => {
  throw new ApiError(400, 'Datos inválidos', [{ campo, mensaje }])
}

export const paginacion = (req, { porDefecto = 10, max = 1000 } = {}) => {
  const page = Math.max(1, aEntero(req.query.page, 1))
  const pageSize = Math.min(max, Math.max(1, aEntero(req.query.pageSize ?? req.query.limit, porDefecto)))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export const paginado = (data, total, page, pageSize) => ({
  data,
  meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 },
})

export const buscarEn = (campos, q) => {
  if (!q) return null
  const texto = String(q).trim()
  if (!texto) return null
  return { OR: campos.map((campo) => ({ [campo]: { contains: texto, mode: 'insensitive' } })) }
}

// Zona horaria usada por el albergue (México centro). Solo afecta filtros por rango.
const OFFSET = process.env.TZ_OFFSET || '-06:00'
const soloFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v))

export const rangoFecha = (req, campo, { fechaPura = true } = {}) => {
  const { desde, hasta } = req.query
  if (!desde && !hasta) return null
  const f = {}
  if (desde) {
    const v = String(desde)
    f.gte = new Date(soloFecha(v) ? `${v}T00:00:00.000${fechaPura ? 'Z' : OFFSET}` : v)
  }
  if (hasta) {
    const v = String(hasta)
    f.lte = new Date(soloFecha(v) ? `${v}T23:59:59.999${fechaPura ? 'Z' : OFFSET}` : v)
  }
  return { [campo]: f }
}

export const unir = (...partes) => {
  const and = partes.flat().filter(Boolean)
  return and.length ? { AND: and } : {}
}

export const fechaONull = (v) => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Datos inválidos', [{ campo: 'fecha', mensaje: 'Fecha inválida' }])
  return d
}

export const fechaPuraONull = (v) => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = String(v).slice(0, 10)
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Datos inválidos', [{ campo: 'fecha', mensaje: 'Fecha inválida' }])
  return d
}

// Campos de un cuerpo que sí se aceptan (evita mass-assignment).
export const soloCampos = (body, permitidos) => {
  const out = {}
  for (const k of permitidos) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k]
  return out
}

// ── Archivos ─────────────────────────────────────────────────────────────
const secretoArchivos = () => process.env.ARCHIVOS_SECRET || process.env.DATABASE_URL || 'albergue-ancla-dev'

export const firmaArchivo = (id) =>
  crypto.createHmac('sha256', secretoArchivos()).update(`archivo:${id}`).digest('hex').slice(0, 32)

export const firmaValida = (id, firma) => {
  const esperada = firmaArchivo(id)
  if (!firma || String(firma).length !== esperada.length) return false
  return crypto.timingSafeEqual(Buffer.from(String(firma)), Buffer.from(esperada))
}

// Nunca se devuelve el contenido binario; solo el enlace para abrirlo.
export const ARCHIVO_SELECT = {
  id: true,
  nombreOriginal: true,
  ruta: true,
  mimeType: true,
  tamano: true,
  creadoEn: true,
}

export const archivoOut = (a) => {
  if (!a) return null
  const interno = String(a.ruta || '').startsWith('/archivos/')
  return { ...a, url: interno ? `/archivos/${a.id}/contenido?firma=${firmaArchivo(a.id)}` : null }
}

export const edadDe = (fechaNacimiento) => {
  if (!fechaNacimiento) return null
  const n = new Date(fechaNacimiento)
  if (Number.isNaN(n.getTime())) return null
  const hoy = new Date()
  let edad = hoy.getUTCFullYear() - n.getUTCFullYear()
  const m = hoy.getUTCMonth() - n.getUTCMonth()
  if (m < 0 || (m === 0 && hoy.getUTCDate() < n.getUTCDate())) edad--
  return edad >= 0 ? edad : null
}

export const nochesDe = (entrada, salida) => {
  if (!entrada) return 0
  const fin = salida ? new Date(salida) : new Date()
  const ms = new Date(fin).getTime() - new Date(entrada).getTime()
  return ms > 0 ? Math.ceil(ms / 86400000) : 0
}

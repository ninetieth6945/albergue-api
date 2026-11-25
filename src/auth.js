// Autenticación con Firebase ID tokens + perfil local en la tabla users.
import fs from 'node:fs'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { prisma } from './prisma.js'
import { ApiError } from './lib/utils.js'

let firebaseListo = false

const cuentaDeServicio = () => {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (json && json.trim()) {
    try {
      const datos = JSON.parse(json)
      if (datos.private_key) datos.private_key = datos.private_key.replace(/\\n/g, '\n')
      return datos
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido')
    }
  }
  if (base64) {
    const datos = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    if (datos.private_key) datos.private_key = datos.private_key.replace(/\\n/g, '\n')
    return datos
  }
  const archivo = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
  if (archivo && fs.existsSync(archivo)) {
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'))
    if (datos.private_key) datos.private_key = datos.private_key.replace(/\\n/g, '\n')
    return datos
  }
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null // firebase-admin lo toma solo
  return undefined
}

export const inicializarFirebase = () => {
  if (firebaseListo || getApps().length > 0) {
    firebaseListo = true
    return true
  }
  const datos = cuentaDeServicio()
  if (datos === undefined) {
    console.warn('[auth] Firebase no está configurado (FIREBASE_SERVICE_ACCOUNT). No se validarán tokens.')
    return false
  }
  initializeApp(datos ? { credential: cert(datos) } : undefined)
  firebaseListo = true
  return true
}

export const firebaseConfigurado = () => firebaseListo || getApps().length > 0

const anonimoPermitido = () =>
  process.env.ALLOW_ANONYMOUS === 'true' ||
  (process.env.NODE_ENV !== 'production' && process.env.ALLOW_ANONYMOUS !== 'false')

const adminsConfigurados = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

// Comprueba el token y busca (o crea, si es admin configurado) el perfil en la base.
export async function autenticar(req, res, next) {
  req.anonimo = false
  req.userDb = null
  try {
    const cabecera = req.headers.authorization || ''
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : null

    if (!token) {
      if (anonimoPermitido()) {
        req.anonimo = true
        return next()
      }
      throw new ApiError(401, 'Falta el token de autenticación')
    }

    if (!firebaseConfigurado() && !inicializarFirebase()) {
      throw new ApiError(503, 'La autenticación no está configurada en el servidor')
    }

    let claims
    try {
      claims = await getAuth().verifyIdToken(token)
    } catch (e) {
      throw new ApiError(401, 'Token de sesión inválido o vencido', e?.code ? [{ campo: 'token', mensaje: e.code }] : undefined)
    }

    const email = String(claims.email || '').trim().toLowerCase()
    if (!email) throw new ApiError(403, 'La cuenta de Firebase no tiene correo')

    req.claims = claims
    req.email = email

    let usuario = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })

    if (!usuario && adminsConfigurados().includes(email)) {
      try {
        usuario = await prisma.user.create({
          data: {
            username: String(claims.name || email.split('@')[0]).slice(0, 50),
            email,
            level: 3,
            cellPhone: '',
            registry: new Date(),
            active: 'Y',
          },
        })
        console.log(`[auth] Administrador inicial creado para ${email}`)
      } catch (e) {
        // Si dos peticiones simultáneas intentan crearlo, se recupera la fila existente.
        usuario = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
      }
    }

    if (usuario && usuario.active !== 'Y') {
      throw new ApiError(403, 'La cuenta está desactivada. Contacta a un administrador.')
    }

    req.userDb = usuario
    next()
  } catch (e) {
    next(e)
  }
}

// Endpoints de datos: cualquier cuenta con perfil activo. En modo anónimo (desarrollo) se permite.
export const exigirPerfil = (req, res, next) => {
  if (req.anonimo) return next()
  if (!req.userDb) {
    return next(new ApiError(403, 'Tu cuenta no tiene perfil en el sistema. Pide a un administrador que te registre.'))
  }
  next()
}

// Gestión de usuarios y auditoría: solo nivel 3 (Administrador).
export const exigirAdmin = (req, res, next) => {
  if (req.anonimo) return next()
  if (!req.userDb) {
    return next(new ApiError(403, 'Tu cuenta no tiene perfil en el sistema. Pide a un administrador que te registre.'))
  }
  if (Number(req.userDb.level) < 3) {
    return next(new ApiError(403, 'Se requiere nivel de Administrador'))
  }
  next()
}

// Registro de auditoría best-effort: nunca tumba la petición que lo origina.
export const auditar = (req, accion, entidad, entidadId = null, detalle = null) => {
  const id_user = req.userDb?.id_user ?? null
  prisma.auditoria
    .create({ data: { id_user, accion, entidad, entidadId: entidadId ?? null, detalle: detalle ?? null } })
    .catch((e) => console.warn('[auditoria] no se pudo registrar:', e.message))
}

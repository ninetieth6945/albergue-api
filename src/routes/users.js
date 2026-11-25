import { Router } from 'express'
import { prisma } from '../prisma.js'
import { exigirAdmin, firebaseConfigurado, inicializarFirebase } from '../auth.js'
import { getAuth } from 'firebase-admin/auth'
import {
  ah,
  ApiError,
  aEntero,
  buscarEn,
  paginacion,
  requerido,
  texto,
  invalido,
} from '../lib/utils.js'

const router = Router()

const NIVELES = [1, 2, 3]

const USUARIO_SELECT = {
  id_user: true,
  username: true,
  lastNamePaternal: true,
  lastNameMaternal: true,
  email: true,
  level: true,
  cellPhone: true,
  registry: true,
  active: true,
  photo: true,
}

// GET /users/me — perfil de la sesión actual (el login lo usa para el nombre).
router.get(
  '/users/me',
  ah(async (req, res) => {
    if (!req.userDb) throw new ApiError(404, 'Tu cuenta no tiene perfil en el sistema')
    res.json({ data: req.userDb })
  }),
)

// A partir de aquí, solo administradores.
router.use(exigirAdmin)

// GET /users/get
router.get(
  '/users/get',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10, max: 1000 })
    const where = buscarEn(['username', 'lastNamePaternal', 'lastNameMaternal', 'email', 'cellPhone'], req.query.filter)
    const [total, filas] = await Promise.all([
      prisma.user.count({ where: where ?? {} }),
      prisma.user.findMany({
        where: where ?? {},
        select: USUARIO_SELECT,
        orderBy: [{ username: 'asc' }, { id_user: 'asc' }],
        skip,
        take,
      }),
    ])
    res.json({
      data: filas,
      pagination: { page, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 },
    })
  }),
)

const datosUsuario = (body) => {
  const d = {}
  const campos = ['username', 'lastNamePaternal', 'lastNameMaternal', 'email', 'cellPhone', 'photo', 'active']
  for (const campo of campos) {
    if (body[campo] !== undefined) d[campo] = texto(body[campo])
  }
  if (d.email) d.email = d.email.toLowerCase()
  if (d.active !== undefined) {
    const activo = String(d.active).toUpperCase()
    if (!['Y', 'N'].includes(activo)) invalido('active', 'Debe ser Y o N')
    d.active = activo
  }
  if (body.level !== undefined) {
    const nivel = aEntero(body.level)
    if (!NIVELES.includes(nivel)) invalido('level', 'El rol debe ser 1, 2 o 3')
    d.level = nivel
  }
  if (body.registry !== undefined) {
    const f = new Date(body.registry)
    d.registry = Number.isNaN(f.getTime()) ? new Date() : f
  }
  return d
}

// Crea (o actualiza la contraseña de) la cuenta en Firebase Authentication.
async function sincronizarFirebase({ email, password, displayName }) {
  if (!password) return
  if (!firebaseConfigurado() && !inicializarFirebase()) {
    throw new ApiError(503, 'Firebase no está configurado: no se puede crear la contraseña del usuario')
  }
  const auth = getAuth()
  try {
    const existente = await auth.getUserByEmail(email)
    await auth.updateUser(existente.uid, { password, displayName })
  } catch (e) {
    if (e?.code === 'auth/user-not-found') {
      await auth.createUser({ email, password, displayName })
      return
    }
    throw new ApiError(400, `No se pudo crear la cuenta de acceso: ${e?.message ?? e?.code ?? 'error'}`)
  }
}

// POST /users/create
router.post(
  '/users/create',
  ah(async (req, res) => {
    requerido(req.body.username, 'username', 'El nombre es obligatorio')
    requerido(req.body.email, 'email', 'El correo es obligatorio')
    requerido(req.body.cellPhone, 'cellPhone', 'El teléfono es obligatorio')
    const datos = datosUsuario(req.body)
    datos.level = datos.level ?? 2
    datos.registry = datos.registry ?? new Date()
    datos.active = datos.active ?? 'Y'

    const duplicado = await prisma.user.findFirst({
      where: { email: { equals: datos.email, mode: 'insensitive' } },
      select: { id_user: true },
    })
    if (duplicado) throw new ApiError(409, 'Ya existe un usuario con ese correo')

    await sincronizarFirebase({
      email: datos.email,
      password: req.body.password,
      displayName: [datos.username, datos.lastNamePaternal].filter(Boolean).join(' '),
    })

    const creado = await prisma.user.create({
      data: {
        username: datos.username,
        lastNamePaternal: datos.lastNamePaternal ?? null,
        lastNameMaternal: datos.lastNameMaternal ?? null,
        email: datos.email,
        level: datos.level,
        cellPhone: datos.cellPhone,
        registry: datos.registry,
        active: datos.active,
        photo: datos.photo ?? null,
      },
      select: USUARIO_SELECT,
    })
    res.status(201).json({ data: creado })
  }),
)

// PUT /users/update
router.put(
  '/users/update',
  ah(async (req, res) => {
    const id_user = aEntero(req.body.id_user)
    if (!id_user) invalido('id_user', 'Falta el identificador del usuario')
    const actual = await prisma.user.findUnique({ where: { id_user } })
    if (!actual) throw new ApiError(404, 'Usuario no encontrado')

    const datos = datosUsuario(req.body)
    if (datos.email && datos.email !== actual.email.toLowerCase()) {
      const duplicado = await prisma.user.findFirst({
        where: { email: { equals: datos.email, mode: 'insensitive' }, NOT: { id_user } },
        select: { id_user: true },
      })
      if (duplicado) throw new ApiError(409, 'Ya existe otro usuario con ese correo')
    }

    if (req.body.password) {
      await sincronizarFirebase({
        email: datos.email ?? actual.email,
        password: req.body.password,
        displayName: datos.username ?? actual.username,
      })
    }

    const actualizado = await prisma.user.update({
      where: { id_user },
      data: datos,
      select: USUARIO_SELECT,
    })
    res.json({ data: actualizado })
  }),
)

// DELETE /users/:id
router.delete(
  '/users/:id',
  ah(async (req, res) => {
    const id_user = aEntero(req.params.id)
    if (id_user === req.userDb?.id_user) throw new ApiError(409, 'No puedes eliminar tu propio usuario')
    await prisma.user.delete({ where: { id_user } })
    res.status(204).end()
  }),
)

export default router

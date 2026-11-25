import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  buscarEn,
  paginacion,
  paginado,
  rangoFecha,
  requerido,
  soloCampos,
  texto,
  unir,
  invalido,
} from '../lib/utils.js'

const router = Router()

const TIPOS = ['PARTICULAR', 'EMPRESA', 'FUNDACION', 'GOBIERNO']

function datosDonante(body, { crear = false } = {}) {
  const d = soloCampos(body, [
    'nombre',
    'tipo',
    'contacto',
    'telefono',
    'correo',
    'rfc',
    'recurrente',
    'tipoApoyoHabitual',
    'activo',
  ])
  if (crear) {
    requerido(d.nombre, 'nombre', 'El nombre es obligatorio')
    if (d.tipo === undefined) d.tipo = 'PARTICULAR'
  }
  if (d.tipo !== undefined && !TIPOS.includes(d.tipo)) invalido('tipo', `Debe ser uno de: ${TIPOS.join(', ')}`)
  for (const campo of ['nombre', 'contacto', 'telefono', 'correo', 'tipoApoyoHabitual']) {
    if (d[campo] !== undefined) d[campo] = texto(d[campo])
  }
  if (d.rfc !== undefined) {
    const rfc = texto(d.rfc)
    if (rfc && rfc.length > 13) invalido('rfc', 'El RFC no puede tener más de 13 caracteres')
    d.rfc = rfc ? rfc.toUpperCase() : null
  }
  if (d.recurrente !== undefined) d.recurrente = Boolean(aBooleano(d.recurrente) ?? d.recurrente)
  if (d.activo !== undefined) d.activo = Boolean(aBooleano(d.activo) ?? d.activo)
  return d
}

// GET /donantes
router.get(
  '/donantes',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre', 'contacto', 'telefono', 'correo', 'rfc'], req.query.q),
      TIPOS.includes(req.query.tipo) ? { tipo: req.query.tipo } : null,
      req.query.recurrente !== undefined ? { recurrente: aBooleano(req.query.recurrente) } : null,
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
      rangoFecha(req, 'creadoEn', { fechaPura: false }),
    )
    const orden =
      req.query.orden === 'recientes' ? [{ creadoEn: 'desc' }, { id: 'desc' }] : [{ nombre: 'asc' }]
    const [total, filas] = await Promise.all([
      prisma.donante.count({ where }),
      prisma.donante.findMany({
        where,
        include: { _count: { select: { donaciones: true } } },
        orderBy: orden,
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

// GET /donantes/:id
router.get(
  '/donantes/:id',
  ah(async (req, res) => {
    const donante = await prisma.donante.findUnique({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { donaciones: true } } },
    })
    if (!donante) throw new ApiError(404, 'Donante no encontrado')
    res.json(donante)
  }),
)

// POST /donantes
router.post(
  '/donantes',
  ah(async (req, res) => {
    const creado = await prisma.donante.create({ data: datosDonante(req.body, { crear: true }) })
    res.status(201).json(creado)
  }),
)

// PUT /donantes/:id
router.put(
  '/donantes/:id',
  ah(async (req, res) => {
    const datos = datosDonante(req.body)
    if (Object.keys(datos).length === 0) throw new ApiError(400, 'No hay datos para actualizar')
    const actualizado = await prisma.donante.update({ where: { id: Number(req.params.id) }, data: datos })
    res.json(actualizado)
  }),
)

// DELETE /donantes/:id
router.delete(
  '/donantes/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id)
    const donaciones = await prisma.donacion.count({ where: { id_donante: id } })
    if (donaciones) {
      throw new ApiError(409, 'No se puede eliminar: el donante tiene donaciones registradas. Desactívalo en su lugar.')
    }
    await prisma.donante.delete({ where: { id } })
    res.status(204).end()
  }),
)

export default router

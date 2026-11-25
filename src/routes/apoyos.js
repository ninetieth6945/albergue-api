import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  aEntero,
  ARCHIVO_SELECT,
  archivoOut,
  buscarEn,
  enteroONull,
  fechaPuraONull,
  num,
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

const INCLUDE = {
  tipoApoyo: { select: { id: true, nombre: true } },
  beneficiario: { select: { id: true, folio: true, nombreCompleto: true, tipo: true } },
  archivo: { select: ARCHIVO_SELECT },
  user: { select: { id_user: true, username: true } },
}

const salida = (a) => ({ ...a, archivo: archivoOut(a.archivo) })

const fechaMx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

function datosApoyo(body, { crear = false } = {}) {
  const d = soloCampos(body, [
    'fecha',
    'id_beneficiario',
    'id_tipo_apoyo',
    'descripcion',
    'cantidad',
    'costoEstimado',
    'proporcionadoPor',
    'id_archivo',
    'observaciones',
    'activo',
  ])
  if (crear) {
    requerido(d.id_beneficiario, 'id_beneficiario', 'Selecciona al beneficiario')
    requerido(d.id_tipo_apoyo, 'id_tipo_apoyo', 'Selecciona el tipo de apoyo')
    requerido(d.descripcion, 'descripcion', 'Describe el apoyo entregado')
    if (d.fecha === undefined) d.fecha = fechaMx()
    if (d.cantidad === undefined) d.cantidad = 1
  }
  if (d.fecha !== undefined) d.fecha = fechaPuraONull(d.fecha)
  if (d.descripcion !== undefined) d.descripcion = texto(d.descripcion)
  if (d.proporcionadoPor !== undefined) d.proporcionadoPor = texto(d.proporcionadoPor)
  if (d.observaciones !== undefined) d.observaciones = texto(d.observaciones)
  if (d.cantidad !== undefined) {
    const n = Number(d.cantidad)
    if (!Number.isFinite(n) || n <= 0) invalido('cantidad', 'La cantidad debe ser mayor que cero')
    d.cantidad = n
  }
  if (d.costoEstimado !== undefined) {
    if (d.costoEstimado === null || d.costoEstimado === '') d.costoEstimado = null
    else {
      const n = Number(d.costoEstimado)
      if (!Number.isFinite(n) || n < 0) invalido('costoEstimado', 'El costo debe ser un número mayor o igual a cero')
      d.costoEstimado = n
    }
  }
  for (const campo of ['id_beneficiario', 'id_tipo_apoyo', 'id_archivo']) {
    if (d[campo] !== undefined) d[campo] = enteroONull(d[campo])
  }
  if (d.activo !== undefined) d.activo = Boolean(aBooleano(d.activo) ?? d.activo)
  return d
}

// GET /apoyos/resumen?desde&hasta
router.get(
  '/apoyos/resumen',
  ah(async (req, res) => {
    const where = unir(rangoFecha(req, 'fecha'), { activo: true })
    const filas = await prisma.apoyo.findMany({
      where,
      select: { id_tipo_apoyo: true, costoEstimado: true, tipoApoyo: { select: { nombre: true } } },
    })

    const porTipo = new Map()
    let costoTotal = 0
    for (const f of filas) {
      const costo = Number(f.costoEstimado ?? 0)
      costoTotal += costo
      const clave = f.id_tipo_apoyo
      const actual = porTipo.get(clave) ?? { id_tipo_apoyo: clave, tipo: f.tipoApoyo?.nombre ?? 'Sin tipo', total: 0, costoEstimado: 0 }
      actual.total += 1
      actual.costoEstimado += costo
      porTipo.set(clave, actual)
    }

    res.json({
      total: filas.length,
      costoEstimado: costoTotal,
      porTipo: [...porTipo.values()].sort((a, b) => a.tipo.localeCompare(b.tipo, 'es')),
    })
  }),
)

// GET /apoyos
router.get(
  '/apoyos',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const q = req.query.q ? String(req.query.q).trim() : ''
    const where = unir(
      q
        ? {
            OR: [
              { descripcion: { contains: q, mode: 'insensitive' } },
              { proporcionadoPor: { contains: q, mode: 'insensitive' } },
              { tipoApoyo: { nombre: { contains: q, mode: 'insensitive' } } },
              { beneficiario: { nombreCompleto: { contains: q, mode: 'insensitive' } } },
              { beneficiario: { folio: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : null,
      req.query.id_beneficiario !== undefined ? { id_beneficiario: aEntero(req.query.id_beneficiario) } : null,
      req.query.id_tipo_apoyo !== undefined ? { id_tipo_apoyo: aEntero(req.query.id_tipo_apoyo) } : null,
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
      rangoFecha(req, 'fecha'),
    )
    const [total, filas] = await Promise.all([
      prisma.apoyo.count({ where }),
      prisma.apoyo.findMany({ where, include: INCLUDE, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip, take }),
    ])
    res.json(paginado(filas.map(salida), total, page, pageSize))
  }),
)

// GET /apoyos/:id
router.get(
  '/apoyos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const apoyo = await prisma.apoyo.findUnique({ where: { id }, include: INCLUDE })
    if (!apoyo) throw new ApiError(404, 'Apoyo no encontrado')
    res.json(salida(apoyo))
  }),
)

// POST /apoyos
router.post(
  '/apoyos',
  ah(async (req, res) => {
    const datos = datosApoyo(req.body, { crear: true })
    const [benef, tipo] = await Promise.all([
      prisma.beneficiario.count({ where: { id: datos.id_beneficiario } }),
      prisma.tipoApoyo.count({ where: { id: datos.id_tipo_apoyo } }),
    ])
    if (!benef) invalido('id_beneficiario', 'El beneficiario no existe')
    if (!tipo) invalido('id_tipo_apoyo', 'El tipo de apoyo no existe')

    const creado = await prisma.apoyo.create({
      data: { ...datos, id_user: req.userDb?.id_user ?? null },
      include: INCLUDE,
    })
    res.status(201).json(salida(creado))
  }),
)

// PUT /apoyos/:id
router.put(
  '/apoyos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const datos = datosApoyo(req.body)
    if (Object.keys(datos).length === 0) throw new ApiError(400, 'No hay datos para actualizar')
    const actualizado = await prisma.apoyo.update({ where: { id }, data: datos, include: INCLUDE })
    res.json(salida(actualizado))
  }),
)

// DELETE /apoyos/:id
router.delete(
  '/apoyos/:id',
  ah(async (req, res) => {
    await prisma.apoyo.delete({ where: { id: aEntero(req.params.id) } })
    res.status(204).end()
  }),
)

export default router

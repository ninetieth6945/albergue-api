import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aEntero,
  buscarEn,
  fechaPuraONull,
  paginacion,
  paginado,
  requerido,
  soloCampos,
  texto,
  unir,
} from '../lib/utils.js'

const router = Router()

const aBooleano = (v) => {
  if (v === undefined) return undefined
  return v === true || v === 'true' || v === '1' || v === 1
}

const n = (v) => Number(v ?? 0)

async function stockPorAlimento(ids) {
  if (!ids.length) return new Map()
  const [entradas, salidas] = await Promise.all([
    prisma.movimientoAlimento.groupBy({
      by: ['id_alimento'],
      where: { id_alimento: { in: ids }, tipo: 'ENTRADA' },
      _sum: { cantidad: true },
    }),
    prisma.movimientoAlimento.groupBy({
      by: ['id_alimento'],
      where: { id_alimento: { in: ids }, tipo: 'SALIDA' },
      _sum: { cantidad: true },
    }),
  ])
  const mapa = new Map(ids.map((id) => [id, 0]))
  for (const e of entradas) mapa.set(e.id_alimento, (mapa.get(e.id_alimento) ?? 0) + n(e._sum.cantidad))
  for (const s of salidas) mapa.set(s.id_alimento, (mapa.get(s.id_alimento) ?? 0) - n(s._sum.cantidad))
  return mapa
}

async function stockPorLote(ids) {
  if (!ids.length) return new Map()
  const [entradas, salidas] = await Promise.all([
    prisma.movimientoAlimento.groupBy({
      by: ['id_lote'],
      where: { id_lote: { in: ids }, tipo: 'ENTRADA' },
      _sum: { cantidad: true },
    }),
    prisma.movimientoAlimento.groupBy({
      by: ['id_lote'],
      where: { id_lote: { in: ids }, tipo: 'SALIDA' },
      _sum: { cantidad: true },
    }),
  ])
  const mapa = new Map(ids.map((id) => [id, 0]))
  for (const e of entradas) mapa.set(e.id_lote, (mapa.get(e.id_lote) ?? 0) + n(e._sum.cantidad))
  for (const s of salidas) mapa.set(s.id_lote, (mapa.get(s.id_lote) ?? 0) - n(s._sum.cantidad))
  return mapa
}

// GET /alimentos/caducidades?dias=60
router.get(
  '/alimentos/caducidades',
  ah(async (req, res) => {
    const dias = Math.max(0, aEntero(req.query.dias, 60))
    const limite = new Date(Date.now() + dias * 86400000)
    const lotes = await prisma.alimentoLote.findMany({
      where: { caducidad: { not: null, lte: limite } },
      include: { alimento: { select: { id: true, nombre: true, presentacion: true, unidad: true } } },
      orderBy: { caducidad: 'asc' },
    })
    const stock = await stockPorLote(lotes.map((l) => l.id))
    res.json(
      lotes
        .map((l) => ({ ...l, stock: stock.get(l.id) ?? 0 }))
        .filter((l) => l.stock > 0),
    )
  }),
)

// GET /alimentos
router.get(
  '/alimentos',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre', 'presentacion', 'unidad'], req.query.q),
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
    )
    const orden = req.query.orden === 'recientes' ? [{ id: 'desc' }] : [{ nombre: 'asc' }]
    const [total, listado] = await Promise.all([
      prisma.alimento.count({ where }),
      prisma.alimento.findMany({ where, orderBy: orden, skip, take }),
    ])
    const stock = await stockPorAlimento(listado.map((a) => a.id))
    res.json(paginado(listado.map((a) => ({ ...a, stock: stock.get(a.id) ?? 0 })), total, page, pageSize))
  }),
)

// GET /alimentos/:id
router.get(
  '/alimentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const alimento = await prisma.alimento.findUnique({ where: { id } })
    if (!alimento) throw new ApiError(404, 'Alimento no encontrado')
    const lotes = await prisma.alimentoLote.findMany({ where: { id_alimento: id }, orderBy: { id: 'asc' } })
    const [stock, totalAli] = await Promise.all([stockPorLote(lotes.map((l) => l.id)), stockPorAlimento([id])])
    res.json({
      ...alimento,
      stock: totalAli.get(id) ?? 0,
      lotes: lotes.map((l) => ({ ...l, stock: stock.get(l.id) ?? 0 })),
    })
  }),
)

// POST /alimentos
router.post(
  '/alimentos',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    const creado = await prisma.alimento.create({
      data: {
        nombre: texto(req.body.nombre),
        presentacion: texto(req.body.presentacion),
        unidad: texto(req.body.unidad),
        activo: aBooleano(req.body.activo) ?? true,
      },
    })
    res.status(201).json({ ...creado, stock: 0 })
  }),
)

// PUT /alimentos/:id
router.put(
  '/alimentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const datos = soloCampos(req.body, ['nombre', 'presentacion', 'unidad', 'activo'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.presentacion !== undefined) datos.presentacion = texto(datos.presentacion)
    if (datos.unidad !== undefined) datos.unidad = texto(datos.unidad)
    if (datos.activo !== undefined) datos.activo = aBooleano(datos.activo)
    const actualizado = await prisma.alimento.update({ where: { id }, data: datos })
    const stock = await stockPorAlimento([id])
    res.json({ ...actualizado, stock: stock.get(id) ?? 0 })
  }),
)

// DELETE /alimentos/:id
router.delete(
  '/alimentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const [movimientos, lotes] = await Promise.all([
      prisma.movimientoAlimento.count({ where: { id_alimento: id } }),
      prisma.alimentoLote.count({ where: { id_alimento: id } }),
    ])
    if (movimientos || lotes) {
      throw new ApiError(409, 'No se puede eliminar: el alimento tiene lotes o movimientos. Desactívalo en su lugar.')
    }
    await prisma.alimento.delete({ where: { id } })
    res.status(204).end()
  }),
)

// POST /alimentos/:id/lotes
router.post(
  '/alimentos/:id/lotes',
  ah(async (req, res) => {
    const id_alimento = aEntero(req.params.id)
    requerido(req.body.lote, 'lote', 'El lote es obligatorio')
    if (!(await prisma.alimento.count({ where: { id: id_alimento } }))) {
      throw new ApiError(404, 'Alimento no encontrado')
    }
    const lote = texto(req.body.lote)
    const caducidad = fechaPuraONull(req.body.caducidad) ?? null
    const existente = await prisma.alimentoLote.findFirst({ where: { id_alimento, lote } })
    if (existente) {
      const actualizado = await prisma.alimentoLote.update({
        where: { id: existente.id },
        data: { caducidad: caducidad ?? existente.caducidad },
      })
      const stock = await stockPorLote([actualizado.id])
      return res.json({ ...actualizado, stock: stock.get(actualizado.id) ?? 0 })
    }
    const creado = await prisma.alimentoLote.create({ data: { id_alimento, lote, caducidad } })
    res.status(201).json({ ...creado, stock: 0 })
  }),
)

// DELETE /alimentos/:id/lotes/:loteId
router.delete(
  '/alimentos/:id/lotes/:loteId',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const loteId = aEntero(req.params.loteId)
    const movimientos = await prisma.movimientoAlimento.count({ where: { id_lote: loteId } })
    if (movimientos) throw new ApiError(409, 'No se puede eliminar el lote: tiene movimientos registrados.')
    await prisma.alimentoLote.deleteMany({ where: { id: loteId, id_alimento: id } })
    res.status(204).end()
  }),
)

export default router

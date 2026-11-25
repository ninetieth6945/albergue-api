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
  invalido,
} from '../lib/utils.js'

const router = Router()

const aBooleano = (v) => {
  if (v === undefined) return undefined
  return v === true || v === 'true' || v === '1' || v === 1
}

// Stock por medicamento (entradas menos salidas).
async function stockPorMedicamento(ids) {
  if (!ids.length) return new Map()
  const [entradas, salidas] = await Promise.all([
    prisma.movimientoInventario.groupBy({
      by: ['id_medicamento'],
      where: { id_medicamento: { in: ids }, tipo: 'ENTRADA' },
      _sum: { cantidad: true },
    }),
    prisma.movimientoInventario.groupBy({
      by: ['id_medicamento'],
      where: { id_medicamento: { in: ids }, tipo: 'SALIDA' },
      _sum: { cantidad: true },
    }),
  ])
  const mapa = new Map(ids.map((id) => [id, 0]))
  for (const e of entradas) mapa.set(e.id_medicamento, (mapa.get(e.id_medicamento) ?? 0) + (e._sum.cantidad ?? 0))
  for (const s of salidas) mapa.set(s.id_medicamento, (mapa.get(s.id_medicamento) ?? 0) - (s._sum.cantidad ?? 0))
  return mapa
}

async function stockPorLote(ids) {
  if (!ids.length) return new Map()
  const [entradas, salidas] = await Promise.all([
    prisma.movimientoInventario.groupBy({
      by: ['id_lote'],
      where: { id_lote: { in: ids }, tipo: 'ENTRADA' },
      _sum: { cantidad: true },
    }),
    prisma.movimientoInventario.groupBy({
      by: ['id_lote'],
      where: { id_lote: { in: ids }, tipo: 'SALIDA' },
      _sum: { cantidad: true },
    }),
  ])
  const mapa = new Map(ids.map((id) => [id, 0]))
  for (const e of entradas) mapa.set(e.id_lote, (mapa.get(e.id_lote) ?? 0) + (e._sum.cantidad ?? 0))
  for (const s of salidas) mapa.set(s.id_lote, (mapa.get(s.id_lote) ?? 0) - (s._sum.cantidad ?? 0))
  return mapa
}

// GET /medicamentos/caducidades?dias=60
router.get(
  '/medicamentos/caducidades',
  ah(async (req, res) => {
    const dias = Math.max(0, aEntero(req.query.dias, 60))
    const limite = new Date(Date.now() + dias * 86400000)
    const lotes = await prisma.medicamentoLote.findMany({
      where: { caducidad: { not: null, lte: limite } },
      include: { medicamento: { select: { id: true, nombre: true, presentacion: true, unidad: true } } },
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

// GET /medicamentos
router.get(
  '/medicamentos',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre', 'presentacion', 'unidad'], req.query.q),
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
    )
    const orden = req.query.orden === 'recientes' ? [{ id: 'desc' }] : [{ nombre: 'asc' }]
    const [total, listado] = await Promise.all([
      prisma.medicamento.count({ where }),
      prisma.medicamento.findMany({ where, orderBy: orden, skip, take }),
    ])
    const stock = await stockPorMedicamento(listado.map((m) => m.id))
    const filas = listado.map((m) => ({ ...m, stock: stock.get(m.id) ?? 0 }))
    res.json(paginado(filas, total, page, pageSize))
  }),
)

// GET /medicamentos/:id
router.get(
  '/medicamentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const medicamento = await prisma.medicamento.findUnique({ where: { id } })
    if (!medicamento) throw new ApiError(404, 'Medicamento no encontrado')
    const lotes = await prisma.medicamentoLote.findMany({ where: { id_medicamento: id }, orderBy: { id: 'asc' } })
    const [stock, totalMed] = await Promise.all([stockPorLote(lotes.map((l) => l.id)), stockPorMedicamento([id])])
    res.json({
      ...medicamento,
      stock: totalMed.get(id) ?? 0,
      lotes: lotes.map((l) => ({ ...l, stock: stock.get(l.id) ?? 0 })),
    })
  }),
)

// POST /medicamentos
router.post(
  '/medicamentos',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    const creado = await prisma.medicamento.create({
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

// PUT /medicamentos/:id
router.put(
  '/medicamentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const datos = soloCampos(req.body, ['nombre', 'presentacion', 'unidad', 'activo'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.presentacion !== undefined) datos.presentacion = texto(datos.presentacion)
    if (datos.unidad !== undefined) datos.unidad = texto(datos.unidad)
    if (datos.activo !== undefined) datos.activo = aBooleano(datos.activo)
    const actualizado = await prisma.medicamento.update({ where: { id }, data: datos })
    const stock = await stockPorMedicamento([id])
    res.json({ ...actualizado, stock: stock.get(id) ?? 0 })
  }),
)

// DELETE /medicamentos/:id
router.delete(
  '/medicamentos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const [movimientos, lotes] = await Promise.all([
      prisma.movimientoInventario.count({ where: { id_medicamento: id } }),
      prisma.medicamentoLote.count({ where: { id_medicamento: id } }),
    ])
    if (movimientos || lotes) {
      throw new ApiError(409, 'No se puede eliminar: el medicamento tiene lotes o movimientos. Desactívalo en su lugar.')
    }
    await prisma.medicamento.delete({ where: { id } })
    res.status(204).end()
  }),
)

// POST /medicamentos/:id/lotes
router.post(
  '/medicamentos/:id/lotes',
  ah(async (req, res) => {
    const id_medicamento = aEntero(req.params.id)
    requerido(req.body.lote, 'lote', 'El lote es obligatorio')
    if (!(await prisma.medicamento.count({ where: { id: id_medicamento } }))) {
      throw new ApiError(404, 'Medicamento no encontrado')
    }
    const lote = texto(req.body.lote)
    const caducidad = fechaPuraONull(req.body.caducidad) ?? null
    const existente = await prisma.medicamentoLote.findFirst({ where: { id_medicamento, lote } })
    if (existente) {
      const actualizado = await prisma.medicamentoLote.update({
        where: { id: existente.id },
        data: { caducidad: caducidad ?? existente.caducidad },
      })
      const stock = await stockPorLote([actualizado.id])
      return res.json({ ...actualizado, stock: stock.get(actualizado.id) ?? 0 })
    }
    const creado = await prisma.medicamentoLote.create({ data: { id_medicamento, lote, caducidad } })
    res.status(201).json({ ...creado, stock: 0 })
  }),
)

// DELETE /medicamentos/:id/lotes/:loteId
router.delete(
  '/medicamentos/:id/lotes/:loteId',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const loteId = aEntero(req.params.loteId)
    const movimientos = await prisma.movimientoInventario.count({ where: { id_lote: loteId } })
    if (movimientos) {
      throw new ApiError(409, 'No se puede eliminar el lote: tiene movimientos registrados.')
    }
    await prisma.medicamentoLote.deleteMany({ where: { id: loteId, id_medicamento: id } })
    res.status(204).end()
  }),
)

export default router

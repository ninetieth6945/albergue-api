import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  aEntero,
  fechaONull,
  paginacion,
  paginado,
  rangoFecha,
  requerido,
  unir,
  invalido,
} from '../lib/utils.js'

const router = Router()

const TIPOS = ['ENTRADA', 'SALIDA']

const includeMedicamento = {
  medicamento: { select: { id: true, nombre: true, presentacion: true, unidad: true } },
  lote: { select: { id: true, lote: true, caducidad: true } },
  user: { select: { id_user: true, username: true } },
}

const includeAlimento = {
  alimento: { select: { id: true, nombre: true, presentacion: true, unidad: true } },
  lote: { select: { id: true, lote: true, caducidad: true } },
  user: { select: { id_user: true, username: true } },
}

async function stockMedicamento(id, id_lote = null) {
  const where = id_lote ? { id_lote } : { id_medicamento: id }
  const [ent, sal] = await Promise.all([
    prisma.movimientoInventario.aggregate({ where: { ...where, tipo: 'ENTRADA' }, _sum: { cantidad: true } }),
    prisma.movimientoInventario.aggregate({ where: { ...where, tipo: 'SALIDA' }, _sum: { cantidad: true } }),
  ])
  return (ent._sum.cantidad ?? 0) - (sal._sum.cantidad ?? 0)
}

async function stockAlimento(id, id_lote = null) {
  const where = id_lote ? { id_lote } : { id_alimento: id }
  const [ent, sal] = await Promise.all([
    prisma.movimientoAlimento.aggregate({ where: { ...where, tipo: 'ENTRADA' }, _sum: { cantidad: true } }),
    prisma.movimientoAlimento.aggregate({ where: { ...where, tipo: 'SALIDA' }, _sum: { cantidad: true } }),
  ])
  return Number(ent._sum.cantidad ?? 0) - Number(sal._sum.cantidad ?? 0)
}

// ── Medicamentos ─────────────────────────────────────────────────────────
router.get(
  '/inventario/movimientos',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      TIPOS.includes(req.query.tipo) ? { tipo: req.query.tipo } : null,
      req.query.id_medicamento !== undefined ? { id_medicamento: aEntero(req.query.id_medicamento) } : null,
      req.query.id_lote !== undefined ? { id_lote: aEntero(req.query.id_lote) } : null,
      rangoFecha(req, 'fecha', { fechaPura: false }),
    )
    const [total, filas] = await Promise.all([
      prisma.movimientoInventario.count({ where }),
      prisma.movimientoInventario.findMany({
        where,
        include: includeMedicamento,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/inventario/movimientos',
  ah(async (req, res) => {
    requerido(req.body.id_medicamento, 'id_medicamento', 'Selecciona el medicamento')
    if (!TIPOS.includes(req.body.tipo)) invalido('tipo', 'Debe ser ENTRADA o SALIDA')
    const id_medicamento = aEntero(req.body.id_medicamento)
    const cantidad = aEntero(req.body.cantidad)
    if (!cantidad || cantidad <= 0) invalido('cantidad', 'La cantidad debe ser mayor que cero')

    const medicamento = await prisma.medicamento.findUnique({ where: { id: id_medicamento } })
    if (!medicamento) invalido('id_medicamento', 'El medicamento no existe')

    let id_lote = null
    if (req.body.id_lote !== undefined && req.body.id_lote !== null && req.body.id_lote !== '') {
      id_lote = aEntero(req.body.id_lote)
      const lote = await prisma.medicamentoLote.findFirst({ where: { id: id_lote, id_medicamento } })
      if (!lote) invalido('id_lote', 'El lote no pertenece al medicamento')
    }

    if (req.body.tipo === 'SALIDA') {
      const disponible = await stockMedicamento(id_medicamento)
      if (cantidad > disponible) {
        throw new ApiError(409, `No hay suficiente stock: disponible ${disponible}, solicitado ${cantidad}`)
      }
    }

    // Una salida sin lote se reparte entre los lotes con existencia (primero los que caducan antes);
    // si sobra cantidad no rastreada por lote, se registra sin lote.
    let desglose = [{ id_lote, cantidad }]
    if (req.body.tipo === 'SALIDA' && !id_lote) {
      const lotes = await prisma.medicamentoLote.findMany({
        where: { id_medicamento },
        orderBy: [{ caducidad: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      })
      const porLote = await prisma.movimientoInventario.groupBy({
        by: ['id_lote'],
        where: { id_lote: { in: lotes.map((l) => l.id) }, tipo: 'ENTRADA' },
        _sum: { cantidad: true },
      })
      const salidasPorLote = await prisma.movimientoInventario.groupBy({
        by: ['id_lote'],
        where: { id_lote: { in: lotes.map((l) => l.id) }, tipo: 'SALIDA' },
        _sum: { cantidad: true },
      })
      const stock = new Map(lotes.map((l) => [l.id, 0]))
      for (const e of porLote) stock.set(e.id_lote, (stock.get(e.id_lote) ?? 0) + (e._sum.cantidad ?? 0))
      for (const s of salidasPorLote) stock.set(s.id_lote, (stock.get(s.id_lote) ?? 0) - (s._sum.cantidad ?? 0))

      desglose = []
      let restante = cantidad
      for (const l of lotes) {
        if (restante <= 0) break
        const disp = stock.get(l.id) ?? 0
        if (disp <= 0) continue
        const q = Math.min(disp, restante)
        desglose.push({ id_lote: l.id, cantidad: q })
        restante -= q
      }
      if (restante > 0) desglose.push({ id_lote: null, cantidad: restante })
    }

    const creados = await prisma.$transaction(
      desglose.map((parte) =>
        prisma.movimientoInventario.create({
          data: {
            id_medicamento,
            id_lote: parte.id_lote,
            tipo: req.body.tipo,
            cantidad: parte.cantidad,
            fecha: fechaONull(req.body.fecha) ?? new Date(),
            motivo: req.body.motivo ? String(req.body.motivo).trim() : null,
            id_user: req.userDb?.id_user ?? null,
          },
          include: includeMedicamento,
        }),
      ),
    )
    res.status(201).json(creados[0])
  }),
)

// ── Alimentos ────────────────────────────────────────────────────────────
router.get(
  '/inventario-alimentos/movimientos',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      TIPOS.includes(req.query.tipo) ? { tipo: req.query.tipo } : null,
      req.query.id_alimento !== undefined ? { id_alimento: aEntero(req.query.id_alimento) } : null,
      req.query.id_lote !== undefined ? { id_lote: aEntero(req.query.id_lote) } : null,
      rangoFecha(req, 'fecha', { fechaPura: false }),
    )
    const [total, filas] = await Promise.all([
      prisma.movimientoAlimento.count({ where }),
      prisma.movimientoAlimento.findMany({
        where,
        include: includeAlimento,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/inventario-alimentos/movimientos',
  ah(async (req, res) => {
    requerido(req.body.id_alimento, 'id_alimento', 'Selecciona el alimento')
    if (!TIPOS.includes(req.body.tipo)) invalido('tipo', 'Debe ser ENTRADA o SALIDA')
    const id_alimento = aEntero(req.body.id_alimento)
    const cantidad = Number(req.body.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) invalido('cantidad', 'La cantidad debe ser mayor que cero')

    const alimento = await prisma.alimento.findUnique({ where: { id: id_alimento } })
    if (!alimento) invalido('id_alimento', 'El alimento no existe')

    let id_lote = null
    if (req.body.id_lote !== undefined && req.body.id_lote !== null && req.body.id_lote !== '') {
      id_lote = aEntero(req.body.id_lote)
      const lote = await prisma.alimentoLote.findFirst({ where: { id: id_lote, id_alimento } })
      if (!lote) invalido('id_lote', 'El lote no pertenece al alimento')
    }

    if (req.body.tipo === 'SALIDA') {
      const disponible = await stockAlimento(id_alimento)
      if (cantidad > disponible) {
        throw new ApiError(409, `No hay suficiente stock: disponible ${disponible}, solicitado ${cantidad}`)
      }
    }

    let desglose = [{ id_lote, cantidad }]
    if (req.body.tipo === 'SALIDA' && !id_lote) {
      const lotes = await prisma.alimentoLote.findMany({
        where: { id_alimento },
        orderBy: [{ caducidad: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      })
      const idsLotes = lotes.map((l) => l.id)
      const [entradas, salidas] = await Promise.all([
        prisma.movimientoAlimento.groupBy({
          by: ['id_lote'],
          where: { id_lote: { in: idsLotes }, tipo: 'ENTRADA' },
          _sum: { cantidad: true },
        }),
        prisma.movimientoAlimento.groupBy({
          by: ['id_lote'],
          where: { id_lote: { in: idsLotes }, tipo: 'SALIDA' },
          _sum: { cantidad: true },
        }),
      ])
      const stock = new Map(idsLotes.map((id) => [id, 0]))
      for (const e of entradas) stock.set(e.id_lote, (stock.get(e.id_lote) ?? 0) + Number(e._sum.cantidad ?? 0))
      for (const s of salidas) stock.set(s.id_lote, (stock.get(s.id_lote) ?? 0) - Number(s._sum.cantidad ?? 0))

      desglose = []
      let restante = cantidad
      for (const l of lotes) {
        if (restante <= 0) break
        const disp = stock.get(l.id) ?? 0
        if (disp <= 0) continue
        const q = Math.min(disp, restante)
        desglose.push({ id_lote: l.id, cantidad: q })
        restante -= q
      }
      if (restante > 0) desglose.push({ id_lote: null, cantidad: restante })
    }

    const creados = await prisma.$transaction(
      desglose.map((parte) =>
        prisma.movimientoAlimento.create({
          data: {
            id_alimento,
            id_lote: parte.id_lote,
            tipo: req.body.tipo,
            cantidad: parte.cantidad,
            fecha: fechaONull(req.body.fecha) ?? new Date(),
            motivo: req.body.motivo ? String(req.body.motivo).trim() : null,
            id_user: req.userDb?.id_user ?? null,
          },
          include: includeAlimento,
        }),
      ),
    )
    res.status(201).json(creados[0])
  }),
)

export default router

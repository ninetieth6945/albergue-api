import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  aEntero,
  ARCHIVO_SELECT,
  archivoOut,
  enteroONull,
  fechaPuraONull,
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

const TIPOS = ['EFECTIVO', 'ESPECIE', 'SERVICIO']
const FORMAS = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'OTRO']

const INCLUDE = {
  donante: { select: { id: true, nombre: true, tipo: true } },
  destino: { select: { id: true, nombre: true } },
  archivo: { select: ARCHIVO_SELECT },
  detalles: { include: { medicamento: { select: { id: true, nombre: true, presentacion: true } } } },
}

const salida = (d) => ({ ...d, archivo: archivoOut(d.archivo) })

const fechaMx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

const numeroONull = (v, campo) => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) invalido(campo, 'Debe ser un número mayor o igual a cero')
  return n
}

function datosDonacion(body, { crear = false } = {}) {
  const d = soloCampos(body, [
    'fecha',
    'id_donante',
    'tipo',
    'monto',
    'valorEstimado',
    'id_destino',
    'formaPago',
    'folioRecibo',
    'id_archivo',
    'observaciones',
    'activo',
  ])
  if (crear) {
    requerido(d.id_donante, 'id_donante', 'Selecciona al donante')
    requerido(d.tipo, 'tipo', 'Selecciona el tipo de donación')
    if (d.fecha === undefined) d.fecha = fechaMx()
  }
  if (d.tipo !== undefined && !TIPOS.includes(d.tipo)) invalido('tipo', `Debe ser uno de: ${TIPOS.join(', ')}`)
  if (d.formaPago !== undefined) {
    if (d.formaPago === null || d.formaPago === '') d.formaPago = null
    else if (!FORMAS.includes(d.formaPago)) invalido('formaPago', `Debe ser uno de: ${FORMAS.join(', ')}`)
  }
  if (d.fecha !== undefined) d.fecha = fechaPuraONull(d.fecha)
  if (d.folioRecibo !== undefined) d.folioRecibo = texto(d.folioRecibo)
  if (d.observaciones !== undefined) d.observaciones = texto(d.observaciones)
  if (d.monto !== undefined) d.monto = numeroONull(d.monto, 'monto')
  if (d.valorEstimado !== undefined) d.valorEstimado = numeroONull(d.valorEstimado, 'valorEstimado')
  for (const campo of ['id_donante', 'id_destino', 'id_archivo']) {
    if (d[campo] !== undefined) d[campo] = enteroONull(d[campo])
  }
  if (d.activo !== undefined) d.activo = Boolean(aBooleano(d.activo) ?? d.activo)
  return d
}

// GET /donaciones/resumen?desde&hasta
router.get(
  '/donaciones/resumen',
  ah(async (req, res) => {
    const where = unir(rangoFecha(req, 'fecha'), { activo: true })
    const filas = await prisma.donacion.findMany({
      where,
      select: {
        tipo: true,
        monto: true,
        valorEstimado: true,
        id_destino: true,
        destino: { select: { nombre: true } },
      },
    })

    const tipos = new Map()
    const destinos = new Map()
    let monto = 0
    let valor = 0
    for (const f of filas) {
      const m = Number(f.monto ?? 0)
      const v = Number(f.valorEstimado ?? 0)
      monto += m
      valor += v

      const t = tipos.get(f.tipo) ?? { tipo: f.tipo, total: 0, monto: 0, valorEstimado: 0 }
      t.total++
      t.monto += m
      t.valorEstimado += v
      tipos.set(f.tipo, t)

      const clave = f.id_destino ?? 0
      const de = destinos.get(clave) ?? {
        id_destino: f.id_destino ?? null,
        destino: f.destino?.nombre ?? 'Sin destino',
        total: 0,
        monto: 0,
        valorEstimado: 0,
      }
      de.total++
      de.monto += m
      de.valorEstimado += v
      destinos.set(clave, de)
    }

    res.json({
      total: filas.length,
      monto,
      valorEstimado: valor,
      porTipo: [...tipos.values()].sort((a, b) => a.tipo.localeCompare(b.tipo, 'es')),
      porDestino: [...destinos.values()].sort((a, b) => b.total - a.total),
    })
  }),
)

// GET /donaciones
router.get(
  '/donaciones',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const q = req.query.q ? String(req.query.q).trim() : ''
    const where = unir(
      q
        ? {
            OR: [
              { folioRecibo: { contains: q, mode: 'insensitive' } },
              { observaciones: { contains: q, mode: 'insensitive' } },
              { donante: { nombre: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : null,
      TIPOS.includes(req.query.tipo) ? { tipo: req.query.tipo } : null,
      req.query.id_donante !== undefined ? { id_donante: aEntero(req.query.id_donante) } : null,
      req.query.id_destino !== undefined ? { id_destino: aEntero(req.query.id_destino) } : null,
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
      rangoFecha(req, 'fecha'),
    )
    const [total, filas] = await Promise.all([
      prisma.donacion.count({ where }),
      prisma.donacion.findMany({ where, include: INCLUDE, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip, take }),
    ])
    res.json(paginado(filas.map(salida), total, page, pageSize))
  }),
)

// GET /donaciones/:id
router.get(
  '/donaciones/:id',
  ah(async (req, res) => {
    const donacion = await prisma.donacion.findUnique({ where: { id: aEntero(req.params.id) }, include: INCLUDE })
    if (!donacion) throw new ApiError(404, 'Donación no encontrada')
    res.json(salida(donacion))
  }),
)

// POST /donaciones
router.post(
  '/donaciones',
  ah(async (req, res) => {
    const datos = datosDonacion(req.body, { crear: true })
    const donante = await prisma.donante.count({ where: { id: datos.id_donante } })
    if (!donante) invalido('id_donante', 'El donante no existe')

    const detalles = Array.isArray(req.body.detalles) ? req.body.detalles : []
    for (const [i, det] of detalles.entries()) {
      requerido(det.descripcion, `detalles.${i}.descripcion`, 'Describe el artículo donado')
      const cantidad = Number(det.cantidad)
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        invalido(`detalles.${i}.cantidad`, 'La cantidad debe ser mayor que cero')
      }
    }

    const id_user = req.userDb?.id_user ?? null
    const creada = await prisma.$transaction(async (tx) => {
      const donacion = await tx.donacion.create({
        data: {
          ...datos,
          detalles: {
            create: detalles.map((det) => ({
              descripcion: texto(det.descripcion),
              cantidad: Number(det.cantidad),
              id_medicamento: enteroONull(det.id_medicamento) ?? null,
            })),
          },
        },
      })

      // Los artículos en especie que son medicamentos entran al inventario.
      for (const det of detalles) {
        const id_medicamento = enteroONull(det.id_medicamento) ?? null
        if (!id_medicamento) continue
        let id_lote = null
        const nombreLote = texto(det.lote)
        if (nombreLote) {
          const existente = await tx.medicamentoLote.findFirst({ where: { id_medicamento, lote: nombreLote } })
          if (existente) {
            id_lote = existente.id
            if (!existente.caducidad && det.caducidad) {
              await tx.medicamentoLote.update({
                where: { id: existente.id },
                data: { caducidad: fechaPuraONull(det.caducidad) },
              })
            }
          } else {
            const nuevo = await tx.medicamentoLote.create({
              data: {
                id_medicamento,
                lote: nombreLote,
                caducidad: fechaPuraONull(det.caducidad) ?? null,
              },
            })
            id_lote = nuevo.id
          }
        }
        await tx.movimientoInventario.create({
          data: {
            id_medicamento,
            id_lote,
            tipo: 'ENTRADA',
            cantidad: Math.max(1, Math.round(Number(det.cantidad))),
            motivo: `Donación #${donacion.id} en especie`,
            id_donacion: donacion.id,
            id_user,
          },
        })
      }

      return donacion
    })

    const completa = await prisma.donacion.findUnique({ where: { id: creada.id }, include: INCLUDE })
    res.status(201).json(salida(completa))
  }),
)

// PUT /donaciones/:id
router.put(
  '/donaciones/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const datos = datosDonacion(req.body)
    if (Object.keys(datos).length === 0) throw new ApiError(400, 'No hay datos para actualizar')
    const actualizada = await prisma.donacion.update({ where: { id }, data: datos, include: INCLUDE })
    res.json(salida(actualizada))
  }),
)

// DELETE /donaciones/:id (revierte también el inventario que generó)
router.delete(
  '/donaciones/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    await prisma.$transaction(async (tx) => {
      await tx.movimientoInventario.deleteMany({ where: { id_donacion: id } })
      await tx.donacion.delete({ where: { id } })
    })
    res.status(204).end()
  }),
)

export default router

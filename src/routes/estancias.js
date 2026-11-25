import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  aEntero,
  enteroONull,
  fechaONull,
  nochesDe,
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

const BENEF = { id: true, folio: true, nombreCompleto: true, tipo: true }

const INCLUDE = {
  paciente: { select: BENEF },
  acompanante: { select: BENEF },
  cama: { select: { id: true, nombre: true, habitacion: { select: { id: true, nombre: true } } } },
  hospital: { select: { id: true, nombre: true } },
}

const conCalculos = (e) => ({ ...e, noches: nochesDe(e.fechaEntrada, e.fechaSalida), enCurso: !e.fechaSalida })

async function validarCamaLibre(id_cama, idExcluir = null) {
  if (!id_cama) return
  const cama = await prisma.cama.findUnique({ where: { id: id_cama }, select: { id: true, nombre: true, activa: true } })
  if (!cama) invalido('id_cama', 'La cama no existe')
  if (!cama.activa) invalido('id_cama', 'La cama está desactivada')
  const ocupada = await prisma.estancia.findFirst({
    where: { id_cama, fechaSalida: null, ...(idExcluir ? { NOT: { id: idExcluir } } : {}) },
    select: { id: true },
  })
  if (ocupada) throw new ApiError(409, `La cama ${cama.nombre} ya está ocupada por una estancia en curso`)
}

// GET /estancias/ocupacion → plano de camas
router.get(
  '/estancias/ocupacion',
  ah(async (req, res) => {
    const habitaciones = await prisma.habitacion.findMany({
      where: { activa: true },
      orderBy: { nombre: 'asc' },
      include: {
        camas: {
          where: { activa: true },
          orderBy: { id: 'asc' },
          include: {
            estancias: {
              where: { fechaSalida: null },
              orderBy: { fechaEntrada: 'desc' },
              take: 1,
              include: {
                paciente: { select: BENEF },
                acompanante: { select: BENEF },
              },
            },
          },
        },
      },
    })

    let camas = 0
    let ocupadas = 0
    const salida = habitaciones.map((h) => {
      const camasOut = h.camas.map((c) => {
        camas++
        const estancia = c.estancias[0] ? conCalculos(c.estancias[0]) : null
        if (estancia) ocupadas++
        return { id: c.id, nombre: c.nombre, activa: c.activa, ocupada: Boolean(estancia), estancia }
      })
      return { id: h.id, nombre: h.nombre, camas: camasOut }
    })

    res.json({
      totales: { camas, ocupadas, libres: camas - ocupadas },
      habitaciones: salida,
    })
  }),
)

// GET /estancias
router.get(
  '/estancias',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const enCurso = aBooleano(req.query.enCurso)
    const where = unir(
      enCurso === true ? { fechaSalida: null } : null,
      enCurso === false ? { NOT: { fechaSalida: null } } : null,
      req.query.id_paciente !== undefined ? { id_paciente: aEntero(req.query.id_paciente) } : null,
      req.query.id_cama !== undefined ? { id_cama: aEntero(req.query.id_cama) } : null,
      req.query.id_acompanante !== undefined ? { id_acompanante: aEntero(req.query.id_acompanante) } : null,
      rangoFecha(req, 'fechaEntrada', { fechaPura: false }),
    )
    const [total, filas] = await Promise.all([
      prisma.estancia.count({ where }),
      prisma.estancia.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ fechaEntrada: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ])
    res.json(paginado(filas.map(conCalculos), total, page, pageSize))
  }),
)

// POST /estancias
router.post(
  '/estancias',
  ah(async (req, res) => {
    requerido(req.body.id_paciente, 'id_paciente', 'Selecciona a la persona que se aloja')
    const id_paciente = aEntero(req.body.id_paciente)
    const paciente = await prisma.beneficiario.findUnique({ where: { id: id_paciente } })
    if (!paciente) invalido('id_paciente', 'El beneficiario no existe')

    if (await prisma.estancia.count({ where: { id_paciente, fechaSalida: null } })) {
      throw new ApiError(409, `${paciente.nombreCompleto} ya tiene una estancia en curso`)
    }

    const id_acompanante = enteroONull(req.body.id_acompanante)
    if (id_acompanante) {
      const acomp = await prisma.beneficiario.count({ where: { id: id_acompanante } })
      if (!acomp) invalido('id_acompanante', 'El acompañante no existe')
    }

    const id_cama = enteroONull(req.body.id_cama)
    await validarCamaLibre(id_cama)

    const creada = await prisma.estancia.create({
      data: {
        id_paciente,
        id_acompanante: id_acompanante ?? null,
        fechaEntrada: fechaONull(req.body.fechaEntrada) ?? new Date(),
        fechaSalida: fechaONull(req.body.fechaSalida) ?? null,
        motivo: texto(req.body.motivo),
        id_hospital: enteroONull(req.body.id_hospital) ?? paciente.id_hospital ?? null,
        id_cama: id_cama ?? null,
        id_contacto_emergencia: enteroONull(req.body.id_contacto_emergencia) ?? null,
      },
      include: INCLUDE,
    })
    res.status(201).json(conCalculos(creada))
  }),
)

// PUT /estancias/:id (también recibe enCurso desde el interruptor de la tabla)
router.put(
  '/estancias/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const actual = await prisma.estancia.findUnique({ where: { id } })
    if (!actual) throw new ApiError(404, 'Estancia no encontrada')

    const datos = soloCampos(req.body, [
      'id_acompanante',
      'fechaEntrada',
      'fechaSalida',
      'motivo',
      'id_hospital',
      'id_cama',
      'id_contacto_emergencia',
    ])

    if (req.body.enCurso !== undefined) {
      const enCurso = aBooleano(req.body.enCurso)
      datos.fechaSalida = enCurso ? null : actual.fechaSalida ?? new Date()
      if (enCurso) await validarCamaLibre(actual.id_cama, id)
    }

    if (datos.fechaEntrada !== undefined) datos.fechaEntrada = fechaONull(datos.fechaEntrada)
    if (datos.fechaSalida !== undefined) datos.fechaSalida = fechaONull(datos.fechaSalida)
    if (datos.motivo !== undefined) datos.motivo = texto(datos.motivo)
    for (const campo of ['id_acompanante', 'id_hospital', 'id_cama', 'id_contacto_emergencia']) {
      if (datos[campo] !== undefined) datos[campo] = enteroONull(datos[campo])
    }

    if (datos.id_cama !== undefined && datos.id_cama !== null && datos.id_cama !== actual.id_cama) {
      await validarCamaLibre(datos.id_cama, id)
    }

    const entrada = datos.fechaEntrada ?? actual.fechaEntrada
    const salida = datos.fechaSalida !== undefined ? datos.fechaSalida : actual.fechaSalida
    if (salida && entrada && new Date(salida) < new Date(entrada)) {
      invalido('fechaSalida', 'La salida no puede ser anterior a la entrada')
    }

    const actualizada = await prisma.estancia.update({ where: { id }, data: datos, include: INCLUDE })
    res.json(conCalculos(actualizada))
  }),
)

// POST /estancias/:id/salida
router.post(
  '/estancias/:id/salida',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const actual = await prisma.estancia.findUnique({ where: { id } })
    if (!actual) throw new ApiError(404, 'Estancia no encontrada')
    const salida = fechaONull(req.body.fechaSalida) ?? actual.fechaSalida ?? new Date()
    const actualizada = await prisma.estancia.update({
      where: { id },
      data: { fechaSalida: salida },
      include: INCLUDE,
    })
    res.json(conCalculos(actualizada))
  }),
)

// DELETE /estancias/:id
router.delete(
  '/estancias/:id',
  ah(async (req, res) => {
    await prisma.estancia.delete({ where: { id: aEntero(req.params.id) } })
    res.status(204).end()
  }),
)

export default router

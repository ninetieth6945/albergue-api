import { Router } from 'express'
import { prisma } from '../prisma.js'
import { auditar } from '../auth.js'
import {
  ah,
  ApiError,
  aEntero,
  edadDe,
  enteroONull,
  fechaPuraONull,
  paginacion,
  paginado,
  buscarEn,
  rangoFecha,
  requerido,
  soloCampos,
  texto,
  unir,
  invalido,
} from '../lib/utils.js'

const router = Router()

const TIPOS = ['NINO_ADOLESCENTE', 'MAMA_PAPA', 'HERMANO', 'OTRO']
const ESTATUS = ['ACTIVO', 'INACTIVO', 'EGRESADO']
const SEXOS = ['M', 'F', 'OTRO']

const INCLUDE_LISTA = {
  municipio: { select: { id: true, nombre: true } },
  localidad: { select: { id: true, nombre: true } },
  hospital: { select: { id: true, nombre: true } },
}

const SELECT_BASICO = { id: true, folio: true, nombreCompleto: true, tipo: true }

const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

const conEdad = (b) => ({ ...b, edad: edadDe(b.fechaNacimiento) })

// Normaliza el cuerpo de un alta/edición de beneficiario.
function datosBeneficiario(body, { crear = false } = {}) {
  const d = soloCampos(body, [
    'folio',
    'nombreCompleto',
    'curp',
    'sexo',
    'fechaNacimiento',
    'telefono',
    'fechaIngreso',
    'id_municipio',
    'id_localidad',
    'id_hospital',
    'id_paciente_relacionado',
    'observaciones',
    'tipo',
    'estatus',
  ])

  if (crear) requerido(d.nombreCompleto, 'nombreCompleto', 'El nombre completo es obligatorio')
  if (d.nombreCompleto !== undefined) d.nombreCompleto = texto(d.nombreCompleto)

  if (d.curp !== undefined) {
    const curp = texto(d.curp)
    if (curp && curp.length > 18) invalido('curp', 'La CURP no puede tener más de 18 caracteres')
    d.curp = curp ? curp.toUpperCase() : null
  }
  if (d.telefono !== undefined) d.telefono = texto(d.telefono)
  if (d.observaciones !== undefined) d.observaciones = texto(d.observaciones)

  if (d.sexo !== undefined) {
    if (d.sexo === null || d.sexo === '') d.sexo = null
    else if (!SEXOS.includes(d.sexo)) invalido('sexo', `Debe ser uno de: ${SEXOS.join(', ')}`)
  }

  if (d.tipo !== undefined || crear) {
    if (d.tipo === undefined) d.tipo = 'NINO_ADOLESCENTE'
    if (!TIPOS.includes(d.tipo)) invalido('tipo', `Debe ser uno de: ${TIPOS.join(', ')}`)
  }

  if (d.estatus !== undefined) {
    if (!ESTATUS.includes(d.estatus)) invalido('estatus', `Debe ser uno de: ${ESTATUS.join(', ')}`)
  } else if (crear) {
    d.estatus = 'ACTIVO'
  }

  if (d.fechaNacimiento !== undefined) d.fechaNacimiento = fechaPuraONull(d.fechaNacimiento)
  if (d.fechaIngreso !== undefined) d.fechaIngreso = fechaPuraONull(d.fechaIngreso)
  else if (crear) d.fechaIngreso = fechaPuraONull(hoyISO())

  for (const campo of ['id_municipio', 'id_localidad', 'id_hospital', 'id_paciente_relacionado']) {
    if (d[campo] !== undefined) d[campo] = enteroONull(d[campo])
  }

  return d
}

async function siguienteFolio() {
  const ultimo = await prisma.beneficiario.findFirst({
    where: { folio: { startsWith: 'BEN-' } },
    orderBy: { folio: 'desc' },
    select: { folio: true },
  })
  const n = ultimo ? Number(ultimo.folio.replace(/\D/g, '')) + 1 : 1
  return `BEN-${String(n).padStart(5, '0')}`
}

// GET /beneficiarios
router.get(
  '/beneficiarios',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const filtros = [
      buscarEn(['nombreCompleto', 'folio', 'curp', 'telefono'], req.query.q),
      TIPOS.includes(req.query.tipo) ? { tipo: req.query.tipo } : null,
      ESTATUS.includes(req.query.estatus) ? { estatus: req.query.estatus } : null,
      SEXOS.includes(req.query.sexo) ? { sexo: req.query.sexo } : null,
      req.query.id_paciente_relacionado !== undefined
        ? { id_paciente_relacionado: aEntero(req.query.id_paciente_relacionado) }
        : null,
      req.query.id_municipio !== undefined ? { id_municipio: aEntero(req.query.id_municipio) } : null,
      req.query.id_hospital !== undefined ? { id_hospital: aEntero(req.query.id_hospital) } : null,
      rangoFecha(req, 'fechaIngreso'),
    ]
    const where = unir(...filtros)
    const orden =
      req.query.orden === 'recientes'
        ? [{ fechaIngreso: 'desc' }, { id: 'desc' }]
        : [{ nombreCompleto: 'asc' }]

    const [total, filas] = await Promise.all([
      prisma.beneficiario.count({ where }),
      prisma.beneficiario.findMany({ where, include: INCLUDE_LISTA, orderBy: orden, skip, take }),
    ])
    res.json(paginado(filas.map(conEdad), total, page, pageSize))
  }),
)

// GET /beneficiarios/:id
router.get(
  '/beneficiarios/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (!id) throw new ApiError(404, 'Beneficiario no encontrado')
    const b = await prisma.beneficiario.findUnique({
      where: { id },
      include: {
        ...INCLUDE_LISTA,
        pacienteRelacionado: { select: SELECT_BASICO },
        familiares: { select: SELECT_BASICO, orderBy: { id: 'asc' } },
        contactos: { orderBy: { id: 'asc' } },
        diagnosticos: { orderBy: { fecha: 'desc' } },
      },
    })
    if (!b) throw new ApiError(404, 'Beneficiario no encontrado')
    res.json(conEdad(b))
  }),
)

// POST /beneficiarios
router.post(
  '/beneficiarios',
  ah(async (req, res) => {
    const datos = datosBeneficiario(req.body, { crear: true })
    if (datos.id_paciente_relacionado) {
      const existe = await prisma.beneficiario.count({ where: { id: datos.id_paciente_relacionado } })
      if (!existe) invalido('id_paciente_relacionado', 'El paciente relacionado no existe')
    }
    if (!datos.folio) datos.folio = await siguienteFolio()

    let creado
    let intentos = 0
    while (!creado) {
      try {
        creado = await prisma.beneficiario.create({ data: datos, include: INCLUDE_LISTA })
      } catch (e) {
        // Si dos altas simultáneas generan el mismo folio, se recalcula.
        if (e?.code === 'P2002' && !req.body.folio && intentos < 3) {
          intentos++
          datos.folio = await siguienteFolio()
          continue
        }
        throw e
      }
    }
    res.status(201).json(conEdad(creado))
  }),
)

// PUT /beneficiarios/:id
router.put(
  '/beneficiarios/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (!id) throw new ApiError(404, 'Beneficiario no encontrado')
    const datos = datosBeneficiario(req.body)
    if (datos.folio !== undefined) {
      datos.folio = texto(datos.folio)
      if (!datos.folio) delete datos.folio
    }
    if (datos.id_paciente_relacionado === id) {
      invalido('id_paciente_relacionado', 'Un beneficiario no puede relacionarse consigo mismo')
    }
    if (Object.keys(datos).length === 0) throw new ApiError(400, 'No hay datos para actualizar')

    const actualizado = await prisma.beneficiario.update({
      where: { id },
      data: datos,
      include: INCLUDE_LISTA,
    })
    auditar(req, 'EDITAR', 'beneficiarios', id, 'Actualización de beneficiario')
    res.json(conEdad(actualizado))
  }),
)

// DELETE /beneficiarios/:id
router.delete(
  '/beneficiarios/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (!id) throw new ApiError(404, 'Beneficiario no encontrado')
    const [estancias, apoyos] = await Promise.all([
      prisma.estancia.count({ where: { id_paciente: id } }),
      prisma.apoyo.count({ where: { id_beneficiario: id } }),
    ])
    if (estancias || apoyos) {
      throw new ApiError(
        409,
        'No se puede eliminar: tiene estancias o apoyos registrados. Cámbiale el estatus a Inactivo o Egresado.',
      )
    }
    await prisma.beneficiario.delete({ where: { id } })
    auditar(req, 'ELIMINAR', 'beneficiarios', id, 'Eliminación de beneficiario')
    res.status(204).end()
  }),
)

// ── Contactos de emergencia ──────────────────────────────────────────────
router.get(
  '/beneficiarios/:id/contactos',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    res.json(await prisma.contactoEmergencia.findMany({ where: { id_beneficiario: id }, orderBy: { id: 'asc' } }))
  }),
)

router.post(
  '/beneficiarios/:id/contactos',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    requerido(req.body.telefono, 'telefono', 'El teléfono es obligatorio')
    const existe = await prisma.beneficiario.count({ where: { id } })
    if (!existe) throw new ApiError(404, 'Beneficiario no encontrado')
    const creado = await prisma.contactoEmergencia.create({
      data: {
        id_beneficiario: id,
        nombre: texto(req.body.nombre),
        telefono: texto(req.body.telefono),
        parentesco: texto(req.body.parentesco),
      },
    })
    res.status(201).json(creado)
  }),
)

router.put(
  '/contactos-emergencia/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const datos = soloCampos(req.body, ['nombre', 'telefono', 'parentesco'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.telefono !== undefined) datos.telefono = texto(datos.telefono)
    if (datos.parentesco !== undefined) datos.parentesco = texto(datos.parentesco)
    res.json(await prisma.contactoEmergencia.update({ where: { id }, data: datos }))
  }),
)

router.delete(
  '/contactos-emergencia/:id',
  ah(async (req, res) => {
    await prisma.contactoEmergencia.delete({ where: { id: aEntero(req.params.id) } })
    res.status(204).end()
  }),
)

// ── Diagnósticos (datos sensibles: cada acceso queda en auditoría) ───────
router.get(
  '/beneficiarios/:id/diagnosticos',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const filas = await prisma.beneficiarioDiagnostico.findMany({
      where: { id_beneficiario: id },
      orderBy: { fecha: 'desc' },
    })
    auditar(req, 'VER', 'beneficiario_diagnosticos', id, 'Consulta de diagnósticos')
    res.json(filas)
  }),
)

router.post(
  '/beneficiarios/:id/diagnosticos',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    requerido(req.body.diagnostico, 'diagnostico', 'El diagnóstico es obligatorio')
    const existe = await prisma.beneficiario.count({ where: { id } })
    if (!existe) throw new ApiError(404, 'Beneficiario no encontrado')
    const creado = await prisma.beneficiarioDiagnostico.create({
      data: { id_beneficiario: id, diagnostico: texto(req.body.diagnostico) },
    })
    auditar(req, 'CREAR', 'beneficiario_diagnosticos', creado.id, `Alta de diagnóstico del beneficiario ${id}`)
    res.status(201).json(creado)
  }),
)

router.put(
  '/diagnosticos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    requerido(req.body.diagnostico, 'diagnostico', 'El diagnóstico es obligatorio')
    const actualizado = await prisma.beneficiarioDiagnostico.update({
      where: { id },
      data: { diagnostico: texto(req.body.diagnostico) },
    })
    auditar(req, 'EDITAR', 'beneficiario_diagnosticos', id, 'Edición de diagnóstico')
    res.json(actualizado)
  }),
)

router.delete(
  '/diagnosticos/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const eliminado = await prisma.beneficiarioDiagnostico.delete({ where: { id } })
    auditar(req, 'ELIMINAR', 'beneficiario_diagnosticos', id, `Diagnóstico del beneficiario ${eliminado.id_beneficiario}`)
    res.status(204).end()
  }),
)

export default router

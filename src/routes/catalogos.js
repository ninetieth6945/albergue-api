import { Router } from 'express'
import { prisma } from '../prisma.js'
import {
  ah,
  ApiError,
  aBooleano,
  aEntero,
  buscarEn,
  paginacion,
  paginado,
  requerido,
  soloCampos,
  texto,
  unir,
  invalido,
} from '../lib/utils.js'

const router = Router()

const bool = (v) => (v === undefined ? undefined : Boolean(aBooleano(v) ?? v))

// ── Municipios ───────────────────────────────────────────────────────────
router.get(
  '/municipios',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(buscarEn(['nombre', 'estado'], req.query.q))
    const [total, filas] = await Promise.all([
      prisma.municipio.count({ where }),
      prisma.municipio.findMany({ where, orderBy: { nombre: 'asc' }, skip, take }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/municipios',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    res.status(201).json(
      await prisma.municipio.create({ data: { nombre: texto(req.body.nombre), estado: texto(req.body.estado) } }),
    )
  }),
)

router.put(
  '/municipios/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'estado'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.estado !== undefined) datos.estado = texto(datos.estado)
    res.json(await prisma.municipio.update({ where: { id: aEntero(req.params.id) }, data: datos }))
  }),
)

router.delete(
  '/municipios/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const [localidades, beneficiarios] = await Promise.all([
      prisma.localidad.count({ where: { id_municipio: id } }),
      prisma.beneficiario.count({ where: { id_municipio: id } }),
    ])
    if (localidades || beneficiarios) {
      throw new ApiError(409, 'No se puede eliminar: el municipio tiene localidades o beneficiarios registrados.')
    }
    await prisma.municipio.delete({ where: { id } })
    res.status(204).end()
  }),
)

// ── Localidades ──────────────────────────────────────────────────────────
router.get(
  '/localidades',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre'], req.query.q),
      req.query.id_municipio !== undefined ? { id_municipio: aEntero(req.query.id_municipio) } : null,
    )
    const [total, filas] = await Promise.all([
      prisma.localidad.count({ where }),
      prisma.localidad.findMany({
        where,
        include: { municipio: { select: { id: true, nombre: true } } },
        orderBy: { nombre: 'asc' },
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/localidades',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    requerido(req.body.id_municipio, 'id_municipio', 'Selecciona el municipio')
    const id_municipio = aEntero(req.body.id_municipio)
    if (!(await prisma.municipio.count({ where: { id: id_municipio } }))) {
      invalido('id_municipio', 'El municipio no existe')
    }
    res.status(201).json(
      await prisma.localidad.create({
        data: { nombre: texto(req.body.nombre), id_municipio },
        include: { municipio: { select: { id: true, nombre: true } } },
      }),
    )
  }),
)

router.put(
  '/localidades/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'id_municipio'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.id_municipio !== undefined) datos.id_municipio = aEntero(datos.id_municipio)
    res.json(
      await prisma.localidad.update({
        where: { id: aEntero(req.params.id) },
        data: datos,
        include: { municipio: { select: { id: true, nombre: true } } },
      }),
    )
  }),
)

router.delete(
  '/localidades/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (await prisma.beneficiario.count({ where: { id_localidad: id } })) {
      throw new ApiError(409, 'No se puede eliminar: la localidad tiene beneficiarios registrados.')
    }
    await prisma.localidad.delete({ where: { id } })
    res.status(204).end()
  }),
)

// ── Hospitales ───────────────────────────────────────────────────────────
router.get(
  '/hospitales',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre', 'direccion'], req.query.q),
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
    )
    const [total, filas] = await Promise.all([
      prisma.hospital.count({ where }),
      prisma.hospital.findMany({ where, orderBy: { nombre: 'asc' }, skip, take }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/hospitales',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    res.status(201).json(
      await prisma.hospital.create({
        data: { nombre: texto(req.body.nombre), direccion: texto(req.body.direccion), activo: bool(req.body.activo) ?? true },
      }),
    )
  }),
)

router.put(
  '/hospitales/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'direccion', 'activo'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.direccion !== undefined) datos.direccion = texto(datos.direccion)
    if (datos.activo !== undefined) datos.activo = bool(datos.activo)
    res.json(await prisma.hospital.update({ where: { id: aEntero(req.params.id) }, data: datos }))
  }),
)

router.delete(
  '/hospitales/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    const [benef, est] = await Promise.all([
      prisma.beneficiario.count({ where: { id_hospital: id } }),
      prisma.estancia.count({ where: { id_hospital: id } }),
    ])
    if (benef || est) throw new ApiError(409, 'No se puede eliminar: el hospital está en uso. Desactívalo en su lugar.')
    await prisma.hospital.delete({ where: { id } })
    res.status(204).end()
  }),
)

// ── Tipos de apoyo ───────────────────────────────────────────────────────
router.get(
  '/tipos-apoyo',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre'], req.query.q),
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
    )
    const [total, filas] = await Promise.all([
      prisma.tipoApoyo.count({ where }),
      prisma.tipoApoyo.findMany({ where, orderBy: { nombre: 'asc' }, skip, take }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/tipos-apoyo',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    res.status(201).json(
      await prisma.tipoApoyo.create({ data: { nombre: texto(req.body.nombre), activo: bool(req.body.activo) ?? true } }),
    )
  }),
)

router.put(
  '/tipos-apoyo/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'activo'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.activo !== undefined) datos.activo = bool(datos.activo)
    res.json(await prisma.tipoApoyo.update({ where: { id: aEntero(req.params.id) }, data: datos }))
  }),
)

router.delete(
  '/tipos-apoyo/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (await prisma.apoyo.count({ where: { id_tipo_apoyo: id } })) {
      throw new ApiError(409, 'No se puede eliminar: el tipo de apoyo tiene registros. Desactívalo en su lugar.')
    }
    await prisma.tipoApoyo.delete({ where: { id } })
    res.status(204).end()
  }),
)

// ── Destinos de donación ─────────────────────────────────────────────────
router.get(
  '/destinos-donacion',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre'], req.query.q),
      req.query.activo !== undefined ? { activo: aBooleano(req.query.activo) } : null,
    )
    const [total, filas] = await Promise.all([
      prisma.destinoDonacion.count({ where }),
      prisma.destinoDonacion.findMany({ where, orderBy: { nombre: 'asc' }, skip, take }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/destinos-donacion',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    res.status(201).json(
      await prisma.destinoDonacion.create({
        data: { nombre: texto(req.body.nombre), activo: bool(req.body.activo) ?? true },
      }),
    )
  }),
)

router.put(
  '/destinos-donacion/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'activo'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.activo !== undefined) datos.activo = bool(datos.activo)
    res.json(await prisma.destinoDonacion.update({ where: { id: aEntero(req.params.id) }, data: datos }))
  }),
)

router.delete(
  '/destinos-donacion/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (await prisma.donacion.count({ where: { id_destino: id } })) {
      throw new ApiError(409, 'No se puede eliminar: el destino tiene donaciones. Desactívalo en su lugar.')
    }
    await prisma.destinoDonacion.delete({ where: { id } })
    res.status(204).end()
  }),
)

// ── Habitaciones y camas ─────────────────────────────────────────────────
router.get(
  '/habitaciones',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      buscarEn(['nombre'], req.query.q),
      req.query.activa !== undefined ? { activa: aBooleano(req.query.activa) } : null,
    )
    const [total, filas] = await Promise.all([
      prisma.habitacion.count({ where }),
      prisma.habitacion.findMany({
        where,
        include: { camas: { orderBy: { id: 'asc' } } },
        orderBy: { nombre: 'asc' },
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

router.post(
  '/habitaciones',
  ah(async (req, res) => {
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    const nombre = texto(req.body.nombre)
    const camas = aEntero(req.body.numeroCamas, 0)
    const creada = await prisma.habitacion.create({
      data: {
        nombre,
        activa: bool(req.body.activa) ?? true,
        ...(camas > 0
          ? { camas: { create: Array.from({ length: camas }, (_, i) => ({ nombre: `Cama ${i + 1}` })) } }
          : {}),
      },
      include: { camas: { orderBy: { id: 'asc' } } },
    })
    res.status(201).json(creada)
  }),
)

router.put(
  '/habitaciones/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'activa'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.activa !== undefined) datos.activa = bool(datos.activa)
    res.json(
      await prisma.habitacion.update({
        where: { id: aEntero(req.params.id) },
        data: datos,
        include: { camas: { orderBy: { id: 'asc' } } },
      }),
    )
  }),
)

router.delete(
  '/habitaciones/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (await prisma.cama.count({ where: { id_habitacion: id } })) {
      throw new ApiError(409, 'No se puede eliminar: la habitación tiene camas registradas. Desactívala en su lugar.')
    }
    await prisma.habitacion.delete({ where: { id } })
    res.status(204).end()
  }),
)

router.post(
  '/camas',
  ah(async (req, res) => {
    requerido(req.body.id_habitacion, 'id_habitacion', 'Selecciona la habitación')
    requerido(req.body.nombre, 'nombre', 'El nombre es obligatorio')
    const id_habitacion = aEntero(req.body.id_habitacion)
    if (!(await prisma.habitacion.count({ where: { id: id_habitacion } }))) {
      invalido('id_habitacion', 'La habitación no existe')
    }
    res.status(201).json(
      await prisma.cama.create({
        data: { id_habitacion, nombre: texto(req.body.nombre), activa: bool(req.body.activa) ?? true },
      }),
    )
  }),
)

router.put(
  '/camas/:id',
  ah(async (req, res) => {
    const datos = soloCampos(req.body, ['nombre', 'activa'])
    if (datos.nombre !== undefined) datos.nombre = texto(datos.nombre)
    if (datos.activa !== undefined) datos.activa = bool(datos.activa)
    res.json(await prisma.cama.update({ where: { id: aEntero(req.params.id) }, data: datos }))
  }),
)

router.delete(
  '/camas/:id',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (await prisma.estancia.count({ where: { id_cama: id } })) {
      throw new ApiError(409, 'No se puede eliminar: la cama tiene estancias registradas. Desactívala en su lugar.')
    }
    await prisma.cama.delete({ where: { id } })
    res.status(204).end()
  }),
)

export default router

import { Router } from 'express'
import { prisma } from '../prisma.js'
import { exigirAdmin } from '../auth.js'
import { ah, aEntero, paginacion, paginado, rangoFecha, unir } from '../lib/utils.js'

const router = Router()

router.use(exigirAdmin)

// GET /auditoria
router.get(
  '/auditoria',
  ah(async (req, res) => {
    const { page, pageSize, skip, take } = paginacion(req, { porDefecto: 10 })
    const where = unir(
      req.query.accion ? { accion: String(req.query.accion) } : null,
      req.query.entidad ? { entidad: String(req.query.entidad) } : null,
      req.query.entidadId !== undefined ? { entidadId: aEntero(req.query.entidadId) } : null,
      req.query.id_user !== undefined ? { id_user: aEntero(req.query.id_user) } : null,
      rangoFecha(req, 'fecha', { fechaPura: false }),
    )
    const [total, filas] = await Promise.all([
      prisma.auditoria.count({ where }),
      prisma.auditoria.findMany({
        where,
        include: { user: { select: { id_user: true, username: true } } },
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ])
    res.json(paginado(filas, total, page, pageSize))
  }),
)

export default router

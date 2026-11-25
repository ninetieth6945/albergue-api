import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../prisma.js'
import { autenticar, exigirPerfil } from '../auth.js'
import { getAuth } from 'firebase-admin/auth'
import {
  ah,
  ApiError,
  archivoOut,
  firmaValida,
  ARCHIVO_SELECT,
  aEntero,
} from '../lib/utils.js'

const router = Router()

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!MIMES.has(file.mimetype)) {
      return cb(new ApiError(400, 'Solo se aceptan imágenes JPG/PNG/WebP o archivos PDF'))
    }
    cb(null, true)
  },
})

const nombreLegible = (original) => {
  try {
    const utf8 = Buffer.from(original, 'latin1').toString('utf8')
    return Buffer.from(utf8, 'utf8').toString('latin1') === original ? utf8 : original
  } catch {
    return original
  }
}

// GET /archivos/:id/contenido — público con firma (para <img>/<a>), o con token Bearer.
router.get(
  '/archivos/:id/contenido',
  ah(async (req, res) => {
    const id = aEntero(req.params.id)
    if (!id) throw new ApiError(404, 'Archivo no encontrado')

    let autorizado = firmaValida(id, req.query.firma)
    if (!autorizado) {
      const cabecera = req.headers.authorization || ''
      const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : null
      if (!token) throw new ApiError(403, 'Enlace de archivo inválido')
      try {
        await getAuth().verifyIdToken(token)
        autorizado = true
      } catch {
        throw new ApiError(403, 'Enlace de archivo inválido')
      }
    }

    const archivo = await prisma.archivo.findUnique({
      where: { id },
      select: { ...ARCHIVO_SELECT, contenido: true },
    })
    if (!archivo || !archivo.contenido) throw new ApiError(404, 'Archivo no encontrado')

    res.setHeader('Content-Type', archivo.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(archivo.contenido.length))
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(archivo.nombreOriginal)}`)
    res.end(archivo.contenido)
  }),
)

// A partir de aquí todo requiere sesión con perfil. Limitado a /archivos para no
// interceptar las rutas de otros routers (este router se monta en la raíz de la app).
router.use('/archivos', autenticar, exigirPerfil)

router.post(
  '/archivos',
  subida.single('archivo'),
  ah(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'Adjunta un archivo en el campo "archivo"')
    const nombre = nombreLegible(req.file.originalname).slice(0, 255)
    const creado = await prisma.archivo.create({
      data: {
        nombreOriginal: nombre || 'archivo',
        ruta: '/archivos/pendiente',
        mimeType: req.file.mimetype,
        tamano: req.file.size,
        contenido: req.file.buffer,
      },
      select: ARCHIVO_SELECT,
    })
    const actualizado = await prisma.archivo.update({
      where: { id: creado.id },
      data: { ruta: `/archivos/${creado.id}/contenido` },
      select: ARCHIVO_SELECT,
    })
    res.status(201).json(archivoOut(actualizado))
  }),
)

router.delete(
  '/archivos/:id',
  ah(async (req, res) => {
    await prisma.archivo.delete({ where: { id: aEntero(req.params.id) } })
    res.status(204).end()
  }),
)

export default router

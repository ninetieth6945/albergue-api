// Catálogos mínimos para que el sistema arranque usable. Es idempotente: se puede repetir.
// Uso: npm run seed:catalogos
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const tipos = [
  'Despensa',
  'Medicamentos',
  'Ropa y calzado',
  'Artículos de higiene',
  'Apoyo funerario',
  'Otro',
]

const destinos = ['Albergue (operación)', 'Despensa', 'Medicamentos', 'Otro']

const main = async () => {
  for (const nombre of tipos) {
    await prisma.tipoApoyo.upsert({ where: { nombre }, update: {}, create: { nombre } })
  }
  for (const nombre of destinos) {
    await prisma.destinoDonacion.upsert({ where: { nombre }, update: {}, create: { nombre } })
  }
  console.log(`Listo: ${tipos.length} tipos de apoyo y ${destinos.length} destinos de donación.`)
  console.log('Faltan por capturar desde el sistema: hospitales, municipios/localidades, habitaciones y camas.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

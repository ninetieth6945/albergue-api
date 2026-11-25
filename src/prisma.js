import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'true' ? ['warn', 'error'] : ['error'],
})

process.on('beforeExit', () => {
  void prisma.$disconnect()
})

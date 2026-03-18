import { PrismaClient } from '@prisma/client'
import { validateServerEnv } from '@/lib/env'

// Valideer bij opstarten — gooit een heldere fout als DATABASE_URL etc. ontbreekt
validateServerEnv()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

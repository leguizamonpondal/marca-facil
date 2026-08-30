import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  logger.info('Cerrando conexión a base de datos...');
  await prisma.$disconnect();
});

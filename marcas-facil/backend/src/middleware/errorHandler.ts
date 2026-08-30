import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Errores de validación Zod
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: err.errors.map(e => ({ campo: e.path.join('.'), mensaje: e.message })),
    });
  }

  // Errores de la aplicación
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Errores de Prisma
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    if (prismaErr.code === 'P2002') {
      return res.status(409).json({
        error: 'El registro ya existe',
        campo: prismaErr.meta?.target,
      });
    }
    if (prismaErr.code === 'P2025') {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
  }

  // Error genérico
  logger.error(`Error no controlado: ${err.message}`, { stack: err.stack, url: req.url });
  return res.status(500).json({
    error: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' ? { detail: err.message } : {}),
  });
}

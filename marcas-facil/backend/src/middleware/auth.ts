import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { prisma } from '../db/client';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    cuit: string;
    email: string;
    plan: string;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Token de autenticación requerido', 'UNAUTHORIZED');
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET!;
    const payload = jwt.verify(token, secret) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, cuit: true, email: true, plan: true, activo: true },
    });

    if (!user || !user.activo) {
      throw new AppError(401, 'Usuario no autorizado o inactivo', 'UNAUTHORIZED');
    }

    req.user = { id: user.id, cuit: user.cuit, email: user.email, plan: user.plan };
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Token inválido o expirado', 'INVALID_TOKEN'));
    }
    next(err);
  }
}

export function requirePlan(...plans: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, 'No autenticado', 'UNAUTHORIZED'));
    if (!plans.includes(req.user.plan)) {
      return next(new AppError(403, 'Esta función requiere un plan superior', 'PLAN_REQUIRED'));
    }
    next();
  };
}

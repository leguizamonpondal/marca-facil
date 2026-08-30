import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { generateReferralCode } from '../../utils/helpers';

const router = Router();

// ── Schemas de validación ─────────────────────────────────────────────────────
const registroSchema = z.object({
  cuit: z.string().regex(/^\d{11}$/, 'CUIT debe tener 11 dígitos sin guiones'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  razonSocial: z.string().min(2, 'Nombre/razón social requerido'),
  tipoPersona: z.enum(['FISICA', 'JURIDICA']).optional(),
  domicilio: z.string().optional(),
  telefono: z.string().optional(),
  referralCode: z.string().optional(),
  terminosAceptados: z.boolean().refine(v => v === true, 'Debe aceptar los términos y condiciones'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// ── POST /api/auth/registro ────────────────────────────────────────────────────
router.post('/registro', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registroSchema.parse(req.body);

    // Verificar CUIT único (1 cuenta por CUIT)
    const existeCuit = await prisma.user.findUnique({ where: { cuit: data.cuit } });
    if (existeCuit) {
      throw new AppError(409, 'Ya existe una cuenta registrada con ese CUIT', 'CUIT_EXISTS');
    }

    const existeEmail = await prisma.user.findUnique({ where: { email: data.email } });
    if (existeEmail) {
      throw new AppError(409, 'Ya existe una cuenta con ese email', 'EMAIL_EXISTS');
    }

    // Validar referral code si viene
    let agenteCuit: string | undefined;
    if (data.referralCode) {
      const reseller = await prisma.reseller.findUnique({
        where: { referralCode: data.referralCode, activo: true },
      });
      // Si el código existe en revendedores, asignar su CUIT como agente
      // Si no existe en revendedores, buscar en usuarios (referido por cliente)
      if (reseller) agenteCuit = reseller.cuit;
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const myReferralCode = generateReferralCode(data.cuit);

    // Por defecto: agente es Honorio (Agente PI Mat. N° 1974)
    const DEFAULT_AGENT_CUIT = process.env.DEFAULT_AGENT_CUIT || '20257000000';

    const user = await prisma.user.create({
      data: {
        cuit: data.cuit,
        email: data.email,
        passwordHash,
        razonSocial: data.razonSocial,
        tipoPersona: data.tipoPersona || 'FISICA',
        domicilio: data.domicilio,
        telefono: data.telefono,
        referralCode: myReferralCode,
        referredByCode: data.referralCode,
        agenteCuit: agenteCuit || DEFAULT_AGENT_CUIT,
        terminosAceptados: data.terminosAceptados,
        terminosVersion: '1.0',
      },
      select: {
        id: true, cuit: true, email: true, razonSocial: true, plan: true, referralCode: true,
      },
    });

    const token = signToken(user.id);

    res.status(201).json({
      mensaje: '¡Bienvenido a MARCAS FÁCIL! Tu cuenta fue creada exitosamente.',
      token,
      user,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.activo) {
      throw new AppError(401, 'Email o contraseña incorrectos', 'INVALID_CREDENTIALS');
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new AppError(401, 'Email o contraseña incorrectos', 'INVALID_CREDENTIALS');
    }

    // Actualizar último login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        cuit: user.cuit,
        email: user.email,
        razonSocial: user.razonSocial,
        plan: user.plan,
        referralCode: user.referralCode,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/perfil ──────────────────────────────────────────────────────
router.get('/perfil', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, cuit: true, email: true, razonSocial: true, tipoPersona: true,
        domicilio: true, telefono: true, plan: true, planVencimiento: true,
        referralCode: true, agenteCuit: true, createdAt: true, lastLoginAt: true,
        _count: { select: { marcas: true, dominios: true } },
      },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/auth/perfil ──────────────────────────────────────────────────────
router.put('/perfil', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      razonSocial: z.string().min(2).optional(),
      domicilio: z.string().optional(),
      telefono: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id: true, razonSocial: true, domicilio: true, telefono: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/push-token ─────────────────────────────────────────────────
router.post('/push-token', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token, platform } = z.object({
      token: z.string(),
      platform: z.enum(['ios', 'android', 'web']),
    }).parse(req.body);

    await prisma.pushToken.upsert({
      where: { token },
      create: { userId: req.user!.id, token, platform },
      update: { activo: true },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
}

export default router;

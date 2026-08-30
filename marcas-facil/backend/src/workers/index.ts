/**
 * Workers — MARCAS FÁCIL
 * Tareas programadas para vigilancia automática
 *
 * Cron jobs:
 * - Vigilancia boletín: todos los MIÉRCOLES a las 9:00 AM (hora Argentina, UTC-3)
 * - Notificaciones de vencimientos: todos los días a las 8:00 AM
 * - Limpieza de sesiones expiradas: domingos a las 2:00 AM
 */

import cron from 'node-cron';
import { boletinService } from '../services/boletinService';
import { notificacionService } from '../services/notificacionService';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';

export function iniciarWorkers() {
  logger.info('⚙️ Iniciando workers de fondo...');

  // ── Boletín de Marcas — JUEVES 9:00 AM (hora Argentina = 12:00 UTC) ───────
  // El procesamiento se ejecuta los JUEVES para asegurar disponibilidad del PDF
  // cron: minuto hora dia-mes mes dia-semana
  // dia-semana: 4 = jueves
  cron.schedule('0 12 * * 4', async () => {
    logger.info('📰 [CRON] Iniciando descarga y procesamiento del Boletín de Marcas — JUEVES');
    try {
      const resultado = await boletinService.descargarBoletin();
      logger.info(`📰 [CRON] Boletín descargado: ${JSON.stringify(resultado)}`);

      // Procesar vigilancia automática contra marcas de todos los usuarios
      const vigilancia = await boletinService.procesarVigilancia();
      logger.info(`🔍 [CRON] Vigilancia completada: ${JSON.stringify(vigilancia)}`);
    } catch (error: any) {
      logger.error(`❌ [CRON] Error en descarga de boletín: ${error.message}`);
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  // ── Notificaciones de vencimientos — Todos los días a las 8:00 AM ──────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('🔔 [CRON] Revisando vencimientos para notificaciones...');
    try {
      await revisarYNotificarVencimientos();
    } catch (error: any) {
      logger.error(`❌ [CRON] Error en notificaciones de vencimientos: ${error.message}`);
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  // ── Verificar planes vencidos — Todos los días a medianoche ─────────────────
  cron.schedule('5 0 * * *', async () => {
    logger.info('💳 [CRON] Verificando planes vencidos...');
    try {
      await verificarPlanesVencidos();
    } catch (error: any) {
      logger.error(`❌ [CRON] Error verificando planes: ${error.message}`);
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  logger.info('✅ Workers iniciados correctamente');
  logger.info('   → Boletín: Jueves 9:00 AM (hora Argentina)');
  logger.info('   → Vencimientos: Todos los días 8:00 AM');
  logger.info('   → Planes: Todos los días 00:05 AM');
}

// ── Revisar vencimientos y enviar notificaciones ──────────────────────────────
async function revisarYNotificarVencimientos() {
  const hoy = new Date();
  // Buscar alertas que vencen en los próximos 7 días y no fueron notificadas
  const alertasProximas = await prisma.alerta.findMany({
    where: {
      leida: false,
      notificadaPush: false,
      fechaAlerta: { lte: hoy },
      fechaVencimiento: { gte: hoy },
    },
    include: {
      marca: { select: { denominacion: true } },
    },
    take: 100, // procesar de a 100
  });

  logger.info(`🔔 [VENC] ${alertasProximas.length} alertas pendientes de notificar`);

  for (const alerta of alertasProximas) {
    try {
      const diasRestantes = Math.ceil(
        (alerta.fechaVencimiento!.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
      );

      const cuerpo = alerta.descripcion || alerta.titulo;
      const urgencia = diasRestantes <= 3 ? '🚨 URGENTE — ' : diasRestantes <= 7 ? '⚠️ ' : '';

      await notificacionService.enviarAlertaVencimiento(
        alerta.userId,
        alerta.tipo,
        `${urgencia}${alerta.titulo}`,
        `${cuerpo} (${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'} restantes)`,
        {
          alertaId: alerta.id,
          marcaId: alerta.marcaId || '',
          diasRestantes: String(diasRestantes),
        }
      );

      // Marcar como notificada
      await prisma.alerta.update({
        where: { id: alerta.id },
        data: { notificadaPush: true },
      });
    } catch (err: any) {
      logger.error(`Error notificando alerta ${alerta.id}: ${err.message}`);
    }
  }
}

// ── Verificar planes vencidos y degradar a GRATUITO ──────────────────────────
async function verificarPlanesVencidos() {
  const ahora = new Date();

  const { count } = await prisma.user.updateMany({
    where: {
      plan: { not: 'GRATUITO' },
      planVencimiento: { lt: ahora },
    },
    data: { plan: 'GRATUITO' },
  });

  if (count > 0) {
    logger.info(`💳 ${count} plan(es) vencido(s) degradado(s) a GRATUITO`);
  }
}

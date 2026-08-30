/**
 * Servicio de notificaciones push y email
 */

import axios from 'axios';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';

export const notificacionService = {

  /**
   * Envía push notification de alerta de oposición
   */
  async enviarAlertaOposicion(
    userId: string,
    marcaPropia: string,
    marcaAjena: string,
    acta: string,
    plazoVence: Date
  ) {
    const tokens = await prisma.pushToken.findMany({
      where: { userId, activo: true },
    });

    const plazoStr = plazoVence.toLocaleDateString('es-AR');
    const mensaje = {
      title: `⚠️ Marca confundible detectada`,
      body: `"${marcaAjena}" (Acta ${acta}) es similar a tu marca "${marcaPropia}". Plazo para oponerse: ${plazoStr}.`,
      data: { tipo: 'OPOSICION_DETECTADA', acta, plazoVence: plazoVence.toISOString() },
    };

    await this._enviarPush(tokens.map((t: { token: string }) => t.token), mensaje);
  },

  /**
   * Envía push notification de vencimiento
   */
  async enviarAlertaVencimiento(
    userId: string,
    tipo: string,
    titulo: string,
    cuerpo: string,
    data: Record<string, string> = {}
  ) {
    const tokens = await prisma.pushToken.findMany({
      where: { userId, activo: true },
    });

    await this._enviarPush(tokens.map((t: { token: string }) => t.token), {
      title: titulo,
      body: cuerpo,
      data: { tipo, ...data },
    });
  },

  /**
   * Envío real via Expo Push Notifications API
   */
  async _enviarPush(tokens: string[], mensaje: {
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    if (tokens.length === 0) return;

    const messages = tokens.map(token => ({
      to: token,
      sound: 'default',
      title: mensaje.title,
      body: mensaje.body,
      data: mensaje.data || {},
      priority: 'high',
    }));

    try {
      const response = await axios.post(
        'https://exp.host/--/api/v2/push/send',
        messages,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(process.env.EXPO_ACCESS_TOKEN
              ? { 'Authorization': `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          timeout: 10000,
        }
      );
      logger.info(`📱 Push enviado a ${tokens.length} dispositivo(s)`);
      return response.data;
    } catch (err: any) {
      logger.error(`Error enviando push: ${err.message}`);
    }
  },
};

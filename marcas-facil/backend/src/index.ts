import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
 
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
 
// Routes
import authRoutes from './api/routes/auth';
import marcasRoutes from './api/routes/marcas';
import boletinRoutes from './api/routes/boletin';
import oposicionesRoutes from './api/routes/oposiciones';
import documentosRoutes from './api/routes/documentos';
import alertasRoutes from './api/routes/alertas';
import dominiosRoutes from './api/routes/dominios';
import pagosRoutes from './api/routes/pagos';
import resellersRoutes from './api/routes/resellers';
import factibilidadRoutes from './api/routes/factibilidad';
import inpiRoutes from './api/routes/inpi';
import clasificadorRoutes from './api/routes/clasificador';
 
const app = express();
const PORT = process.env.PORT || 3001;
 
// ── Seguridad y middleware base ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:19006'],
  credentials: true,
}));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
 
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: { error: 'Demasiadas solicitudes. Intente en unos minutos.' },
});
app.use('/api/', limiter);
 
// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});
 
// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/marcas', marcasRoutes);
app.use('/api/boletin', boletinRoutes);
app.use('/api/oposiciones', oposicionesRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/dominios', dominiosRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/resellers', resellersRoutes);
app.use('/api/factibilidad', factibilidadRoutes);
app.use('/api/inpi', inpiRoutes);
app.use('/api/clasificador', clasificadorRoutes);
 
// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);
 
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 MARCA FÁCIL backend corriendo en puerto ${PORT}`);
  logger.info(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
 
export default app;

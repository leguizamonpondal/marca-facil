#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# MARCAS FÁCIL — Setup inicial de producción
# Ejecutar UNA VEZ después del primer deploy en Railway
# ══════════════════════════════════════════════════════════════════════════════
set -e

echo "🚀 Iniciando setup de producción..."

# 1. Generar cliente de Prisma
echo "→ Generando Prisma Client..."
npx prisma generate

# 2. Crear las tablas (primera vez usa migrate deploy)
echo "→ Aplicando migraciones a la base de datos..."
npx prisma migrate deploy

# 3. Verificar conexión
echo "→ Verificando conexión a la base de datos..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$connect()
  .then(() => { console.log('✓ Conexión exitosa'); return prisma.\$disconnect(); })
  .catch(e => { console.error('✗ Error:', e.message); process.exit(1); });
"

echo "✅ Setup completado. El backend está listo para funcionar."

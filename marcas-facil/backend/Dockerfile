# ── MARCAS FÁCIL — Backend (con Playwright/Chromium) ────────────────────────
# Imagen oficial de Playwright: Node 20 + Chromium + todas las deps del sistema
# Evita instalar chromium manualmente y garantiza compatibilidad

FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# poppler-utils trae `pdftotext`, que es como se extrae el texto de los
# boletines del INPI (ver services/boletinParser.ts). La imagen de Playwright
# no lo incluye.
#
# Se usa `pdftotext -layout` y no una librería de Node a propósito: el parser
# de actas está verificado contra su salida —772 de 772 en el boletín 11121— y
# cambiar el extractor invalidaría esa verificación.
RUN apt-get update && \
    apt-get install -y --no-install-recommends poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copiar manifiestos y generar prisma client ANTES de instalar para caché óptimo
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install && \
    npx prisma generate

# Copiar código fuente y compilar TypeScript
COPY tsconfig.json ./
COPY src ./src/

RUN npm run build && \
    npm prune --omit=dev

# Directorio de uploads para PDFs generados
# En Railway: montá un volume en /app/uploads para persistencia
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

# Puerto (Railway usa la variable PORT automáticamente)
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/health', r => r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]

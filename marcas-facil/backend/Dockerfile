FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install && npx prisma generate
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/uploads && chmod 777 /app/uploads
EXPOSE 3001
CMD ["node", "dist/index.js"]

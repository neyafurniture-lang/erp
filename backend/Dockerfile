FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache git openssh-client sshpass \
  && git config --global --add safe.directory /workspace \
  && git config --global --add safe.directory '*'
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY VERSION ./VERSION
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILT_AT
ENV APP_VERSION=$APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILT_AT=$BUILT_AT
ENV NODE_ENV=production
ENV CURSOR_AGENT_CWD=/workspace
EXPOSE 4000
CMD ["node", "src/index.js"]

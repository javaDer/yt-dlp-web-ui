# Node (pnpm) ------------------------------------------------------------------
FROM node:22-slim AS ui
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack prepare pnpm@10.0.0 --activate && corepack enable

WORKDIR /usr/src/yt-dlp-webui/frontend

# Copy only package.json and pnpm-lock.yaml first to leverage Docker cache for pnpm install
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the frontend source code
COPY frontend .

RUN pnpm run build
# -----------------------------------------------------------------------------

# Go --------------------------------------------------------------------------
FROM golang:latest AS build

WORKDIR /usr/src/yt-dlp-webui

# Copy Go modules files first to cache go mod download
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the backend source code
COPY . .
# Copy frontend build artifacts
COPY --from=ui /usr/src/yt-dlp-webui/frontend/dist /usr/src/yt-dlp-webui/frontend/dist

RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -o yt-dlp-webui ./main.go
# -----------------------------------------------------------------------------

# Runtime ---------------------------------------------------------------------
FROM python:3.13.2-alpine3.21

# Install necessary packages and yt-dlp
RUN apk update && \
    apk add --no-cache ffmpeg ca-certificates curl wget gnutls && \
    pip install --no-cache-dir "yt-dlp[default,curl-cffi,mutagen,pycryptodomex,phantomjs,secretstorage]"

VOLUME /downloads /config

WORKDIR /app

COPY --from=build /usr/src/yt-dlp-webui/yt-dlp-webui /app/
COPY --from=build /usr/src/yt-dlp-webui/frontend/dist /app/frontend/dist

# Create /config directory and set permissions for non-root user
RUN mkdir -p /config && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /config && \
    chmod -R 775 /config
USER appuser

EXPOSE 3033
ENTRYPOINT [ "./yt-dlp-webui" , "--out", "/downloads", "--conf", "/config/config.yml", "--db", "/config/", "--session", "/config/" ]

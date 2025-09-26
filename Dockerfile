FROM oven/bun:1.2.21-alpine

WORKDIR /app

RUN apk update && \
    apk add --no-cache \
    curl \
    ffmpeg \
    git \
    python3 \
    py3-pip && \
    python3 -m pip install --break-system-packages git+https://github.com/yt-dlp/yt-dlp.git

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN cd frontend && bun install --frozen-lockfile && bun run generate

RUN cp -r frontend/.output/public/* /app/

RUN mkdir -p /app/cache && chmod 755 /app/cache

VOLUME ["/app/cache"]

ENV CACHE_DIR=/app/cache

EXPOSE 80

CMD ["bun", "run", "start"]
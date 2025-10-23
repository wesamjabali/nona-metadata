FROM oven/bun:1.2.21-alpine

WORKDIR /app

RUN apk update && \
    apk add --no-cache \
    curl \
    ffmpeg \
    git \
    python3 \
    py3-pip \
    dcron && \
    python3 -m pip install --break-system-packages git+https://github.com/yt-dlp/yt-dlp.git

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN cd frontend && bun install --frozen-lockfile && bun run generate

RUN cp -r frontend/.output/public/* /app/

RUN mkdir -p /app/cache && chmod 755 /app/cache

# Create cron job for yt-dlp update (runs every 12 hours)
RUN mkdir -p /etc/crontabs && \
    echo "0 */12 * * * python3 -m pip install --break-system-packages --upgrade git+https://github.com/yt-dlp/yt-dlp.git >> /var/log/yt-dlp-update.log 2>&1" | crontab -

# Create startup script to run both crond and the app
RUN echo '#!/bin/sh' > /app/startup.sh && \
    echo 'crond -f -l 2 &' >> /app/startup.sh && \
    echo 'exec bun run start' >> /app/startup.sh && \
    chmod +x /app/startup.sh

VOLUME ["/app/cache"]

ENV CACHE_DIR=/app/cache

EXPOSE 80

CMD ["/app/startup.sh"]
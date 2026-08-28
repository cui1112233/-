FROM golang:1.23-alpine AS build
RUN apk add --no-cache ca-certificates git
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/qiantie ./cmd/qiantie

FROM alpine:3.20
RUN apk add --no-cache ca-certificates ffmpeg tzdata
WORKDIR /app
COPY --from=build /out/qiantie /usr/local/bin/qiantie
RUN mkdir -p /data/legacy/users /data/shuihuo-objects
ENV QIANTIE_ADDR=0.0.0.0:4000 \
    QIANTIE_LEGACY_DATA_DIR=/data/legacy/users \
    QIANTIE_STORAGE_DRIVER=local \
    QIANTIE_STORAGE_LOCAL_DIR=/data/shuihuo-objects \
    QIANTIE_FFMPEG_PATH=/usr/bin/ffmpeg
EXPOSE 4000
ENTRYPOINT ["qiantie"]

FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/qiantie ./cmd/qiantie
RUN mkdir -p /out/local-executor-artifacts

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/qiantie /qiantie
COPY --from=build --chown=65532:65532 /out/local-executor-artifacts /data/local-executor-artifacts
ENV QIANTIE_LOCAL_EXECUTOR_ARTIFACT_DIR=/data/local-executor-artifacts
VOLUME ["/data"]
EXPOSE 4000
ENTRYPOINT ["/qiantie"]

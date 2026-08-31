FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/qiantie ./cmd/qiantie

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/qiantie /qiantie
EXPOSE 4000
ENTRYPOINT ["/qiantie"]

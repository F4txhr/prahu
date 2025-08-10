# Production Deployment

## Build

```
docker build -t vortexvpn-manager .
```

## Run

```
docker run -d \
  -p 5000:5000 \
  -e SECRET_KEY=change-me \
  -e ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000 \
  -e LOG_LEVEL=INFO \
  -e XRAY_PATH=/app/xray \
  -e DNS_MODE=system \
  -e DOH_PROVIDER=cloudflare \
  -e API_KEY=your-api-key \
  --name vortexvpn vortexvpn-manager
```

- App URL: http://localhost:5000
- Health: GET /health (set header `X-API-Key: your-api-key` if API_KEY set)
- Export: GET /api/export?format=json|csv (set `X-API-Key` if API_KEY set)

## Notes
- Gunicorn threading is used (Socket.IO long-polling). For WebSocket support, consider an ASGI server with proper setup.
- XRAY: place binary at `/app/xray` (container) or ensure network can download it automatically.
- CORS: set `ALLOWED_ORIGINS` to allowed origins.
- DNS DoH: set `DNS_MODE=doh` and `DOH_PROVIDER=cloudflare|google` for unbiased resolution.
- Security: enable `API_KEY` and ensure `SECRET_KEY` is strong. CSRF is enforced for POST requests from UI via meta token.
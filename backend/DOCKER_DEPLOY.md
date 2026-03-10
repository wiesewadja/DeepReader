# DeepPDF Backend Docker Deployment Guide

This guide explains how to deploy the DeepPDF backend using Docker.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available for the container (8GB recommended for production)

## Quick Start

### 1. Configure Environment Variables

Copy the example environment file and configure your API keys:

```bash
cp .env.example .env
```

Edit `.env` and set your LLM API keys:

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
OPENAI_API_KEY=your_openai_api_key
LLM_PROVIDER=deepseek  # or openai, custom

# Optional: Set timezone
TZ=Asia/Shanghai
```

### 2. Deploy

**Option A: Using Deploy Script (Recommended)**

```bash
# Deploy to production
./deploy.sh prod

# Or deploy for development
./deploy.sh dev
```

**Option B: Manual Docker Compose**

```bash
# Production deployment (with resource limits and security hardening)
docker-compose -f docker-compose.prod.yml up -d

# Development deployment
docker-compose up -d
```

### 3. Verify Deployment

```bash
# Check health endpoint
curl http://localhost:5088/health

# View API documentation
open http://localhost:5088/docs

# Check service status
./deploy.sh status
```

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `LLM_PROVIDER` | LLM provider (deepseek/openai/custom) | deepseek |
| `CPU_WORKERS` | Number of CPU workers for indexing | 2 |
| `MAX_CONCURRENT_REQUESTS` | Max concurrent API requests | 10 |
| `LLM_CONCURRENT_LIMIT` | Max concurrent LLM requests | 3 |
| `PDF_INDEX_MAX_PAGES_PER_NODE` | Max pages per document node | 10 |
| `PDF_INDEX_MAX_TOKENS_PER_NODE` | Max tokens per node | 20000 |

### Volume Mounts

The following directories are persisted outside the container:

- `./data` - ChromaDB storage and index metadata
- `./logs` - Application logs

## Management Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart service
docker-compose restart deeppdf-backend

# View logs
docker-compose logs -f deeppdf-backend

# Update to latest version
docker-compose pull
docker-compose up -d

# Rebuild after code changes
docker-compose up -d --build
```

## Production Deployment

### Linux Cloud Server Deployment

For production deployment on Linux cloud servers (阿里云, 腾讯云, AWS, etc.):

```bash
# 1. Clone or upload the project
git clone <your-repo> /opt/deeppdf
cd /opt/deeppdf/backend

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Deploy using the script
./deploy.sh prod

# 4. Check status
./deploy.sh status
```

### Production Configuration Features

The `docker-compose.prod.yml` includes:

1. **Resource Limits**:
   - CPU: 4 cores limit, 2 cores reserved
   - Memory: 8GB limit, 4GB reserved

2. **Security Hardening**:
   - Non-root user execution
   - Read-only root filesystem
   - No new privileges
   - Temporary filesystem for /tmp

3. **Logging**:
   - JSON file driver with rotation
   - Max 100MB per file, 5 files max

4. **Health Checks**:
   - 60s start period for slow initialization
   - 30s interval checks

5. **Network**:
   - Custom subnet (172.20.0.0/16)
   - DNS servers configured (8.8.8.8, 8.8.4.4)

### With Nginx Reverse Proxy

Enable Nginx for production:

```bash
# Deploy with Nginx
docker-compose -f docker-compose.prod.yml --profile with-nginx up -d
```

Features:
- Rate limiting (10 req/s per IP)
- Connection limiting (10 concurrent)
- Gzip compression
- Security headers
- Long timeout for PDF indexing (300s)

### Security Considerations

1. **Non-root user**: Container runs as `app` user (UID 1000)
2. **Resource limits**: Prevents resource exhaustion
3. **Read-only filesystem**: Root filesystem is read-only
4. **Network isolation**: Dedicated Docker network
5. **Health checks**: Automatic restart on failure
6. **Log rotation**: Prevents disk space issues

### Firewall Configuration

For cloud servers, open these ports:

```bash
# If using UFW (Ubuntu)
ufw allow 5088/tcp  # Direct API access
ufw allow 80/tcp    # HTTP (if using Nginx)
ufw allow 443/tcp   # HTTPS (if using SSL)

# If using firewalld (CentOS/RHEL)
firewall-cmd --permanent --add-port=5088/tcp
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

### SSL/TLS with Nginx

To enable HTTPS:

1. Place your SSL certificates in `ssl/` directory:
   ```bash
   mkdir -p ssl
   cp your-cert.pem ssl/deeppdf.crt
   cp your-key.pem ssl/deeppdf.key
   ```

2. Update `nginx.conf` to enable SSL:
   ```nginx
   server {
       listen 443 ssl;
       ssl_certificate /etc/nginx/ssl/deeppdf.crt;
       ssl_certificate_key /etc/nginx/ssl/deeppdf.key;
       # ... rest of configuration
   }
   ```

3. Restart with Nginx profile:
   ```bash
   docker-compose -f docker-compose.prod.yml --profile with-nginx up -d
   ```

## Image Size Optimization

The full image with OCR support is ~10-14GB due to:
- **PaddlePaddle**: ~400MB
- **PyTorch**: ~2GB
- **Sentence Transformers models**: ~500MB-1GB
- **System dependencies**: ~500MB

### Slim Version (Recommended)

For most users who don't need OCR (scanning PDFs), use the **slim version** (~3-4GB smaller):

```bash
# Deploy slim version
./deploy.sh slim

# Or manually
docker-compose -f docker-compose.slim.yml up -d
```

**Differences:**
| Feature | Full | Slim |
|---------|------|------|
| Size | ~10-14GB | ~6-8GB |
| Text PDFs | ✅ | ✅ |
| Scanned PDFs (OCR) | ✅ | ❌ |
| EPUB support | ✅ | ✅ |

### Analyzing Image Size

```bash
# Analyze your built image
./deploy.sh analyze deeppdf-backend:latest

# Or use the script directly
./analyze-image-size.sh deeppdf-backend:latest
```

### Reducing Image Size

If you need to further reduce size:

1. **Use slim version** (saves ~3-4GB)
2. **Clean Docker cache**:
   ```bash
   docker system prune -af
   docker builder prune -f
   ```
3. **Exclude large files in .dockerignore**:
   - Model files (*.bin, *.safetensors)
   - Test data
   - PDF/EPUB files

### Pre-built Images

For faster deployment, consider using pre-built images:

```yaml
# docker-compose.yml
services:
  deeppdf-backend:
    image: ghcr.io/yourusername/deeppdf-backend:slim
    # ... rest of configuration
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs deeppdf-backend

# Verify environment variables
docker-compose config
```

### API connection refused

```bash
# Check if container is running
docker-compose ps

# Test from inside container
docker-compose exec deeppdf-backend curl localhost:5088/health
```

### High memory usage

The embedding model and ChromaDB can use significant memory. Increase Docker memory limit:

```bash
# In Docker Desktop: Settings > Resources > Memory
# Or for Docker Engine, edit daemon.json
```

### Permission denied on data directory

```bash
# Fix permissions
sudo chown -R 1000:1000 ./data ./logs
```

## Building Custom Image

```bash
# Build with specific tag
docker build -t deeppdf-backend:custom .

# Build for different architecture
docker buildx build --platform linux/amd64,linux/arm64 -t deeppdf-backend:latest .
```

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build

# Clean up old images
docker image prune -f
```

#!/bin/bash
# DeepPDF Backend Deployment Script for Linux Cloud Servers
# Usage: ./deploy.sh [prod|dev|stop|logs|update]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE_PROD="docker-compose.prod.yml"
COMPOSE_FILE_DEV="docker-compose.yml"
COMPOSE_FILE_SLIM="docker-compose.slim.yml"
SERVICE_NAME="deeppdf-backend"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
}

# Create necessary directories
setup_directories() {
    log_info "Setting up directories..."
    mkdir -p data logs ssl
    
    # Set proper permissions for non-root user (UID 1000)
    chmod 755 data logs
    
    log_info "Directories created successfully"
}

# Check environment file
check_env() {
    if [ ! -f .env ]; then
        log_warn ".env file not found. Creating from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            log_warn "Please edit .env file and set your API keys before continuing."
            exit 1
        else
            log_error ".env.example not found. Please create .env file manually."
            exit 1
        fi
    fi

    # Check if API keys are set
    if ! grep -q "DEEPSEEK_API_KEY=sk-" .env && ! grep -q "OPENAI_API_KEY=sk-" .env; then
        log_warn "Warning: No LLM API keys detected in .env file"
        log_warn "Please ensure at least one API key is set (DEEPSEEK_API_KEY or OPENAI_API_KEY)"
    fi
}

# Deploy for production
deploy_prod() {
    log_info "Deploying DeepPDF Backend (Production)..."
    
    check_docker
    setup_directories
    check_env
    
    # Pull latest images if using pre-built
    # docker-compose -f $COMPOSE_FILE_PROD pull
    
    # Build and start services
    docker-compose -f $COMPOSE_FILE_PROD up -d --build
    
    # Wait for health check
    log_info "Waiting for service to be healthy..."
    sleep 10
    
    if docker-compose -f $COMPOSE_FILE_PROD ps | grep -q "healthy"; then
        log_info "Deployment successful!"
        log_info "API is available at: http://localhost:5088"
        log_info "API documentation: http://localhost:5088/docs"
    else
        log_warn "Service may still be starting. Check logs with: ./deploy.sh logs"
    fi
}

# Deploy for development
deploy_dev() {
    log_info "Deploying DeepPDF Backend (Development)..."
    
    check_docker
    setup_directories
    check_env
    
    docker-compose -f $COMPOSE_FILE_DEV up -d --build
    
    log_info "Development deployment successful!"
    log_info "API is available at: http://localhost:5088"
}

# Deploy slim version (no OCR)
deploy_slim() {
    log_info "Deploying DeepPDF Backend (Slim - No OCR)..."
    log_info "This version is ~3-4GB smaller but cannot process scanned PDFs"
    
    check_docker
    setup_directories
    check_env
    
    docker-compose -f $COMPOSE_FILE_SLIM up -d --build
    
    log_info "Slim deployment successful!"
    log_info "API is available at: http://localhost:5088"
}

# Stop services
stop_services() {
    log_info "Stopping services..."
    
    if [ -f "$COMPOSE_FILE_PROD" ]; then
        docker-compose -f $COMPOSE_FILE_PROD down
    fi
    
    if [ -f "$COMPOSE_FILE_DEV" ]; then
        docker-compose -f $COMPOSE_FILE_DEV down
    fi
    
    log_info "Services stopped"
}

# View logs
view_logs() {
    log_info "Viewing logs (press Ctrl+C to exit)..."
    
    if [ -f "$COMPOSE_FILE_PROD" ]; then
        docker-compose -f $COMPOSE_FILE_PROD logs -f $SERVICE_NAME
    else
        docker-compose -f $COMPOSE_FILE_DEV logs -f $SERVICE_NAME
    fi
}

# Update deployment
update() {
    log_info "Updating DeepPDF Backend..."
    
    check_docker
    
    # Pull latest code (if using git)
    if [ -d .git ]; then
        git pull
    fi
    
    # Rebuild and restart
    docker-compose -f $COMPOSE_FILE_PROD up -d --build
    
    # Clean up old images
    docker image prune -f
    
    log_info "Update completed"
}

# Show status
status() {
    log_info "Service Status:"
    
    if [ -f "$COMPOSE_FILE_PROD" ]; then
        docker-compose -f $COMPOSE_FILE_PROD ps
    fi
    
    echo ""
    log_info "Resource Usage:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
}

# Backup data
backup() {
    BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    log_info "Creating backup at $BACKUP_DIR..."
    
    # Backup data directory
    if [ -d data ]; then
        tar -czf "$BACKUP_DIR/data.tar.gz" data/
    fi
    
    # Backup environment file
    if [ -f .env ]; then
        cp .env "$BACKUP_DIR/"
    fi
    
    log_info "Backup completed: $BACKUP_DIR"
}

# Main command handler
case "${1:-prod}" in
    prod|production)
        deploy_prod
        ;;
    slim)
        deploy_slim
        ;;
    dev|development)
        deploy_dev
        ;;
    stop|down)
        stop_services
        ;;
    logs)
        view_logs
        ;;
    update|upgrade)
        update
        ;;
    status)
        status
        ;;
    backup)
        backup
        ;;
    analyze)
        if [ -z "$2" ]; then
            log_error "Please specify an image name: ./deploy.sh analyze <image-name>"
            exit 1
        fi
        ./analyze-image-size.sh "$2"
        ;;
    *)
        echo "Usage: $0 [prod|slim|dev|stop|logs|update|status|backup|analyze]"
        echo ""
        echo "Commands:"
        echo "  prod       Deploy for production with OCR (full features, ~10GB)"
        echo "  slim       Deploy slim version without OCR (~3-4GB smaller)"
        echo "  dev        Deploy for development"
        echo "  stop       Stop all services"
        echo "  logs       View service logs"
        echo "  update     Update to latest version"
        echo "  status     Show service status and resource usage"
        echo "  backup     Backup data directory"
        echo "  analyze    Analyze Docker image size"
        echo ""
        echo "Examples:"
        echo "  $0 prod              # Full production deployment"
        echo "  $0 slim              # Slim deployment (recommended for most users)"
        echo "  $0 analyze deeppdf-backend:latest"
        echo ""
        exit 1
        ;;
esac

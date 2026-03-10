#!/bin/bash
# Analyze Docker image size and provide optimization suggestions

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Docker Image Size Analyzer${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if image exists
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: $0 <image-name:tag>${NC}"
    echo ""
    echo "Example:"
    echo "  $0 deeppdf-backend:test"
    echo ""
    echo "Or analyze current build:"
    echo "  docker images | grep deeppdf"
    exit 1
fi

IMAGE_NAME=$1

echo -e "${GREEN}Analyzing image: $IMAGE_NAME${NC}"
echo ""

# Check if image exists
if ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
    echo -e "${RED}Error: Image '$IMAGE_NAME' not found${NC}"
    echo ""
    echo "Available images:"
    docker images | grep deeppdf || echo "No deeppdf images found"
    exit 1
fi

# Get image size
IMAGE_SIZE=$(docker images --format "{{.Size}}" "$IMAGE_NAME")
IMAGE_SIZE_BYTES=$(docker inspect -f "{{.Size}}" "$IMAGE_NAME")
IMAGE_SIZE_MB=$((IMAGE_SIZE_BYTES / 1024 / 1024))

echo -e "${GREEN}Image Size: $IMAGE_SIZE ($IMAGE_SIZE_MB MB)${NC}"
echo ""

# Analyze layers
echo -e "${BLUE}Layer Analysis:${NC}"
echo "----------------------------------------"
docker history --format "table {{.Size}}\t{{.CreatedBy}}" "$IMAGE_NAME" | head -20

echo ""
echo -e "${BLUE}Detailed Layer Sizes:${NC}"
echo "----------------------------------------"

# Get layer sizes
LAYERS=$(docker inspect -f "{{json .RootFS.Layers}}" "$IMAGE_NAME" | tr -d '[]"' | tr ',' '\n')

TOTAL_SIZE=0
for layer in $LAYERS; do
    if [ -n "$layer" ]; then
        LAYER_SIZE=$(docker inspect -f "{{.Size}}" "$layer" 2>/dev/null || echo "0")
        if [ "$LAYER_SIZE" -gt 0 ]; then
            LAYER_SIZE_MB=$((LAYER_SIZE / 1024 / 1024))
            TOTAL_SIZE=$((TOTAL_SIZE + LAYER_SIZE))
            echo "  Layer: ${LAYER_SIZE_MB}MB"
        fi
    fi
done

echo ""
echo -e "${GREEN}Total Layer Size: $((TOTAL_SIZE / 1024 / 1024)) MB${NC}"
echo ""

# Check for large files in image
echo -e "${BLUE}Large Files (>50MB) in Image:${NC}"
echo "----------------------------------------"
docker run --rm --entrypoint "" "$IMAGE_NAME" sh -c '
    find /app -type f -size +50M 2>/dev/null | head -20 || echo "No large files found in /app"
    find /usr -type f -size +50M 2>/dev/null | head -20 || echo "No large files found in /usr"
' 2>/dev/null || echo -e "${YELLOW}Could not run container to check files${NC}"

echo ""

# Check Python packages size
echo -e "${BLUE}Large Python Packages:${NC}"
echo "----------------------------------------"
docker run --rm --entrypoint "" "$IMAGE_NAME" sh -c '
    pip list --format=freeze 2>/dev/null | wc -l | xargs echo "Total packages:"
    du -sh /app/.venv/lib/python*/site-packages/* 2>/dev/null | sort -hr | head -20
' 2>/dev/null || echo -e "${YELLOW}Could not analyze Python packages${NC}"

echo ""

# Provide recommendations
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Optimization Recommendations${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$IMAGE_SIZE_MB" -gt 10000 ]; then
    echo -e "${RED}⚠️  Image is very large (>10GB)!${NC}"
    echo ""
    echo "Major size contributors likely are:"
    echo "  1. PaddlePaddle (~400MB)"
    echo "  2. PyTorch (~2GB)"
    echo "  3. Sentence Transformers models (~500MB-1GB)"
    echo "  4. Build cache not cleaned"
    echo ""
    echo -e "${GREEN}Solutions:${NC}"
    echo "  • Use Dockerfile.slim (no OCR): ~3-4GB smaller"
    echo "  • Ensure .dockerignore excludes data/, models/"
    echo "  • Use multi-stage build properly"
    echo "  • Run: docker system prune -f to clean cache"
    echo ""
elif [ "$IMAGE_SIZE_MB" -gt 5000 ]; then
    echo -e "${YELLOW}⚠️  Image is large (>5GB)${NC}"
    echo ""
    echo "Consider:"
    echo "  • Using Dockerfile.slim for ~3GB reduction"
    echo "  • Cleaning build cache"
    echo ""
else
    echo -e "${GREEN}✓ Image size is reasonable${NC}"
fi

echo ""
echo -e "${GREEN}Build Commands:${NC}"
echo "----------------------------------------"
echo "Full version (with OCR):"
echo "  docker build -t deeppdf-backend:full ."
echo ""
echo "Slim version (no OCR, ~3-4GB smaller):"
echo "  docker build -f Dockerfile.slim -t deeppdf-backend:slim ."
echo ""
echo "Using docker-compose:"
echo "  docker-compose -f docker-compose.slim.yml up -d"
echo ""

# Show comparison if both images exist
echo -e "${BLUE}Image Comparison:${NC}"
echo "----------------------------------------"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep deeppdf || echo "No images found"

echo ""
echo -e "${GREEN}Done!${NC}"

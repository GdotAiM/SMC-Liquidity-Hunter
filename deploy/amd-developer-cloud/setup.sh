#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# SMC Pulse Predict — AMD Developer Cloud VM Setup
# ──────────────────────────────────────────────────────────────────────────────
# Run once on a fresh AMD Developer Cloud Ubuntu 22.04 VM with MI300X GPUs.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# What this does:
#   1. Installs Docker + NVIDIA/ROCm container toolkit (if not present)
#   2. Verifies ROCm GPU visibility
#   3. Pulls the vLLM ROCm image
#   4. Prints next steps
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

banner() {
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║${NC}  SMC Pulse Predict — AMD Developer Cloud Setup          ${GREEN}║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo
}

fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

# ── Prerequisites check ───────────────────────────────────────────────────────

banner

if [[ "${EUID}" -eq 0 ]]; then
  warn "Running as root.  If you prefer a non-root user, re-run without sudo."
fi

# ── Step 1: Docker ────────────────────────────────────────────────────────────

echo "── Step 1/5: Docker ───────────────────────────────────────────────"

if command -v docker &>/dev/null; then
  ok "Docker $(docker --version) already installed"
else
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  ok "Docker installed"
fi

# Allow the current user to run docker without sudo
if ! docker ps &>/dev/null 2>&1; then
  echo "Adding ${USER} to docker group..."
  sudo usermod -aG docker "${USER}"
  warn "You may need to log out and back in for group changes to take effect."
  warn "Or run:  newgrp docker"
fi

# ── Step 2: Docker Compose ────────────────────────────────────────────────────

echo
echo "── Step 2/5: Docker Compose ───────────────────────────────────────"

if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short) available"
elif command -v docker-compose &>/dev/null; then
  ok "docker-compose $(docker-compose --version | grep -oP '\d+\.\d+\.\d+') available (legacy)"
else
  warn "docker compose plugin not found — installing..."
  sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin
  ok "Docker Compose plugin installed"
fi

# ── Step 3: ROCm verification ─────────────────────────────────────────────────

echo
echo "── Step 3/5: ROCm GPU verification ────────────────────────────────"

if command -v rocminfo &>/dev/null; then
  GPU_COUNT=$(rocminfo 2>/dev/null | grep -c "Marketing Name" || echo "0")
  ok "rocminfo found — ${GPU_COUNT} GPU(s) detected"
  rocminfo 2>/dev/null | grep "Marketing Name" | head -3 || true
elif command -v rocm-smi &>/dev/null; then
  rocm-smi --showproductname 2>/dev/null | head -10 || true
  ok "rocm-smi found"
else
  warn "ROCm tools not found in PATH — checking /opt/rocm..."
  if [[ -d /opt/rocm ]]; then
    export PATH="/opt/rocm/bin:${PATH}"
    ok "ROCm found at /opt/rocm"
    rocminfo 2>/dev/null | grep "Marketing Name" | head -3 || true
  else
    fail "ROCm not found.  Is this an AMD MI300X instance?  Check: ls /opt/rocm"
  fi
fi

# Verify /dev/kfd and /dev/dri exist (needed for container passthrough)
for dev in /dev/kfd /dev/dri/renderD*; do
  if [[ -e "${dev}" ]]; then
    ok "Device ${dev} present"
  else
    warn "Device ${dev} not found — container GPU access may fail"
  fi
done

# ── Step 4: Pull vLLM ROCm image ──────────────────────────────────────────────

echo
echo "── Step 4/5: Pull vLLM ROCm image ─────────────────────────────────"

docker pull rocm/vllm:latest && ok "rocm/vllm:latest pulled"

# ── Step 5: Done ──────────────────────────────────────────────────────────────

echo
echo "── Step 5/5: Done ─────────────────────────────────────────────────"

echo
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  Setup complete!  Next steps:                                  ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                                                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  cd deploy/amd-developer-cloud                                 ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  cp .env.amd .env             # review & edit                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  docker compose up -d         # start the stack                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  # Verify everything is healthy:                               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  curl http://localhost:3001/api/healthz   # API server          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  curl http://localhost:8000/v1/models # vLLM                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  curl http://localhost:3002/mcp       # MCP endpoint            ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  # Run a test inference:                                        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  curl http://localhost:8000/v1/chat/completions \\              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    -H "Content-Type: application/json" \\                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    -d '{"model":"${LLM_MODEL:-google/gemma-4-26B-A4B-it}","messages":[{"role":"user","content":"Say hello from AMD MI300X"}]}' ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                                ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo
echo "Model download happens on first vLLM launch — allow 5-10 minutes."

# NodeJS (latest) base image
FROM mcr.microsoft.com/devcontainers/javascript-node

# Midnight binaries and tools download URLs
# Source: https://docs.midnight.network/relnotes/overview
ARG COMPACT_TOOLCHAIN_VERSION=0.29.0
ARG COMPACT_VSCODE_VERSION=0.2.13
ARG COMPACT_VSCODE_URL="https://raw.githubusercontent.com/midnight-ntwrk/releases/gh-pages/artifacts/vscode-extension/compact-${COMPACT_VSCODE_VERSION}/compact-${COMPACT_VSCODE_VERSION}.vsix"

# Install required dependencies and clean up
RUN apt-get update \
    && apt-get install -y curl unzip wget \
    && rm -rf /var/lib/apt/lists/*

# Download the Compact VS Code extension (used by devcontainer.json)
RUN wget -O /tmp/compact.vsix "${COMPACT_VSCODE_URL}"

# Install Compact developer tools CLI
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/download/compact-v0.2.0/compact-installer.sh | sh

# Add Compact CLI to the PATH
ENV PATH="/root/.compact/bin:$PATH"

# Install turbo for monorepo management
RUN npm install --location=global turbo

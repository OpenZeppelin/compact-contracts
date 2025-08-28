# NodeJS (latest) base image
FROM mcr.microsoft.com/devcontainers/javascript-node

# Midnight binaries and tools download URLs
# Source: https://docs.midnight.network/relnotes/overview
ARG COMPACTC_URL="https://d3fazakqrumx6p.cloudfront.net/artifacts/compiler/compactc_0.24.0/compactc_v0.24.0_x86_64-unknown-linux-musl.zip"
ARG COMPACT_VSCODE_URL="https://raw.githubusercontent.com/midnight-ntwrk/releases/gh-pages/artifacts/vscode-extension/compact-0.2.13/compact-0.2.13.vsix"

# Download the compact VS Code extension (later installed via devcontainer.json)
RUN wget -O /tmp/compact.vsix $COMPACT_VSCODE_URL

# Install the Compact compiler (compactc)
RUN wget -O /tmp/compactc.zip $COMPACTC_URL \
    && unzip /tmp/compactc.zip -d /tmp/compactc \
    && sudo mv /tmp/compactc/* /usr/local/bin/

# Install turbo for monorepo management
RUN npm install turbo --global

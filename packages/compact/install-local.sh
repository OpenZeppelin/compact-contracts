#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="${1:?Error: path to compact repo is required as the first argument}"

if [[ ! -d "$REPO_PATH" ]]; then
  echo "Error: '$REPO_PATH' is not a directory" >&2
  exit 1
fi

GIT_TAG=$(git -C "$REPO_PATH" describe --tags --exact-match 2>/dev/null | sed 's/^v//')

if [[ -z "$GIT_TAG" ]]; then
  echo "Error: no git tag found at HEAD in '$REPO_PATH'" >&2
  exit 1
fi

detect_platform() {
  local arch os
  arch=$(uname -m)
  os=$(uname -s)

  case "$arch" in
    arm64|aarch64) arch="aarch64" ;;
    x86_64)        arch="x86_64" ;;
    *) echo "Error: unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) echo "Error: unsupported OS: $os" >&2; exit 1 ;;
  esac

  echo "${arch}-${os}"
}

PLATFORM="${2:-$(detect_platform)}"

case "$PLATFORM" in
  aarch64-linux|aarch64-darwin|x86_64-linux|x86_64-darwin) ;;
  *) echo "Error: unsupported platform '$PLATFORM'. Must be one of: aarch64-linux, aarch64-darwin, x86_64-linux, x86_64-darwin" >&2; exit 1 ;;
esac

# compact-compiler tool requires the destination path version to match the reported compact version from the binary
REPORTED_COMPACT_VERSION=$("$REPO_PATH/result/bin/compactc" --version | tail -n1)
DEST="$HOME/.compact/versions/$REPORTED_COMPACT_VERSION/$PLATFORM"
mkdir -p "$DEST"
cp -r "$REPO_PATH/result/bin/." "$DEST/"
echo "Installed $GIT_TAG ($PLATFORM) to $DEST"
compact update $REPORTED_COMPACT_VERSION
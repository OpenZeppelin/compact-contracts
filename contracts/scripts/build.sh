#!/usr/bin/env bash
# Two-pass dist build. crypto/ and multisig/ need --feature-zkir-v3 and
# ConfidentialFungibleToken cannot generate keys on v3, so one builder pass
# cannot cover both. dist ships .compact sources only; the compiles are a
# validity check. The builder's exclude list also drives its source copy,
# hence the manual copy for the v3 directories.
set -euo pipefail

V3_DIRS=(crypto multisig)

builder_excludes=(--exclude '*/archive/*' --exclude 'Mock*' --exclude '*.mock.compact')
for dir in "${V3_DIRS[@]}"; do
  builder_excludes+=(--exclude "*/$dir/*")
done

compact-builder --hierarchical --out dist --clean-dist "${builder_excludes[@]}" \
  --copy package.json --copy ../README.md

check_out="$(mktemp -d)"
trap 'rm -rf "$check_out"' EXIT

for dir in "${V3_DIRS[@]}"; do
  compact-compiler --dir "$dir" --hierarchical --out "$check_out" --feature-zkir-v3 \
    --exclude 'Mock*' --exclude '*.mock.compact'
  find "src/$dir" -type f -name '*.compact' ! -name 'Mock*' ! -name '*.mock.compact' \
    | while read -r file; do
        rel="${file#src/}"
        mkdir -p "dist/$(dirname "$rel")"
        cp "$file" "dist/$rel"
      done
done

find dist -type d -empty -delete

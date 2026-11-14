#!/bin/sh
# Builds the Linux release packages from a `git archive` of the release commit. scripts/release.mjs
# runs this inside WSL; any Linux x64 host with a C/C++ toolchain, curl, and xz works.
# Usage: release-linux.sh <commit.tar> <output-dir>
set -eu
archive=$1
out=$2
cache=${XDG_CACHE_HOME:-$HOME/.cache}/sfxchat-release
tools=$cache/tools

# Build tools are pinned and checksum-verified, then kept in the cache for later releases.
# Node is the same official archive scripts/build-agent.mjs redistributes; CMake's checksum is
# from Kitware's cmake-3.31.6-SHA-256.txt.
fetch() { # url sha256 directory
  if [ ! -d "$3" ]; then
    rm -rf "$3.part" && mkdir -p "$3.part"
    curl -fsSL "$1" -o "$3.part/archive"
    echo "$2  $3.part/archive" | sha256sum -c --quiet -
    tar -xf "$3.part/archive" -C "$3.part" --strip-components=1
    rm "$3.part/archive" && mv "$3.part" "$3"
  fi
}
fetch https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz \
  fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6 "$tools/node-v24.21.0"
fetch https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-linux-x86_64.tar.gz \
  5a1133ff103c71eb5120e2cc3de922733e7d8a26a98ae716397e8676adb367bf "$tools/cmake-3.31.6"
export PATH="$tools/node-v24.21.0/bin:$PATH"
export CMAKE="$tools/cmake-3.31.6/bin/cmake"

# Build on the Linux filesystem: npm and electron-builder are slow and lose file modes on /mnt.
src=$cache/src
rm -rf "$src" && mkdir -p "$src"
trap 'rm -rf "$src"' EXIT
tar -xf "$archive" -C "$src"
cd "$src"
npm ci --no-audit --no-fund
npm run package
cp release/*.AppImage release/*.deb "$out/"

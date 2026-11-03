#!/usr/bin/env bash
# Puts FFmpeg on the PATH of the next steps, for the video tests: the static build of BtbN/FFmpeg-Builds
# (linked from ffmpeg.org), from GitHub Releases. Not apt: package downloads from the runners' Ubuntu
# mirror sometimes crawl at tens of KB/s on the Ubuntu 26.04 runners (actions/runner-images#14716).
set -euo pipefail

release=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest
archive=ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz
target="${RUNNER_TEMP:-/tmp}/ffmpeg"
attempts=3

download() { # download <file>
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors --max-time 300 \
    --output "$1" "$release/$1"
}

mkdir -p "$target"
cd "$target"
for attempt in $(seq "$attempts"); do
  # The release is rebuilt every day: files read while it is being replaced may not match.
  if download checksums.sha256 && download "$archive" \
    && sha256sum --check --ignore-missing --quiet checksums.sha256; then
    tar --extract --xz --file "$archive" --strip-components=1
    rm "$archive" checksums.sha256
    echo "$target/bin" >>"$GITHUB_PATH"
    "$target/bin/ffmpeg" -hide_banner -version | sed -n 1p
    exit 0
  fi
  echo "::warning::Downloading FFmpeg failed (attempt $attempt of $attempts)"
  sleep 10
done
echo "::error::Could not download FFmpeg after $attempts attempts"
exit 1
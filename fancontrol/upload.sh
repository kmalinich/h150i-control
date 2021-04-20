#!/usr/bin/env bash

BOARD="arduino:avr:uno"
OUTPUT_DIR="${PWD}/build"

PORT_DEF="$(serialport-list --format json | jq -r '.[] | select(.manufacturer != null) | select(.manufacturer | contains("Arduino")) | .path')"
PORT="${1-$PORT_DEF}"

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

set -e

arduino-cli compile --fqbn "${BOARD}" --output-dir "${OUTPUT_DIR}" ./
echo

arduino-cli upload --fqbn "${BOARD}" --port "${PORT}" ./

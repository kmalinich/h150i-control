#!/usr/bin/env bash

BOARD="arduino:avr:uno"
OUTPUT_DIR="${PWD}/build"

PORT_DEF="$(serialport-list --format json | jq -r '.[] | select(.manufacturer != null) | select(.manufacturer | contains("Arduino")) | .path')"
PORT="${1-$PORT_DEF}"

# Install libraries if missing
if ! arduino-cli lib list --format json | jq -r '.[].library.name' | grep -Eq 'FanController'; then
	if ! arduino-cli lib install 'FanController'; then
		echo "Failed to install missing library 'FanController', cannot continue"
		exit 1
	fi
fi

if ! arduino-cli lib list --format json | jq -r '.[].library.name' | grep -Eq 'PID_v2'; then
	if ! arduino-cli lib install 'PID_v2'; then
		echo "Failed to install missing library 'PID_v2', cannot continue"
		exit 2
	fi
fi


rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

set -e

arduino-cli compile --fqbn "${BOARD}" --output-dir "${OUTPUT_DIR}" ./
echo

arduino-cli upload --fqbn "${BOARD}" --port "${PORT}" ./

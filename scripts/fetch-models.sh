#!/bin/sh
# Build-time download of the two segmentation weights into the Python function bundle. sha256 is verified by workers/composite/seg.py at start-up.
set -e
D=workers/composite/models; mkdir -p "$D"
for m in isnet-general-use u2netp; do [ -f "$D/$m.onnx" ] || curl -fsSL --retry 3 -o "$D/$m.onnx" "https://github.com/danielgatis/rembg/releases/download/v0.0.0/$m.onnx"; done
sha256sum "$D"/*.onnx

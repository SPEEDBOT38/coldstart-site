#!/bin/sh
# Build-time download of the two segmentation weights into the Python function bundle. sha256 is verified by workers/composite/seg.py at start-up.
set -e
D=workers/composite/models; mkdir -p "$D"
for m in isnet-general-use u2netp; do [ -f "$D/$m.onnx" ] || curl -fsSL --retry 3 -o "$D/$m.onnx" "https://github.com/danielgatis/rembg/releases/download/v0.0.0/$m.onnx"; done
printf "%s  %s\n" 60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a "$D/isnet-general-use.onnx" 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8 "$D/u2netp.onnx" | sha256sum -c -

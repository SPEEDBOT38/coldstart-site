"""Matte inference straight on onnxruntime (no rembg, so no scipy/opencv/numba: the bundle is ~140 MB smaller and fits a Vercel Python function).
Pre/post-processing follows rembg's published sessions for these two models (MIT). Weights: danielgatis/rembg release assets, sha256-pinned in service.py."""
import hashlib, os, urllib.request
import numpy as np
from PIL import Image
import onnxruntime as ort

URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/%s.onnx'
CFG = {'u2netp': ((0.485, 0.456, 0.406), (0.229, 0.224, 0.225), 320), 'isnet-general-use': ((0.485, 0.456, 0.406), (1.0, 1.0, 1.0), 1024)}

def weights_path(name, pinned=None):
    home = os.environ.get('U2NET_HOME', os.path.expanduser('~/.u2net')); f = os.path.join(home, name + '.onnx')
    if not os.path.exists(f):
        os.makedirs(home, exist_ok=True); tmp = f + '.part'; urllib.request.urlretrieve(URL % name, tmp); os.replace(tmp, f)
    if pinned and hashlib.sha256(open(f, 'rb').read()).hexdigest() != pinned: raise SystemExit('model weights checksum mismatch (' + name + '): refusing to start')
    return f

class Matter:
    def __init__(self, name, pinned=None):
        self.name = name; self.mean, self.std, self.size = CFG[name]
        o = ort.SessionOptions(); o.intra_op_num_threads = int(os.environ.get('ORT_THREADS', '0')) or 0; o.enable_cpu_mem_arena = False; o.enable_mem_pattern = False   # lower peak memory (needed for a 2 GB function)
        self.sess = ort.InferenceSession(weights_path(name, pinned), sess_options=o, providers=['CPUExecutionProvider']); self.inp = self.sess.get_inputs()[0].name
    def alpha(self, img):
        im = img.convert('RGB').resize((self.size, self.size), Image.LANCZOS); a = np.array(im, dtype=np.float32); a = a / max(float(a.max()), 1e-6)
        x = np.zeros((1, 3, self.size, self.size), dtype=np.float32)
        for c in range(3): x[0, c] = (a[:, :, c] - self.mean[c]) / self.std[c]
        p = self.sess.run(None, {self.inp: x})[0][:, 0, :, :]; mi, ma = float(p.min()), float(p.max()); p = (p - mi) / max(ma - mi, 1e-6)
        return Image.fromarray((np.squeeze(p) * 255).astype('uint8'), 'L').resize(img.size, Image.LANCZOS)

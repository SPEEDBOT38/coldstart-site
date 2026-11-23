"""Vercel Python Function: the pixel-locked compositor (workers/composite) served at /api/compose/composite and /api/compose/matte.
Weights are downloaded at build time into workers/composite/models (see vercel.json buildCommand); if absent they are fetched into /tmp and sha256-checked."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'composite'))
bundled = os.path.join(ROOT, 'workers', 'composite', 'models')
os.environ.setdefault('U2NET_HOME', bundled if os.path.isdir(bundled) and os.listdir(bundled) else '/tmp/models')
os.environ.setdefault('ORT_THREADS', '2')
from service import H   # noqa: E402


class handler(H):   # Vercel detects a top-level `handler` class (an import alias is not detected)
    pass

"""Compare commercially usable rembg segmentation models on the SYNTHETIC stress cases (exact ground truth) - a model-selection aid, not a quality claim on real photos.
Usage: python3 compare_models.py out.json [model ...]"""
import sys, os, json, time, resource
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from rembg import remove, new_session
from stress_eval import build, CASES
from metrics import metrics
models = sys.argv[2:] or ['u2netp', 'isnet-general-use', 'birefnet-general-lite']
out = {'note': 'SYNTHETIC fixtures with exact masks; not genuine product photographs.', 'models': {}}
for m in models:
    sess = new_session(m); rows = {}
    for n in CASES:
        img, gt = build(n); t = time.time(); a = remove(img, session=sess).getchannel('A'); rows[n] = {**metrics(a, gt), 'ms': round((time.time() - t) * 1000)}
    out['models'][m] = {'cases': rows, 'mean_iou': round(sum(r['iou'] for r in rows.values()) / len(rows), 3), 'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)}
    print(m, out['models'][m]['mean_iou'], {k: v['iou'] for k, v in rows.items()}, flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1)

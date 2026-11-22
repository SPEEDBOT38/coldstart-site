"""Segmentation metrics shared by the synthetic stress eval and the real-photo harness."""
import numpy as np
from PIL import Image, ImageFilter
def metrics(pred, gt):
    p = np.array(pred) > 127; g = np.array(gt) > 127; inter = (p & g).sum(); union = (p | g).sum()
    def edge(m): from PIL import ImageFilter as F; im = Image.fromarray((m * 255).astype('uint8')); er = np.array(im.filter(F.MinFilter(3))) > 127; return m & ~er
    ep, eg = edge(p), edge(g); k = Image.fromarray((eg * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5)); k2 = Image.fromarray((ep * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))
    prec = (ep & (np.array(k) > 127)).sum() / max(1, ep.sum()); rec = (eg & (np.array(k2) > 127)).sum() / max(1, eg.sum())
    return {'iou': round(float(inter / max(1, union)), 3), 'boundary_f1_2px': round(float(2 * prec * rec / max(1e-9, prec + rec)), 3), 'predicted_area_ratio': round(float(p.sum() / max(1, g.sum())), 3)}

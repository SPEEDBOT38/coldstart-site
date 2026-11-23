"""Regression tests for Product Lock mask refinement. Run: python3 workers/composite/test_maskfix.py"""
import os, sys, unittest
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from maskfix import refine, base_extent
FIX = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'fixtures')


def pouch(w=400, h=600, label_hole=True, haze=True, window=None):
    im = Image.new('L', (w, h), 0); d = ImageDraw.Draw(im)
    if haze: d.ellipse([40, h - 90, w - 40, h - 30], fill=40)                    # source photo shadow, low alpha (behind the pouch)
    d.rounded_rectangle([60, 60, w - 60, h - 80], 20, fill=255)
    if label_hole: d.rectangle([100, 160, w - 100, h - 160], fill=0)           # cream label read as background
    if window: d.rectangle(window, fill=0)
    return im


class MaskFix(unittest.TestCase):
    def test_real_mellooo_matte_holes_are_filled_and_flagged(self):
        raw = Image.open(os.path.join(FIX, 'mellooo_pouch_auto_matte.png'))
        before = (np.array(raw) >= 128).sum()
        out, st = refine(raw)
        after = (np.array(out) >= 128).sum()
        self.assertGreater(st['enclosed_transparent_fraction'], 0.3)               # the observed failure: ~half the pouch missing
        self.assertGreater(after, before * 1.4)   # measured 1.48x on the real pouch
        self.assertEqual(st['status'], 'review')                                    # a big fill is never silent
        self.assertTrue(any('confirm' in r for r in st['review_reasons']))

    def test_label_hole_filled(self):
        out, st = refine(pouch(haze=False))
        a = np.array(out); self.assertEqual(a[300, 200], 255); self.assertEqual(st['status'], 'review')

    def test_marked_window_preserved(self):
        win = (150, 200, 250, 300)
        out, st = refine(pouch(label_hole=False, haze=False, window=win), keep_boxes=[win])
        a = np.array(out); self.assertEqual(a[250, 200], 0); self.assertGreater(st['kept_transparent_px'], 0)

    def test_unfilled_holes_warn(self):
        out, st = refine(pouch(haze=False), fill_holes=False)
        self.assertEqual(np.array(out)[300, 200], 0); self.assertEqual(st['status'], 'review')

    def test_shadow_haze_removed_and_bbox_tight(self):
        out, st = refine(pouch(label_hole=False))
        self.assertGreater(st['haze_removed_px'], 0)
        self.assertLessEqual(st['bbox'][3], 600 - 80 + 1)                          # bottom of the pouch, not of the haze
        self.assertEqual(st['status'], 'ok')

    def test_clean_mask_untouched(self):
        m = pouch(label_hole=False, haze=False); out, st = refine(m)
        self.assertTrue((np.array(out) == np.array(m)).all()); self.assertEqual(st['status'], 'ok')

    def test_bottle_and_box(self):
        for shape in ('bottle', 'box'):
            im = Image.new('L', (300, 500), 0); d = ImageDraw.Draw(im)
            if shape == 'bottle': d.rectangle([120, 40, 180, 140], fill=255); d.rounded_rectangle([80, 130, 220, 460], 30, fill=255); d.rectangle([90, 220, 210, 330], fill=0)
            else: d.rectangle([50, 100, 250, 420], fill=255); d.ellipse([110, 180, 190, 260], fill=0)
            out, st = refine(im); self.assertEqual(st['enclosed_transparent_px'] > 0, True); self.assertEqual(np.array(out)[250, 150], 255)

    def test_base_extent(self):
        a = np.array(pouch(label_hole=False, haze=False)); x0, x1, by = base_extent(a)
        self.assertEqual(by, 600 - 80); self.assertLess(x0, x1)


if __name__ == '__main__':
    unittest.main(verbosity=2)

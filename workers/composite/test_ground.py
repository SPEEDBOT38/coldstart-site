"""Grounding regression tests (no models needed). Run: python3 workers/composite/test_ground.py"""
import os, sys, unittest
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
import ground

def pouch(w=300, h=480):
    im = Image.new('L', (w, h), 0); d = ImageDraw.Draw(im)
    d.rounded_rectangle([10, 10, w - 10, h - 10], 30, fill=255)          # rounded bottom corners = curved base
    return np.array(im)

class Ground(unittest.TestCase):
    def setUp(self): self.a = pouch()
    def render(self, color, **o):
        bg = np.full((1350, 1080, 3), color, np.uint8); return ground.render(bg, self.a, 400, 300, o)
    def test_visible_on_every_surface(self):
        for name, col in [('light paper', (236, 226, 210)), ('wood', (110, 72, 48)), ('dark stone', (38, 36, 36)), ('terracotta plinth', (176, 104, 80))]:
            _, r = self.render(col)
            self.assertTrue(r['contact_visible'], name + ': ' + str(r['contact_darkening'])); self.assertFalse(r['too_dark'], name)
    def test_dark_surface_gets_stronger_relative_shadow(self):
        _, light = self.render((236, 226, 210)); _, dark = self.render((38, 36, 36))
        self.assertGreater(dark['contact_darkening'], light['contact_darkening'] - 0.02)
    def test_wedge_under_curved_corners_is_shaded(self):
        nb, r = self.render((200, 190, 180))
        gy = r['support_line_y']; x_corner = 400 + 14                      # under the rounded corner, just above the support line
        self.assertLess(nb[gy - 3, x_corner].mean(), 200 * 0.85)
    def test_no_shadow_beyond_the_support(self):
        nb, r = self.render((200, 190, 180), support_x=[0.40, 0.62])
        gy = r['support_line_y']; self.assertEqual(nb[gy + 2, 1000].tolist(), [200, 190, 180]); self.assertGreater(r['overhang_fraction'], 0)
    def test_shadow_follows_light(self):
        nb_l, _ = self.render((200, 190, 180), light_from='left', light_hardness=0.9)
        nb_r, _ = self.render((200, 190, 180), light_from='right', light_hardness=0.9)
        cy = 300 + 470 - 15                                                # just above the support line, beside the product
        self.assertLess(nb_l[cy, 720:820].mean(), nb_r[cy, 720:820].mean())   # light from the left throws shadow to the right
    def test_background_only(self):
        nb, _ = self.render((200, 190, 180)); self.assertEqual(nb.shape, (1350, 1080, 3))

if __name__ == '__main__': unittest.main(verbosity=2)

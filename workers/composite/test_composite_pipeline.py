"""End-to-end compositor test with the real ONNX matte models: a kraft pouch whose cream label matches the cream backdrop
(the Mellooo failure mode). Run: U2NET_HOME=workers/composite/models python3 workers/composite/test_composite_pipeline.py"""
import base64, io, os, sys, unittest
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__)); os.environ.setdefault('U2NET_HOME', os.path.join(os.path.dirname(__file__), 'models'))
import service


def url(im):
    o = io.BytesIO(); im.save(o, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(o.getvalue()).decode()


def photo():
    im = Image.new('RGB', (600, 900), (244, 236, 222)); d = ImageDraw.Draw(im)
    d.ellipse([120, 760, 480, 820], fill=(215, 205, 190))                       # soft floor shadow in the source photo
    d.rounded_rectangle([140, 120, 460, 800], 24, fill=(196, 150, 98))         # kraft pouch
    d.rectangle([180, 260, 420, 700], fill=(243, 235, 220))                    # cream label, same tone as the backdrop
    d.text((230, 330), 'mello', fill=(70, 35, 20)); d.ellipse([240, 450, 360, 560], fill=(90, 50, 30))
    return im


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bg = Image.new('RGB', (1080, 1350), (60, 40, 30))
        cls.r = service.composite({'reference': url(photo()), 'background': url(bg), 'width': 1080, 'height': 1350, 'cx': 0.5, 'ground_y': 0.8, 'scale': 0.5,
                                   'shadow': {'light_from': 'left', 'light_hardness': 0.5, 'camera': 'eye_level'}})
        cls.rep = cls.r['report']; cls.out = Image.open(io.BytesIO(base64.b64decode(cls.r['image'].split(',')[1]))).convert('RGB')

    def test_mask_reported_separately(self):
        m = self.rep['mask']; self.assertIn('enclosed_transparent_fraction', m); self.assertIn('sha256', m); self.assertTrue(self.r['mask'].startswith('data:image/png'))

    def test_label_is_opaque_in_output(self):
        f = self.rep['foreground']; cx, cy = f['x'] + int(f['w'] * 0.75), f['y'] + int(f['h'] * 0.3)   # plain cream label area
        px = np.array(self.out)[cy, cx]; self.assertGreater(int(px.sum()), 300, 'label area shows the dark scene through the product')

    def test_never_auto_approved(self):
        self.assertFalse(self.rep['approved'])

    def test_fidelity(self):
        self.assertEqual(self.rep['protected_pixels_changed'], 0); self.assertEqual(self.rep['protected_pixel_equality'], 'pass')

    def test_grounded(self):
        s = self.rep['shadow']; self.assertIsNotNone(s); self.assertAlmostEqual(s['support_line_y'], int(1350 * 0.8), delta=2); self.assertTrue(s['contact_visible'])
        y = s['support_line_y'] + 3; x = (s['base_x'][0] + s['base_x'][1]) // 2
        self.assertLess(int(np.array(self.out)[y, x].sum()), 60 * 3 - 20, 'no contact shadow under the base')


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Compositor app-level auth: tokens minted by the Node API must verify; tampered/expired/missing ones must not.
Run: python3 workers/composite/test_token.py"""
import os, subprocess, sys, unittest
os.environ['SESSION_SECRET'] = 'test-secret-123'; os.environ['COMPOSE_REQUIRE_TOKEN'] = '1'; os.environ.setdefault('U2NET_HOME', os.path.join(os.path.dirname(__file__), 'models'))
sys.path.insert(0, os.path.dirname(__file__))
import service
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
def mint(ttl=600, secret='test-secret-123'):
    js = "import('./lib/plugins/images.js').then(m => process.stdout.write(m.mintComposeToken('wsA', { ttl: %d, secret: '%s' })))" % (ttl, secret)
    return subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
class Token(unittest.TestCase):
    def test_valid(self): self.assertEqual(service.verify_token(mint()), (True, 'wsA'))
    def test_wrong_secret(self): self.assertFalse(service.verify_token(mint(secret='other'))[0])
    def test_expired(self): self.assertFalse(service.verify_token(mint(ttl=-5))[0])
    def test_tampered(self):
        t = mint(); body, sig = t.split('.', 1); self.assertFalse(service.verify_token(body[:-2] + 'xx.' + sig)[0])
    def test_missing(self): self.assertFalse(service.verify_token('')[0])
if __name__ == '__main__': unittest.main(verbosity=2)

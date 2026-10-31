import subprocess
import sys
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parent.parent / 'bin' / 'mra'


class Bin(unittest.TestCase):
    def test_runs_under_python_without_an_exec_bit_or_pythonpath(self):
        p = subprocess.run([sys.executable, str(BIN), '--help'], capture_output=True, text=True,
                           cwd='/', env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('MR manager', p.stdout)


if __name__ == '__main__':
    unittest.main()

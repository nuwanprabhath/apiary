import unittest
from pathlib import Path

from mra import cli

PROMPTS = Path(__file__).resolve().parent.parent / 'prompts'


class Templates(unittest.TestCase):
    def test_templates_are_the_files_cli_renders(self):
        for name in ('review', 'verify'):
            self.assertTrue((PROMPTS / f'{name}.tmpl').is_file(), name)
        text = cli._render('review', {'iid': 7, 'worktree': '/w', 'target_branch': 'main'})
        self.assertIn('!7', text)
        self.assertIn('git -C /w diff origin/main...HEAD', text)  # the span the markdown linter once rewrote


if __name__ == '__main__':
    unittest.main()

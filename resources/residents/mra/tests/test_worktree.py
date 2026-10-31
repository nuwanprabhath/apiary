import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from mra import worktree


class Safety(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / 'repo.worktrees'
        self.root.mkdir()

    def test_only_marked_prm_dirs_are_managed(self):
        hand = self.root / 'my-feature'
        hand.mkdir()
        unmarked = self.root / 'mra-1'
        unmarked.mkdir()
        marked = self.root / 'mra-2'
        marked.mkdir()
        (marked / worktree.MARKER).write_text(json.dumps({'managed_by': 'gitlab-mr-agent', 'iid': 2}))
        wrong_name = self.root / 'other-3'
        wrong_name.mkdir()
        (wrong_name / worktree.MARKER).write_text(json.dumps({'managed_by': 'gitlab-mr-agent', 'iid': 3}))
        self.assertFalse(worktree.is_managed(hand, self.root))
        self.assertFalse(worktree.is_managed(unmarked, self.root))
        self.assertTrue(worktree.is_managed(marked, self.root))
        self.assertFalse(worktree.is_managed(wrong_name, self.root))
        self.assertFalse(worktree.is_managed(marked, self.tmp))  # outside the configured root

    def test_remove_refuses_unmanaged(self):
        hand = self.root / 'mra-9'
        hand.mkdir()
        cfg = {'worktree_root': str(self.root), 'repo_path': str(self.tmp)}
        with self.assertRaises(RuntimeError):
            worktree.remove(cfg, hand)
        self.assertTrue(hand.exists())

    def test_remove_keeps_symlink_targets(self):
        repo = self.tmp / 'repo'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.email=t@t', '-c', 'user.name=t',
                        'commit', '-q', '--allow-empty', '-m', 'x'], check=True)
        (repo / 'node_modules').mkdir()
        (repo / 'node_modules' / 'keep.txt').write_text('keep')
        path = self.root / 'mra-5'
        subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '-q', '--detach', str(path)], check=True)
        (path / 'node_modules').symlink_to(repo / 'node_modules')
        (path / worktree.MARKER).write_text(json.dumps({'managed_by': 'gitlab-mr-agent', 'iid': 5}))
        worktree.remove({'worktree_root': str(self.root), 'repo_path': str(repo)}, path)
        self.assertFalse(path.exists())
        self.assertTrue((repo / 'node_modules' / 'keep.txt').exists())


if __name__ == '__main__':
    unittest.main()

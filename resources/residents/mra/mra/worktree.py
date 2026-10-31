"""Review worktrees: `<worktree_root>/mra-<iid>`, detached at the MR head.

Every managed worktree carries a marker file. Cleanup refuses to touch any
directory without it, so hand-made worktrees in the same root are safe.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

MARKER = '.mra-managed'
PREFIX = 'mra-'


def _git(repo, *args, check=True):
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)}: {p.stderr.strip()[:400]}')
    return p.stdout.strip()


def path_for(cfg, iid):
    return Path(cfg['worktree_root']) / f'{PREFIX}{iid}'


def read_marker(path):
    try:
        data = json.loads((Path(path) / MARKER).read_text())
    except (OSError, ValueError):
        return None
    return data if data.get('managed_by') == 'gitlab-mr-agent' else None


def is_managed(path, root):
    """True only for `<root>/mra-*` directories carrying our marker."""
    path, root = Path(path).resolve(), Path(root).resolve()
    return path.parent == root and path.name.startswith(PREFIX) and read_marker(path) is not None


def add(cfg, iid, target_branch=None):
    repo = cfg['repo_path']
    ref = f'refs/mra/mr-{iid}'
    _git(repo, 'fetch', '--quiet', 'origin', f'+refs/merge-requests/{iid}/head:{ref}')
    if target_branch:
        _git(repo, 'fetch', '--quiet', 'origin',
             f'+refs/heads/{target_branch}:refs/remotes/origin/{target_branch}', check=False)
    sha = _git(repo, 'rev-parse', ref)
    path = path_for(cfg, iid)
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    if path.exists():
        marker = read_marker(path)
        if not marker:
            raise RuntimeError(f'{path} exists but was not created by gitlab-mr-agent; not touching it')
        _git(path, 'checkout', '--quiet', '--detach', sha)
    else:
        _git(repo, 'worktree', 'add', '--quiet', '--detach', str(path), sha)
        marker = {'managed_by': 'gitlab-mr-agent', 'iid': iid, 'project': cfg['project'], 'created_at': now}
        for rel in cfg['link_into_worktree']:
            src, dst = Path(repo) / rel, path / rel
            if src.exists() and not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(src, dst)
    marker['used_at'] = now
    marker['sha'] = sha
    (path / MARKER).write_text(json.dumps(marker))
    return path, sha


def list_managed(cfg):
    root = Path(cfg['worktree_root'])
    if not root.is_dir():
        return []
    out = []
    for p in sorted(root.glob(f'{PREFIX}*')):
        m = read_marker(p)
        if m and is_managed(p, root):
            out.append((p, m))
    return out


def remove(cfg, path):
    root = cfg['worktree_root']
    if not is_managed(path, root):
        raise RuntimeError(f'refusing to remove {path}: not a gitlab-mr-agent worktree')
    marker = read_marker(path)
    _git(cfg['repo_path'], 'worktree', 'remove', '--force', str(path))
    _git(cfg['repo_path'], 'update-ref', '-d', f'refs/mra/mr-{marker["iid"]}', check=False)
    _git(cfg['repo_path'], 'worktree', 'prune', check=False)


def oldest_parent(path, shas):
    """Parent of the oldest of `shas` still on HEAD's history, or None.

    Push notes list commits in no reliable order and rebases rewrite them,
    so ask git which of them comes first.
    """
    wanted = set(shas)
    history = _git(path, 'rev-list', '--topo-order', '--reverse', 'HEAD', check=False).split()
    for sha in history:
        if sha in wanted:
            return f'{sha}^'
    return None

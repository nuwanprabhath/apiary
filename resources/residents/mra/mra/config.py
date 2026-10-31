"""Config and state files.

Config: $MRA_CONFIG or ~/.config/gitlab-mr-agent/config.json, merged
over DEFAULTS. State: ~/.local/state/gitlab-mr-agent/<project>.json.
"""

import json
import os
from pathlib import Path

DEFAULTS = {
    'gitlab_host': 'gitlab.com',
    'project': None,
    'username': None,  # null = whoever `glab auth` is logged in as
    'repo_path': None,
    'worktree_root': None,  # null = <repo_path>.worktrees
    'release_branch_regex': r'^(?:paratoo/)?dev/(\d+)\.(\d+)\.(\d+)$',
    'release_label_regex': r'^release::(\d+)\.(\d+)\.(\d+)$',
    'release_active_days': 30,
    'bump_labels': ['Bug'],
    'urgent_keywords': ['urgent', 'blocker', 'hotfix', 'asap', 'critical', 'deadline',
                        'for release', 'for the release', 'production issue'],
    'bot_username_regex': r'(^project_\d+_bot|coderabbit|^ghost$|-bot$)',
    'include_drafts': False,
    'max_agent_actions': 3,
    'stale_days': 3,
    'digest_hour': 9,
    'worktree_max_age_days': 7,
    'link_into_worktree': ['node_modules'],
    'review_notes': [],
    'e2e_job_regex': None,  # e.g. "^cypress-" to report whether E2E ran at the head
    # When the loop works. Days are Mon=0..Sun=6, times are local. null = always.
    'active_hours': {'days': [0, 1, 2, 3, 4], 'start': '09:00', 'end': '18:00'},
    'poll_minutes': [7, 22, 37, 52],
}


def config_path():
    return Path(os.environ.get('MRA_CONFIG') or Path.home() / '.config/gitlab-mr-agent/config.json')


def load_config(path=None):
    path = Path(path) if path else config_path()
    if not path.exists():
        raise SystemExit(f'No config at {path}. Copy config.example.json there (install.sh does this).')
    cfg = dict(DEFAULTS)
    cfg.update(json.loads(path.read_text()))
    for key in ('project', 'repo_path'):
        if not cfg.get(key):
            raise SystemExit(f'config {path}: "{key}" is required')
    cfg['repo_path'] = str(Path(cfg['repo_path']).expanduser())
    cfg['worktree_root'] = str(Path(cfg['worktree_root']).expanduser()) if cfg.get('worktree_root') \
        else cfg['repo_path'].rstrip('/') + '.worktrees'
    return cfg


def state_path(cfg):
    base = Path(os.environ.get('MRA_STATE_DIR') or Path.home() / '.local/state/gitlab-mr-agent')
    return base / (cfg['project'].replace('/', '__') + '.json')


def load_state(cfg):
    p = state_path(cfg)
    if p.exists():
        return json.loads(p.read_text())
    return {'mrs': {}, 'first_run': True}


def save_state(cfg, state):
    p = state_path(cfg)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(p)

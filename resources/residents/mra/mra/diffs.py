"""Which lines of a merge request's diff a comment can be anchored to."""

import re

HUNK = re.compile(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@')


class NotInDiff(ValueError):
    pass


def line_map(diff):
    """Line numbers of one file's unified diff: added and context lines (new side; a context
    line maps to its old number) and removed lines (old side)."""
    added, context, removed = set(), {}, set()
    old = new = None
    for line in diff.split('\n'):
        m = HUNK.match(line)
        if m:
            old, new = int(m.group(1)), int(m.group(2))
            continue
        if old is None or not line or line[0] == '\\':
            continue
        if line[0] == '+':
            added.add(new)
            new += 1
        elif line[0] == '-':
            removed.add(old)
            old += 1
        else:
            context[new] = old
            old += 1
            new += 1
    return {'added': added, 'context': context, 'removed': removed}


def position(refs, entries, path, line, old_line):
    """The `position` payload for a draft note on `path`, anchored to `refs` (the MR's diff_refs).

    `line` is a new-side line (added or context); `old_line` alone is a removed line."""
    if line is None and old_line is None:
        raise NotInDiff('give a line')
    entry = next((e for e in entries if e.get('new_path') == path), None)
    if entry is None and line is None:
        entry = next((e for e in entries if e.get('old_path') == path), None)
    if entry is None:
        raise NotInDiff(f'{path} is not changed in this merge request')
    lines = line_map(entry.get('diff') or '')
    pos = {'base_sha': refs['base_sha'], 'start_sha': refs['start_sha'], 'head_sha': refs['head_sha'],
           'position_type': 'text', 'new_path': entry['new_path'], 'old_path': entry['old_path']}
    if line is None:
        if old_line not in lines['removed']:
            raise NotInDiff(f'{path}: old line {old_line} is not a removed line of the diff')
        pos['old_line'] = old_line
    elif line in lines['added']:
        pos['new_line'] = line
    elif line in lines['context']:
        pos['new_line'] = line
        pos['old_line'] = lines['context'][line]
    else:
        raise NotInDiff(f'{path}:{line} is not an added or context line of the diff')
    return pos

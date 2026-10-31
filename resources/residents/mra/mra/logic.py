"""Pure decision logic: snapshots, urgency ranking and action classification.

Nothing in this module talks to GitLab or the filesystem, so it is the part
covered by unit tests. `gitlab.py` fetches raw API objects, `snapshot()` boils
them down, and `classify()` decides what (if anything) the agent should do.
"""

import re
from datetime import datetime, timedelta, timezone

# Kinds that need a subagent (and so count against the per-cycle cap).
AGENT_KINDS = ('review', 'review_delta', 'verify_threads', 'reapprove_check')
# Report order within the same urgency.
KIND_ORDER = {
    'verify_threads': 0,
    'reapprove_check': 1,
    'review_delta': 2,
    'review': 3,
    'approve_check': 4,
    'new_commits_after_approval': 5,
}

PUSH_RE = re.compile(r'^added \d+ (?:new )?commits?', re.I)
COMMIT_SHA_RE = re.compile(r'\b([0-9a-f]{40})\b')
TITLE_FIX_RE = re.compile(r'^\s*(?:hot)?fix\b', re.I)
DRAFT_PREFIX_RE = re.compile(r'^\s*(?:draft:|\[draft\]|wip:)', re.I)


def parse_time(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z') if dt else None


def is_bot(username, bot_re):
    return bool(re.search(bot_re, username or '', re.I))


def version_of(text, regex):
    m = re.search(regex, text or '')
    return tuple(int(g) for g in m.groups()) if m else None


def fmt_version(v):
    return '.'.join(str(x) for x in v)


# --------------------------------------------------------------------------
# Tickets and urgency hints

def extract_tickets(title, description, web_base, limit=4):
    """Issue numbers referenced by the MR, as work-item URLs.

    Picks up `#123`, `Closes #123` and full `/-/issues/123` or
    `/-/work_items/123` URLs. MR references (`!123`) are ignored.
    """
    text = f'{title or ""}\n{description or ""}'
    nums = []
    for m in re.finditer(r'/-/(?:work_items|issues)/(\d+)', text):
        nums.append(int(m.group(1)))
    for m in re.finditer(r'(?<![\w!/&#])#(\d{2,6})\b', text):
        nums.append(int(m.group(1)))
    seen, out = set(), []
    for n in nums:
        if n not in seen:
            seen.add(n)
            out.append(f'{web_base}/-/work_items/{n}')
    return out[:limit]


def bump_reasons(mr, cfg):
    """Within-tier urgency hints from labels, title and description."""
    reasons = []
    labels = set(mr.get('labels') or [])
    for lab in cfg['bump_labels']:
        if lab in labels:
            reasons.append(f'{lab} label')
    title = mr.get('title') or ''
    if TITLE_FIX_RE.search(title):
        reasons.append('fix in title')
    text = f'{title}\n{mr.get("description") or ""}'.lower()
    for kw in cfg['urgent_keywords']:
        if re.search(r'\b' + re.escape(kw.lower()) + r'\b', text):
            reasons.append(f'"{kw}" in title/description')
    return reasons


def open_release_versions(open_mrs, cfg, now):
    """Release versions with recent MR activity, most urgent (lowest) first.

    A version counts as open when some open MR targeting it was updated in the
    last `release_active_days`. That keeps one forgotten MR into an old branch
    from pushing the real release down the list.
    """
    cutoff = now - timedelta(days=cfg['release_active_days'])
    versions = set()
    for mr in open_mrs:
        v = version_of(mr.get('target_branch'), cfg['release_branch_regex'])
        if v and (parse_time(mr.get('updated_at')) or now) >= cutoff:
            versions.add(v)
    return sorted(versions)


def urgency(snap, versions, rerequest):
    """Sort key (lower is more urgent) plus human-readable reasons."""
    reasons = []
    tiers = []
    # Versions round-trip through the JSON state file as lists.
    versions = [tuple(v) for v in versions]
    bv = tuple(snap['branch_version']) if snap.get('branch_version') else None
    if bv and bv in versions:
        tiers.append(versions.index(bv))
        reasons.append(f'targets {snap["target_branch"]}')
    for lv in map(tuple, snap.get('label_versions') or []):
        if lv in versions:
            tiers.append(versions.index(lv))
            reasons.append(f'release::{fmt_version(lv)} label')
    tier = min(tiers) if tiers else len(versions)
    if not tiers:
        reasons.append(f'targets {snap["target_branch"]} (not a release branch)')
    if rerequest:
        reasons.insert(0, 're-review requested')
    bumps = snap.get('bump_reasons') or []
    reasons.extend(bumps)
    key = (tier, 0 if rerequest else 1, 0 if bumps else 1, snap['iid'])
    tier_label = fmt_version(versions[tier]) if tier < len(versions) else 'other'
    return key, tier_label, reasons


# --------------------------------------------------------------------------
# Snapshot

def snapshot(mr, approvals, reviewers, discussions, me, cfg):
    """Reduce raw API objects for one MR to what the classifier needs."""
    bot_re = cfg['bot_username_regex']
    author = mr['author']['username']
    approved_by = [a['user']['username'] for a in (approvals or {}).get('approved_by', [])]

    my_threads = []
    my_note_count = 0
    my_last_note_at = None
    last_push_at = None
    last_author_note_at = None
    my_last_approved_at = None
    reset_by_push_at = None
    my_last_unapproved_at = None
    pushes = []  # (created_at, [shas])
    others_notes = []  # comments by other people, for the ready check

    for d in discussions:
        notes = d.get('notes') or []
        if not notes:
            continue
        first = notes[0]
        for n in notes:
            who = n['author']['username']
            at = n['created_at']
            body = n.get('body') or ''
            if n.get('system'):
                if PUSH_RE.search(body):
                    last_push_at = max(filter(None, [last_push_at, at]))
                    pushes.append((at, COMMIT_SHA_RE.findall(body)))
                elif who == me and body.startswith('approved this merge request'):
                    my_last_approved_at = max(filter(None, [my_last_approved_at, at]))
                elif who == me and body.startswith('unapproved this merge request'):
                    my_last_unapproved_at = max(filter(None, [my_last_unapproved_at, at]))
                elif f'reset approvals from @{me}' in body:
                    reset_by_push_at = max(filter(None, [reset_by_push_at, at]))
                continue
            if who == me:
                my_note_count += 1
                my_last_note_at = max(filter(None, [my_last_note_at, at]))
            else:
                if who == author:
                    last_author_note_at = max(filter(None, [last_author_note_at, at]))
                if not is_bot(who, bot_re):
                    others_notes.append({
                        'id': n['id'], 'author': who, 'at': at, 'body': body[:800],
                        'url': f'{mr["web_url"]}#note_{n["id"]}',
                        'thread_starter': first['author']['username'],
                        'thread_resolved': bool(first.get('resolved')) if first.get('resolvable') else None,
                    })

        if first.get('system') or first['author']['username'] != me or not first.get('resolvable'):
            continue
        pos = first.get('position') or {}
        replies = [n for n in notes[1:] if not n.get('system')]
        human_replies = [n for n in replies
                         if n['author']['username'] != me and not is_bot(n['author']['username'], bot_re)]
        my_threads.append({
            'id': d['id'],
            'resolved': bool(first.get('resolved')),
            'path': pos.get('new_path') or pos.get('old_path'),
            'line': pos.get('new_line') or pos.get('old_line'),
            'first_note_id': first['id'],
            'url': f'{mr["web_url"]}#note_{first["id"]}',
            'notes': [{'author': n['author']['username'], 'at': n['created_at'],
                       'body': (n.get('body') or '')[:1500]} for n in [first] + replies],
            'last_human_reply_id': max((n['id'] for n in human_replies), default=0),
            'last_my_note_at': max((n['created_at'] for n in [first] + replies
                                    if n['author']['username'] == me), default=None),
        })

    # Commits pushed after my last approval, oldest first (for re-approve diffs).
    new_commits = []
    if my_last_approved_at:
        for at, shas in sorted(pushes):
            if at > my_last_approved_at:
                new_commits.extend(x for x in shas if x not in new_commits)

    web_base = mr['web_url'].split('/-/merge_requests/')[0]
    pipeline = mr.get('head_pipeline') or mr.get('pipeline')
    return {
        'iid': mr['iid'],
        'title': mr['title'],
        'url': mr['web_url'],
        'author': author,
        'assignees': [a['username'] for a in mr.get('assignees') or []],
        'reviewers': [r['username'] for r in mr.get('reviewers') or []],
        'source_branch': mr['source_branch'],
        'target_branch': mr['target_branch'],
        'labels': mr.get('labels') or [],
        'draft': bool(mr.get('draft')) or bool(DRAFT_PREFIX_RE.search(mr['title'])),
        'sha': mr['sha'],
        'updated_at': mr['updated_at'],
        'created_at': mr['created_at'],
        'branch_version': version_of(mr['target_branch'], cfg['release_branch_regex']),
        'label_versions': [v for v in (version_of(l, cfg['release_label_regex']) for l in mr.get('labels') or []) if v],
        'bump_reasons': bump_reasons(mr, cfg),
        'tickets': extract_tickets(mr['title'], mr.get('description'), web_base),
        'approved_by': approved_by,
        'approved_by_me': me in approved_by,
        'reviewer_states': {r['user']['username']: r.get('state') for r in reviewers or []},
        'pipeline': {'id': pipeline['id'], 'status': pipeline['status'], 'url': pipeline.get('web_url')} if pipeline else None,
        'has_conflicts': bool(mr.get('has_conflicts')),
        'merge_status': mr.get('detailed_merge_status'),
        'my_threads': my_threads,
        'my_note_count': my_note_count,
        'my_last_note_at': my_last_note_at,
        'last_push_at': last_push_at,
        'last_author_note_at': last_author_note_at,
        'my_last_approved_at': my_last_approved_at,
        'reset_by_push_at': reset_by_push_at,
        'commits_since_my_approval': new_commits,
        'others_notes': sorted(others_notes, key=lambda x: x['at'])[-40:],
        'others_open_threads': sum(1 for d in discussions
                                   if (d.get('notes') or [{}])[0].get('resolvable')
                                   and not d['notes'][0].get('resolved')
                                   and d['notes'][0]['author']['username'] != me
                                   and not is_bot(d['notes'][0]['author']['username'], bot_re)),
        'my_unapproved_after': bool(my_last_unapproved_at and my_last_approved_at
                                    and my_last_unapproved_at > my_last_approved_at),
    }


def light_snapshot_fields(mr):
    """Fields from the MR list endpoint that are always fresh (no detail call)."""
    return {
        'sha': mr['sha'],
        'updated_at': mr['updated_at'],
        'title': mr['title'],
        'labels': mr.get('labels') or [],
        'draft': bool(mr.get('draft')),
        'has_conflicts': bool(mr.get('has_conflicts')),
        'merge_status': mr.get('detailed_merge_status'),
    }


# --------------------------------------------------------------------------
# Classification

def scope_of(snap, me):
    if snap['author'] == me:
        return 'own'
    if me in snap['assignees']:
        return 'assignee'
    return None


def ready_info(snap, st, me):
    unresolved = [t for t in snap['my_threads'] if not t['resolved']]
    pipe = snap.get('pipeline') or {}
    others_changes = sorted(u for u, s in (snap.get('reviewer_states') or {}).items()
                            if s == 'requested_changes' and u != me)
    # A re-request resets the reviewer's state to "unreviewed" but GitLab
    # keeps blocking the merge until that reviewer approves or re-reviews.
    if not others_changes and snap.get('merge_status') == 'requested_changes':
        others_changes = ['a reviewer (GitLab still shows the MR as changes requested)']
    # Blockers the manager's own review found count until you either raise
    # threads (then the threads speak for them) or dismiss them.
    review_blockers = 0 if snap['my_threads'] else (st.get('review_blockers') or 0)
    reasons = []
    if unresolved:
        reasons.append(f'{len(unresolved)} of your threads unresolved')
    if pipe.get('status') != 'success':
        reasons.append(f'pipeline {pipe.get("status") or "missing"}')
    if snap['has_conflicts'] or snap['merge_status'] == 'conflict':
        reasons.append('merge conflicts')
    if snap['merge_status'] == 'need_rebase':
        reasons.append('needs rebase onto target')
    if review_blockers:
        reasons.append(f'{review_blockers} blocker(s) from the review not raised as threads yet')
    if snap['draft']:
        reasons.append('still a draft')
    # Comments from other people the user hasn't seen: everything after their
    # last approval or comment (or the last 14 days if they never engaged).
    seen_at = max(filter(None, [snap.get('my_last_approved_at'), snap.get('my_last_note_at')]), default=None)
    if not seen_at:
        seen_at = iso(datetime.now(timezone.utc) - timedelta(days=14))
    unseen = [n for n in snap.get('others_notes') or [] if n['at'] > seen_at]
    return {
        'ok': not reasons,
        'not_ready_because': reasons,
        'comments_since_you_looked': unseen[-12:],
        'others_open_threads': snap.get('others_open_threads', 0),
        'pipeline': pipe or None,
        'merge_status': snap['merge_status'],
        'others_requested_changes': others_changes,
    }


def classify(snap, st, todos, me):
    """Decide what the agent should do for one in-scope MR.

    Returns (kind or None, extra dict). `st` is this MR's persisted state,
    `todos` the pending GitLab To-Dos on this MR.
    """
    rerequest = any(t['action_name'] == 'review_requested' and t['id'] not in st.get('handled_todo_ids', [])
                    for t in todos)
    sha = snap['sha']
    parked = st.get('parked')
    extra = {'rerequest': rerequest, 'unparked': False}

    if parked:
        if parked['sha'] == sha and not rerequest:
            return None, extra
        extra['unparked'] = True

    if snap['approved_by_me'] and not rerequest:
        known = st.get('approved_sha')
        if known and known != sha and st.get('post_approval_reported_sha') != sha:
            return 'new_commits_after_approval', extra
        return None, extra

    unresolved = [t for t in snap['my_threads'] if not t['resolved']]
    engaged = (snap['my_note_count'] > 0 or bool(st.get('reviewed_sha')) or bool(st.get('baseline_sha'))
               or bool(snap.get('my_last_approved_at'))
               or (snap.get('reviewer_states') or {}).get(me) in ('reviewed', 'requested_changes'))
    reply_id = max((t['last_human_reply_id'] for t in unresolved), default=0)

    # Approval lost to a push: GitLab doesn't always leave a "reset approvals"
    # note, so commits landing after my last approval count as well.
    reset = snap.get('reset_by_push_at')
    approved_at = snap.get('my_last_approved_at')
    lost = (reset and (not approved_at or reset > approved_at)) or \
        (approved_at and snap.get('commits_since_my_approval') and not snap.get('my_unapproved_after'))
    if lost and st.get('reset_checked_sha') != sha and not unresolved:
        return 'reapprove_check', extra
    if unresolved:
        # Re-verify on a reply, or on commits pushed after both the user's
        # latest thread note and the last time a subagent read this head.
        my_latest = max((t['last_my_note_at'] for t in unresolved if t['last_my_note_at']), default=None)
        pushed_since = bool(snap.get('last_push_at')) and (not my_latest or snap['last_push_at'] > my_latest)
        looked = st.get('looked_sha') or st.get('verified_sha')
        if rerequest or reply_id > (st.get('verified_note_id') or 0) or (pushed_since and looked != sha):
            return 'verify_threads', extra
    if not engaged:
        return 'review', extra
    if not unresolved and st.get('reviewed_sha') and st['reviewed_sha'] != sha and rerequest:
        return 'review_delta', extra
    # A pipeline that was still running when readiness was last reported has
    # since finished: report once more so the user hears the outcome.
    was_running = st.get('ready_reported_pipeline') in ('running', 'pending', 'created', 'waiting_for_resource')
    now_status = (snap.get('pipeline') or {}).get('status')
    pipeline_settled = was_running and now_status != st.get('ready_reported_pipeline')
    if not unresolved and (rerequest or extra['unparked'] or st.get('ready_reported_sha') != sha or pipeline_settled):
        if snap['draft'] and not rerequest:
            return None, extra
        return 'approve_check', extra
    return None, extra


def waiting_on(snap, kind, st, scope):
    if scope:
        return scope
    if st.get('parked') and kind is None:
        return 'parked'
    if snap['approved_by_me'] and kind is None:
        return 'approved'
    if kind:
        return 'you'
    if any(not t['resolved'] for t in snap['my_threads']):
        return 'author'
    return 'you'


def waiting_on_author_since(snap, st):
    """When the ball last went to the author: my latest thread note or verification."""
    unresolved = [t for t in snap['my_threads'] if not t['resolved']]
    if not unresolved:
        return None
    stamps = [t['last_my_note_at'] for t in unresolved if t['last_my_note_at']]
    if st.get('verified_at'):
        stamps.append(st['verified_at'])
    return max(stamps) if stamps else None


# --------------------------------------------------------------------------
# Working hours

def _hm(text):
    h, m = text.split(':')
    return int(h), int(m)


def in_active_hours(active, local_now):
    """True when `local_now` falls inside the configured working window."""
    if not active:
        return True
    if local_now.weekday() not in active['days']:
        return False
    start, end = _hm(active['start']), _hm(active['end'])
    return start <= (local_now.hour, local_now.minute) < end


def cron_for(active, minutes):
    """Cron expression that fires on `minutes` past each hour inside the window."""
    mins = ','.join(str(m) for m in minutes)
    if not active:
        return f'{mins} * * * *'
    (sh, _), (eh, em) = _hm(active['start']), _hm(active['end'])
    last = eh if em else eh - 1
    # cron days: Sun=0..Sat=6; ours: Mon=0..Sun=6
    days = ','.join(str((d + 1) % 7) for d in sorted(active['days']))
    return f'{mins} {sh}-{last} * * {days}'

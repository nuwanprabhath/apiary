"""`mra`: the deterministic half of the MR manager.

It reads GitLab, keeps state, ranks and classifies MRs, and makes the few
writes the agent is allowed: resolving the user's own threads and marking
To-Dos done. `approve` exists only for the user to call by number from the
chat ("2 approve"); the agent never approves on its own. Nothing posts notes.
"""

import argparse
import json
import string
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import logic, stats as review_stats, worktree
from .config import load_config, load_state, save_state, state_path
from .gitlab import GitLab

ROOT = Path(__file__).resolve().parent.parent
DETAIL_MAX_AGE_MIN = 30
IN_FLIGHT_MAX_MIN = 60  # a subagent still running after this is assumed lost


def now_utc():
    return datetime.now(timezone.utc)


def ctx(args):
    cfg = load_config(args.config)
    gl = GitLab(cfg['gitlab_host'], cfg['project'])
    state = load_state(cfg)
    if not state.get('me'):
        state['me'] = cfg['username'] or gl.me()
    if not state.get('project_id'):
        state['project_id'] = gl.project_id()
    if isinstance(getattr(args, 'iid', None), str):
        args.shown_sha = None
        args.iid, args.shown_sha = resolve_ref(state, args.iid)
    return cfg, gl, state


def resolve_ref(state, ref):
    """`!1234` is always an MR iid; a bare number is a position in the list
    last shown (desk or cycle update) when it is one, otherwise an iid.

    Returns (iid, sha shown with that number or None).
    """
    ref = ref.strip()
    if ref.startswith('!'):
        return int(ref[1:]), None
    n = int(ref.lstrip('#'))
    for item in (state.get('numbering') or {}).get('items', []):
        if item['n'] == n:
            return item['iid'], item['sha']
    return n, None


def store_numbering(state, pairs):
    state['numbering'] = {'shown_at': logic.iso(now_utc()),
                          'items': [{'n': i, 'iid': iid, 'sha': sha} for i, (iid, sha) in enumerate(pairs, 1)]}


def out(obj):
    json.dump(obj, sys.stdout, indent=1, default=str)
    sys.stdout.write('\n')


# --------------------------------------------------------------------------
# poll

def _refresh_needed(st, mr, now, has_new_todo):
    snap = st.get('snapshot')
    if not snap or has_new_todo or st.get('pending'):
        return True
    if snap['updated_at'] != mr['updated_at'] or snap['sha'] != mr['sha']:
        return True
    fetched = logic.parse_time(st.get('fetched_at'))
    return not fetched or (now - fetched).total_seconds() > DETAIL_MAX_AGE_MIN * 60


def collect(cfg, gl, state):
    """Fetch, snapshot and classify every watched MR. Mutates `state`."""
    me = state['me']
    now = now_utc()
    open_mrs = gl.open_mrs()
    versions = logic.open_release_versions(open_mrs, cfg, now)
    todos = gl.pending_mr_todos(state['project_id'])
    todos_by_iid = {}
    for t in todos:
        todos_by_iid.setdefault(t['target']['iid'], []).append(t)

    mine = [m for m in open_mrs if me in [r['username'] for r in m.get('reviewers') or []]]
    mrs_state = state.setdefault('mrs', {})

    def needs_detail(m):
        st = mrs_state.get(str(m['iid']), {})
        handled = set(st.get('handled_todo_ids', []))
        new_todo = any(t['id'] not in handled for t in todos_by_iid.get(m['iid'], []))
        return _refresh_needed(st, m, now, new_todo)

    to_fetch = [m['iid'] for m in mine if needs_detail(m)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        details = dict(zip(to_fetch, pool.map(gl.mr_detail, to_fetch)))

    rows = []
    for m in mine:
        key = str(m['iid'])
        st = mrs_state.setdefault(key, {})
        if m['iid'] in details:
            d = details[m['iid']]
            st['snapshot'] = logic.snapshot(d['mr'], d['approvals'], d['reviewers'], d['discussions'], me, cfg)
            st['fetched_at'] = logic.iso(now)
        else:
            st['snapshot'].update(logic.light_snapshot_fields(m))
        snap = st['snapshot']
        if snap['approved_by_me'] and st.get('approved_at') != snap.get('my_last_approved_at'):
            st['approved_sha'] = snap['sha']
            st['approved_at'] = snap.get('my_last_approved_at')

        mr_todos = todos_by_iid.get(m['iid'], [])
        scope = logic.scope_of(snap, me)
        if scope or (snap['draft'] and not cfg['include_drafts']
                     and not any(t['action_name'] == 'review_requested' for t in mr_todos)):
            kind, extra = None, {'rerequest': False, 'unparked': False}
            scope = scope or 'draft'
        else:
            kind, extra = logic.classify(snap, st, mr_todos, me)
        if extra.get('unparked') and kind:
            st.pop('parked', None)
        key_, tier, reasons = logic.urgency(snap, versions, extra.get('rerequest'))
        if extra.get('unparked'):
            reasons.insert(0, 'new commits since you parked it')
        rows.append({'iid': m['iid'], 'snap': snap, 'st': st, 'kind': kind, 'extra': extra,
                     'scope': scope, 'sort': key_, 'tier': tier, 'reasons': reasons, 'todos': mr_todos})

    # Forget MRs that left the watch list (merged, closed, reviewer removed),
    # but keep a note so worktree cleanup knows they are done.
    watched = {str(m['iid']) for m in mine}
    for key in list(mrs_state):
        if key not in watched:
            mrs_state.pop(key)
    return rows, versions, todos, now


def is_human(username, cfg, me):
    return username != me and not logic.is_bot(username, cfg['bot_username_regex'])


def build_action(row, cfg, gl, state):
    snap, st, kind = row['snap'], row['st'], row['kind']
    me = state['me']
    human_mention = lambda t: t['action_name'] in ('mentioned', 'directly_addressed') \
        and is_human(t['author']['username'], cfg, me)
    unresolved = [t for t in snap['my_threads'] if not t['resolved']]
    action = {
        'iid': snap['iid'], 'kind': kind, 'url': snap['url'], 'title': snap['title'],
        'author': snap['author'], 'source_branch': snap['source_branch'],
        'target_branch': snap['target_branch'], 'sha': snap['sha'], 'draft': snap['draft'],
        'tier': row['tier'], 'urgency_reasons': row['reasons'],
        'rerequest': row['extra']['rerequest'], 'unparked': row['extra']['unparked'],
        'tickets': snap['tickets'],
        'unresolved_threads': unresolved,
        'thread_reply_id': max((t['last_human_reply_id'] for t in unresolved), default=0),
        'todo_ids': [t['id'] for t in row['todos'] if not human_mention(t)],
    }
    if kind in ('review_delta',):
        action['delta_base'] = st.get('reviewed_sha')
    if kind in ('reapprove_check', 'new_commits_after_approval'):
        commits = snap.get('commits_since_my_approval') or []
        action['delta_base'] = st.get('approved_sha') or (f'{commits[0]}^' if commits else None)
        action['new_commits'] = commits
    if kind == 'verify_threads':
        action['delta_base'] = st.get('verified_sha') or st.get('reviewed_sha')
    if kind in ('approve_check', 'verify_threads', 'reapprove_check', 'new_commits_after_approval'):
        ready = logic.ready_info(snap, st, me)
        pipe = ready.get('pipeline') or {}
        if pipe.get('status') == 'failed':
            jobs = gl.failed_jobs(pipe['id'])
            ready['failed_jobs'] = [j for j in jobs if not j['allow_failure']]
            if not ready['failed_jobs']:
                ready['not_ready_because'] = [r for r in ready['not_ready_because'] if not r.startswith('pipeline')]
                ready['ok'] = not ready['not_ready_because']
                ready['note'] = 'pipeline failed only on allow_failure jobs'
        _add_e2e(ready, gl, cfg, snap['sha'])
        action['ready'] = ready
    return action


def _add_e2e(ready, gl, cfg, sha):
    if not cfg.get('e2e_job_regex'):
        return
    try:
        ready['e2e_at_head'] = gl.e2e_status(sha, cfg['e2e_job_regex'])
    except Exception as e:
        ready['e2e_at_head'] = {'error': str(e)[:200]}


def cmd_poll(args):
    cfg, gl, state = ctx(args)
    local_now = datetime.now().astimezone()
    if not args.force and not logic.in_active_hours(cfg['active_hours'], local_now):
        out({'quiet_hours': True, 'polled_at': None, 'active_hours': cfg['active_hours'],
             'actions': [], 'deferred': [], 'in_flight': [], 'mentions': [], 'waiting_on_you': []})
        return
    me = state['me']
    rows, versions, todos, now = collect(cfg, gl, state)
    rows.sort(key=lambda r: (r['sort'], logic.KIND_ORDER.get(r['kind'], 9)))

    cap = args.max if args.max is not None else cfg['max_agent_actions']
    actions, deferred, agent_used = [], [], 0
    watched_iids = {r['iid'] for r in rows}
    in_flight = []
    for r in rows:
        if not r['kind']:
            r['st'].pop('pending', None)
            continue
        started = logic.parse_time(r['st'].get('in_flight_since'))
        if started and (now - started).total_seconds() < IN_FLIGHT_MAX_MIN * 60:
            in_flight.append(r['iid'])
            continue
        a = build_action(r, cfg, gl, state)
        r['st']['pending'] = {k: a.get(k) for k in ('kind', 'sha', 'thread_reply_id', 'todo_ids')}
        if r['kind'] in logic.AGENT_KINDS:
            if agent_used >= cap:
                deferred.append({'iid': a['iid'], 'kind': a['kind'], 'title': a['title'],
                                 'tier': a['tier'], 'urgency_reasons': a['urgency_reasons']})
                continue
            agent_used += 1
        actions.append(a)

    # Human @mentions anywhere in the project, reported even when the MR is out of scope.
    mentions = [{'todo_id': t['id'], 'iid': t['target']['iid'], 'title': t['target']['title'],
                 'author': t['author']['username'], 'action': t['action_name'],
                 'body': (t.get('body') or '')[:600], 'url': t.get('target_url'), 'at': t['created_at'],
                 'watched': t['target']['iid'] in watched_iids}
                for t in todos
                if t['action_name'] in ('mentioned', 'directly_addressed')
                and is_human(t['author']['username'], cfg, me)
                and t['id'] not in state.get('seen_mention_ids', [])]
    # Each mention is reported once; its To-Do stays for the user to clear.
    state['seen_mention_ids'] = sorted(set(state.get('seen_mention_ids', [])) | {m['todo_id'] for m in mentions})
    acted = {a['iid'] for a in actions} | {d['iid'] for d in deferred}
    # MRs already reported as okay to approve that the user hasn't acted on.
    # A push invalidates the report (the sha no longer matches).
    waiting = []
    for r in rows:
        ok = r['st'].get('okay_reported')
        if not ok or r['scope'] or r['snap']['approved_by_me'] or r['st'].get('parked'):
            continue
        if ok['sha'] != r['snap']['sha']:
            r['st'].pop('okay_reported', None)
            continue
        if r['iid'] not in acted:
            waiting.append({'iid': r['iid'], 'title': r['snap']['title'], 'url': r['snap']['url'],
                            'author': r['snap']['author'], 'okay_since': ok['at']})
    noise = [t['id'] for t in todos
             if t['target']['iid'] in watched_iids and t['target']['iid'] not in acted
             and not is_human(t['author']['username'], cfg, me)
             and t['action_name'] != 'review_requested']
    state['noise_todo_ids'] = noise

    local_now = datetime.now().astimezone()
    digest_due = local_now.hour >= cfg['digest_hour'] and state.get('last_digest_date') != local_now.date().isoformat()
    first_run = state.pop('first_run', False)
    state['last_poll_at'] = logic.iso(now)
    save_state(cfg, state)
    out({
        'me': me, 'project': cfg['project'], 'polled_at': logic.iso(now), 'first_run': first_run,
        'release_versions': [logic.fmt_version(v) for v in versions],
        'watched': len(rows),
        'actions': actions, 'deferred': deferred, 'in_flight': in_flight, 'mentions': mentions,
        'waiting_on_you': waiting,
        'noise_todo_count': len(noise), 'digest_due': digest_due,
        'skipped': {s: [r['iid'] for r in rows if logic.waiting_on(r['snap'], r['kind'], r['st'], r['scope']) == s]
                    for s in ('approved', 'parked', 'assignee', 'own', 'draft')},
    })


# --------------------------------------------------------------------------
# after the agent has handled something

def _mrs(state, iid):
    st = state.get('mrs', {}).get(str(iid))
    if not st or not st.get('snapshot'):
        raise SystemExit(f'!{iid} is not a watched MR (run `mra poll` first)')
    return st


def cmd_done(args):
    cfg, gl, state = ctx(args)
    st = _mrs(state, args.iid)
    p = st.get('pending')
    if not p:
        raise SystemExit(f'!{args.iid} has no pending action')
    kind, sha, now = p['kind'], p['sha'], logic.iso(now_utc())
    if kind in logic.AGENT_KINDS:
        # Any subagent pass read the code at this head, so it also covers
        # the approval-reset check and thread re-verification for it.
        st['reset_checked_sha'] = sha
        st['looked_sha'] = sha
    if kind in ('review', 'review_delta'):
        st['reviewed_sha'] = sha
        if args.blockers is not None:
            st['review_blockers'] = args.blockers
    if kind == 'verify_threads':
        st['verified_sha'], st['verified_note_id'], st['verified_at'] = sha, p['thread_reply_id'], now
        st['ready_reported_sha'] = sha
        if args.blockers is not None:
            st['review_blockers'] = args.blockers
            st['reviewed_sha'] = sha
    if kind == 'reapprove_check':
        st['reviewed_sha'] = sha
        st['ready_reported_sha'] = sha
        if args.blockers is not None:
            st['review_blockers'] = args.blockers
    if kind == 'approve_check':
        st['ready_reported_sha'] = sha
    if kind == 'new_commits_after_approval':
        st['post_approval_reported_sha'] = sha
    if args.okay_to_approve:
        st['okay_reported'] = {'sha': sha, 'at': now}
    st['ready_reported_pipeline'] = ((st.get('snapshot') or {}).get('pipeline') or {}).get('status')
    handled = set(st.get('handled_todo_ids', []))
    handled.update(p['todo_ids'] or [])
    st['handled_todo_ids'] = sorted(handled)
    done_todos = []
    if not args.keep_todos:
        for tid in p['todo_ids'] or []:
            try:
                gl.mark_todo_done(tid)
                done_todos.append(tid)
            except Exception as e:  # a To-Do already done elsewhere is fine
                print(f'warning: todo {tid}: {e}', file=sys.stderr)
    st.pop('pending', None)
    st.pop('in_flight_since', None)
    save_state(cfg, state)
    out({'iid': args.iid, 'recorded': kind, 'sha': sha, 'todos_marked_done': done_todos})


def cmd_resolve(args):
    cfg, gl, state = ctx(args)
    me = state['me']
    results = []
    for did in args.discussion_ids:
        d = gl.discussion(args.iid, did)
        first = d['notes'][0]
        if first['author']['username'] != me:
            results.append({'id': did, 'resolved': False, 'why': f'started by @{first["author"]["username"]}, not you'})
            continue
        if not first.get('resolvable'):
            results.append({'id': did, 'resolved': False, 'why': 'not resolvable'})
            continue
        if first.get('resolved'):
            results.append({'id': did, 'resolved': True, 'why': 'already resolved'})
            continue
        gl.resolve_discussion(args.iid, did)
        results.append({'id': did, 'resolved': True})
    out(results)


def cmd_todo_done(args):
    cfg, gl, state = ctx(args)
    ids = list(args.todo_ids)
    if args.noise:
        ids += state.get('noise_todo_ids') or []
    done = []
    for tid in ids:
        try:
            gl.mark_todo_done(tid)
            done.append(tid)
        except Exception as e:
            print(f'warning: todo {tid}: {e}', file=sys.stderr)
    if args.noise:
        state['noise_todo_ids'] = []
        save_state(cfg, state)
    out({'marked_done': done})


def cmd_ready(args):
    cfg, gl, state = ctx(args)
    me = state['me']
    st = state.setdefault('mrs', {}).setdefault(str(args.iid), {})
    d = gl.mr_detail(args.iid)
    st['snapshot'] = logic.snapshot(d['mr'], d['approvals'], d['reviewers'], d['discussions'], me, cfg)
    st['fetched_at'] = logic.iso(now_utc())
    ready = logic.ready_info(st['snapshot'], st, me)
    pipe = ready.get('pipeline') or {}
    if pipe.get('status') == 'failed':
        ready['failed_jobs'] = [j for j in gl.failed_jobs(pipe['id']) if not j['allow_failure']]
    _add_e2e(ready, gl, cfg, st['snapshot']['sha'])
    save_state(cfg, state)
    out(ready)


# --------------------------------------------------------------------------
# prompts and worktrees

def _render(name, values):
    tpl = string.Template((ROOT / 'prompts' / f'{name}.tmpl').read_text())
    return tpl.safe_substitute(values)


def _threads_text(threads):
    parts = []
    for t in threads:
        where = f'{t["path"]}:{t["line"]}' if t.get('path') else 'general comment'
        lines = [f'### Thread {t["id"]} ({where}) {t["url"]}']
        for n in t['notes']:
            lines.append(f'- @{n["author"]} ({n["at"][:16]}):\n  ' + n['body'].replace('\n', '\n  '))
        parts.append('\n'.join(lines))
    return '\n\n'.join(parts) or '(none)'


def cmd_prompt(args):
    cfg, gl, state = ctx(args)
    st = state.get('mrs', {}).get(str(args.iid)) or {}
    if not st.get('snapshot'):
        d = gl.mr_detail(args.iid)
        st = state.setdefault('mrs', {}).setdefault(str(args.iid), {})
        st['snapshot'] = logic.snapshot(d['mr'], d['approvals'], d['reviewers'], d['discussions'], state['me'], cfg)
        save_state(cfg, state)
    snap = st['snapshot']
    kind = args.kind or (st.get('pending') or {}).get('kind') or 'review'
    path, sha = worktree.add(cfg, args.iid, snap['target_branch'])
    unresolved = [t for t in snap['my_threads'] if not t['resolved']]
    base = {
        'review_delta': st.get('reviewed_sha'),
        'verify_threads': st.get('verified_sha') or st.get('reviewed_sha'),
        'reapprove_check': st.get('approved_sha') or (
            f'{snap["commits_since_my_approval"][0]}^' if snap.get('commits_since_my_approval') else None),
    }.get(kind)
    if kind == 'reapprove_check' and not st.get('approved_sha') and snap.get('commits_since_my_approval'):
        base = worktree.oldest_parent(path, snap['commits_since_my_approval']) or base
    base = base or ''
    merge_note = ''
    if base and kind in ('review_delta', 'reapprove_check', 'verify_threads'):
        merges = worktree._git(path, 'log', '--merges', '--format=%s', f'{base}..HEAD', check=False)
        if snap['target_branch'] in merges:
            merge_note = (f' Some of these commits merge `{snap["target_branch"]}` into the branch, so the raw range '
                          f'includes unrelated target commits. Judge how the MR\'s own diff changed: compare '
                          f'`git -C {path} diff origin/{snap["target_branch"]}...HEAD` with the MR as it was at '
                          f'{base.rstrip("^")}, and check how any merge conflicts were resolved.')
    values = {
        'me': state['me'], 'iid': snap['iid'], 'url': snap['url'], 'title': snap['title'],
        'author': snap['author'], 'source_branch': snap['source_branch'],
        'target_branch': snap['target_branch'], 'sha': sha, 'worktree': str(path),
        'tickets': '\n'.join(f'- {u}' for u in snap['tickets']) or '- (none referenced; check the description)',
        'delta_base': base,
        'delta_note': {
            'review_delta': f'You reviewed this MR before at {base}. Review only what changed since then '
                            f'(`git -C {path} diff {base}..HEAD`), and say whether any earlier concern still applies.',
            'reapprove_check': f'@{state["me"]} approved this MR, then new commits reset the approval. Review only '
                               f'those commits (`git -C {path} log --oneline {base}..HEAD`, '
                               f'`git -C {path} diff {base}..HEAD`). Say in your first line after BLOCKERS whether '
                               f'they are safe to re-approve: "RE-APPROVE: yes" or "RE-APPROVE: no, <why>".',
            'verify_threads': '',
        }.get(kind, 'This is a full review.') + merge_note if base else (
            '' if kind == 'verify_threads' else 'This is a full review.'),
        'threads': _threads_text(unresolved),
        'review_notes': '\n'.join(f'- {n}' for n in cfg['review_notes']) or '- (none)',
        'project': cfg['project'],
    }
    st['in_flight_since'] = logic.iso(now_utc())
    save_state(cfg, state)
    template = 'verify' if kind == 'verify_threads' else 'review'
    prompt = _render(template, values)
    prompt_file = state_path(cfg).parent / 'prompts' / f'{snap["iid"]}-{kind}.md'
    prompt_file.parent.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(prompt)
    out({'iid': snap['iid'], 'kind': kind, 'worktree': str(path), 'sha': sha, 'prompt_file': str(prompt_file),
         'agent_prompt': f'Read {prompt_file} and do exactly what it says. Your final reply must be '
                         f'only the output that file asks for.'})


def cmd_worktree(args):
    cfg, gl, state = ctx(args)
    if args.wt_cmd == 'add':
        st = state.get('mrs', {}).get(str(args.iid)) or {}
        path, sha = worktree.add(cfg, args.iid, (st.get('snapshot') or {}).get('target_branch'))
        out({'path': str(path), 'sha': sha})
    elif args.wt_cmd == 'list':
        out([{'path': str(p), **m} for p, m in worktree.list_managed(cfg)])
    elif args.wt_cmd == 'cleanup':
        removed, kept = [], []
        now = now_utc()
        for p, m in worktree.list_managed(cfg):
            st = state.get('mrs', {}).get(str(m['iid']))
            snap = (st or {}).get('snapshot') or {}
            used = logic.parse_time(m.get('used_at') or m.get('created_at'))
            age_days = (now - used).total_seconds() / 86400 if used else 999
            why = None
            if args.iid is not None:
                why = 'requested' if m['iid'] == args.iid else None
            elif args.all:
                why = 'all'
            elif not st:
                why = 'MR no longer watched (merged, closed or you were removed)'
            elif snap.get('approved_by_me'):
                why = 'you approved it'
            elif st.get('parked'):
                why = 'parked'
            elif age_days > cfg['worktree_max_age_days']:
                why = f'unused for {age_days:.0f} days'
            if why:
                worktree.remove(cfg, p)
                removed.append({'path': str(p), 'iid': m['iid'], 'why': why})
            else:
                kept.append({'path': str(p), 'iid': m['iid']})
        out({'removed': removed, 'kept': kept})


def cmd_stats(args):
    cfg, gl, state = ctx(args)
    me = state['me']
    now = now_utc()
    try:
        start, end, label = review_stats.parse_period(args.period, now)
    except ValueError as e:
        raise SystemExit(str(e))
    since = logic.iso(start)
    mrs = gl.paged(f'projects/{gl.pid}/merge_requests?reviewer_username={me}&state=all&updated_after={since}')
    mrs = [m for m in mrs if m['author']['username'] != me]
    base = f'projects/{gl.pid}/merge_requests'
    with ThreadPoolExecutor(max_workers=6) as pool:
        discussions = list(pool.map(lambda m: gl.paged(f'{base}/{m["iid"]}/discussions'), mrs))
    result = review_stats.compute(list(zip(mrs, discussions)), me, start, end)
    if args.json:
        out(review_stats.to_json(result))
    else:
        print(review_stats.render(result, label))


def cmd_schedule(args):
    cfg = load_config(args.config)
    local_now = datetime.now().astimezone()
    out({'cron': logic.cron_for(cfg['active_hours'], cfg['poll_minutes']),
         'active_hours': cfg['active_hours'],
         'active_now': logic.in_active_hours(cfg['active_hours'], local_now)})


def cmd_ack(args):
    cfg, gl, state = ctx(args)
    st = _mrs(state, args.iid)
    was = st.pop('okay_reported', None)
    save_state(cfg, state)
    out({'iid': args.iid, 'was_waiting': bool(was)})


def cmd_number(args):
    """Record the numbers the agent just showed the user, in order."""
    cfg, gl, state = ctx(args)
    pairs = []
    for ref in args.iids:
        iid = int(ref.lstrip('!'))
        snap = ((state.get('mrs', {}).get(str(iid)) or {}).get('snapshot')) or {}
        pairs.append((iid, snap.get('sha')))
    store_numbering(state, pairs)
    save_state(cfg, state)
    out(state['numbering']['items'])


def cmd_approve(args):
    """Approve on the user's explicit say-so, pinned to the head they were shown."""
    cfg, gl, state = ctx(args)
    mr = gl.mr(args.iid)
    expected = args.shown_sha or ((state.get('mrs', {}).get(str(args.iid)) or {}).get('snapshot') or {}).get('sha')
    if not expected:
        raise SystemExit(f'!{args.iid}: no head SHA on record to pin the approval to; run `mra desk` first')
    if mr['sha'] != expected:
        raise SystemExit(f'!{args.iid} "{mr["title"]}": head moved from {expected[:10]} to {mr["sha"][:10]} '
                         f'since it was shown to you. Not approving; re-check it first.')
    gl.approve(args.iid, expected)
    st = state.setdefault('mrs', {}).setdefault(str(args.iid), {})
    st['approved_sha'] = expected
    st.pop('pending', None)
    save_state(cfg, state)
    out({'iid': args.iid, 'title': mr['title'], 'approved_at_sha': expected, 'url': mr['web_url']})


# --------------------------------------------------------------------------
# park / baseline / dismiss

def cmd_park(args):
    cfg, gl, state = ctx(args)
    mr = gl.mr(args.iid)
    st = state.setdefault('mrs', {}).setdefault(str(args.iid), {})
    st['parked'] = {'sha': mr['sha'], 'reason': ' '.join(args.reason) or None, 'at': logic.iso(now_utc())}
    st.pop('pending', None)
    save_state(cfg, state)
    out({'iid': args.iid, 'parked_at_sha': mr['sha'], 'reason': st['parked']['reason']})


def cmd_unpark(args):
    cfg, gl, state = ctx(args)
    st = state.get('mrs', {}).get(str(args.iid)) or {}
    was = st.pop('parked', None)
    save_state(cfg, state)
    out({'iid': args.iid, 'was_parked': bool(was)})


def cmd_baseline(args):
    """Treat MRs as already reviewed at their current head, without reviewing."""
    cfg, gl, state = ctx(args)
    rows, *_ = collect(cfg, gl, state)
    marked = []
    for r in rows:
        if args.iids and r['iid'] not in args.iids:
            continue
        if r['kind'] == 'review':
            r['st']['baseline_sha'] = r['snap']['sha']
            r['st'].pop('pending', None)
            marked.append(r['iid'])
    save_state(cfg, state)
    out({'baselined': marked})


def cmd_dismiss(args):
    cfg, gl, state = ctx(args)
    st = _mrs(state, args.iid)
    st['review_blockers'] = 0
    save_state(cfg, state)
    out({'iid': args.iid, 'review_blockers': 0})


# --------------------------------------------------------------------------
# reports

def _age(ts, now):
    t = logic.parse_time(ts)
    if not t:
        return '?'
    d = (now - t).total_seconds() / 86400
    return f'{d:.0f}d' if d >= 1 else f'{d * 24:.0f}h'


def cmd_desk(args):
    cfg, gl, state = ctx(args)
    rows, versions, todos, now = collect(cfg, gl, state)
    save_state(cfg, state)
    rows.sort(key=lambda r: r['sort'])
    groups = {}
    for r in rows:
        groups.setdefault(logic.waiting_on(r['snap'], r['kind'], r['st'], r['scope']), []).append(r)
    titles = [('you', 'Waiting on you'), ('author', 'Waiting on the author'), ('parked', 'Parked'),
              ('approved', 'Approved by you'), ('draft', 'Drafts'), ('assignee', 'You are assignee (not watched)'),
              ('own', 'Yours')]
    lines = [f'Release order: {", ".join(logic.fmt_version(v) for v in versions) or "none"}', '']
    numbered = []
    for key, title in titles:
        items = groups.get(key) or []
        if not items:
            continue
        lines.append(f'**{title}** ({len(items)})')
        for r in items:
            s, st = r['snap'], r['st']
            bits = [f'[!{s["iid"]}]({s["url"]}) {s["title"][:70]}', f'@{s["author"]}', f'→ {s["target_branch"]}']
            if key == 'you':
                bits.append(r['kind'] or 'ready to approve?')
            if key == 'author':
                since = logic.waiting_on_author_since(s, st)
                n = sum(1 for t in s['my_threads'] if not t['resolved'])
                bits.append(f'{n} open thread(s), waiting {_age(since, now)}')
            if key == 'parked':
                bits.append(f'reason: {st["parked"].get("reason") or "-"}')
            if r['extra'].get('rerequest'):
                bits.append('RE-REVIEW REQUESTED')
            numbered.append((s['iid'], s['sha']))
            lines.append(f'{len(numbered)}. ' + ' · '.join(bits))
        lines.append('')
    store_numbering(state, numbered)
    save_state(cfg, state)
    print('\n'.join(lines).rstrip())


def cmd_stale(args):
    cfg, gl, state = ctx(args)
    now = now_utc()
    items = []
    for key, st in (state.get('mrs') or {}).items():
        snap = st.get('snapshot')
        if not snap or st.get('parked') or snap.get('approved_by_me'):
            continue
        since = logic.waiting_on_author_since(snap, st)
        t = logic.parse_time(since)
        if t and (now - t).days >= cfg['stale_days']:
            items.append({'iid': snap['iid'], 'title': snap['title'], 'url': snap['url'], 'author': snap['author'],
                          'waiting_days': (now - t).days,
                          'open_threads': sum(1 for x in snap['my_threads'] if not x['resolved'])})
    items.sort(key=lambda x: -x['waiting_days'])
    if args.mark:
        state['last_digest_date'] = datetime.now().astimezone().date().isoformat()
        save_state(cfg, state)
    out(items)


# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(prog='mra', description='MR manager: GitLab review desk for one reviewer.')
    ap.add_argument('--config', help='config file (default $MRA_CONFIG or ~/.config/gitlab-mr-agent/config.json)')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('poll', help='check GitLab and print ranked actions as JSON')
    p.add_argument('--max', type=int, help='max subagent actions this cycle (default: config max_agent_actions)')
    p.add_argument('--force', action='store_true', help='poll even outside active_hours')
    p.set_defaults(fn=cmd_poll)

    p = sub.add_parser('stats', help="your review stats: week, month, quarter, year, or e.g. 14d, 6w, 3m")
    p.add_argument('period', nargs='?', default='month')
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_stats)

    p = sub.add_parser('schedule', help='cron expression for the loop, from active_hours and poll_minutes')
    p.set_defaults(fn=cmd_schedule)

    p = sub.add_parser('done', help="record that an MR's pending action was handled; marks its To-Dos done")
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.add_argument('--blockers', type=int, help='merge blockers the review found (kept until threads exist or dismissed)')
    p.add_argument('--keep-todos', action='store_true')
    p.add_argument('--okay-to-approve', action='store_true',
                   help='you told the user it is okay to approve; it stays on their list until they act')
    p.set_defaults(fn=cmd_done)

    p = sub.add_parser('ack', help="drop an MR from the user's waiting list until it changes (\"not now\")")
    p.add_argument('iid', metavar='REF')
    p.set_defaults(fn=cmd_ack)

    p = sub.add_parser('resolve', help='resolve discussions you started (refuses anyone else\'s)')
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.add_argument('discussion_ids', nargs='+')
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser('todo-done', help='mark To-Dos done by id, or --noise for bot To-Dos on watched MRs')
    p.add_argument('todo_ids', nargs='*', type=int)
    p.add_argument('--noise', action='store_true')
    p.set_defaults(fn=cmd_todo_done)

    p = sub.add_parser('ready', help='fresh ready-to-approve check for one MR')
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.set_defaults(fn=cmd_ready)

    p = sub.add_parser('prompt', help='prepare the review worktree and print the subagent prompt')
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.add_argument('--kind', choices=['review', 'review_delta', 'verify_threads', 'reapprove_check'])
    p.set_defaults(fn=cmd_prompt)

    p = sub.add_parser('worktree', help='manage review worktrees')
    wsub = p.add_subparsers(dest='wt_cmd', required=True)
    w = wsub.add_parser('add')
    w.add_argument('iid', metavar='REF')
    wsub.add_parser('list')
    w = wsub.add_parser('cleanup', help='remove worktrees of MRs no longer waiting on you')
    w.add_argument('--iid', type=int)
    w.add_argument('--all', action='store_true')
    p.set_defaults(fn=cmd_worktree)

    p = sub.add_parser('number', help='record the order MRs were just shown in (so "2 approve" works)')
    p.add_argument('iids', nargs='+', metavar='IID')
    p.set_defaults(fn=cmd_number)

    p = sub.add_parser('approve', help='approve an MR the user named (list number or !iid), pinned to the shown head')
    p.add_argument('iid', metavar='REF')
    p.set_defaults(fn=cmd_approve)

    p = sub.add_parser('park', help='ignore an MR until its head commit changes')
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.add_argument('reason', nargs='*')
    p.set_defaults(fn=cmd_park)

    p = sub.add_parser('unpark')
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.set_defaults(fn=cmd_unpark)

    p = sub.add_parser('baseline', help='mark unreviewed MRs as seen without reviewing them')
    p.add_argument('iids', nargs='*', type=int)
    p.set_defaults(fn=cmd_baseline)

    p = sub.add_parser('dismiss', help="clear the manager's unraised review blockers for an MR")
    p.add_argument('iid', metavar='REF', help='list number from the last desk/update, or !iid')
    p.set_defaults(fn=cmd_dismiss)

    sub.add_parser('desk', help='markdown overview of every watched MR').set_defaults(fn=cmd_desk)

    p = sub.add_parser('stale', help='MRs waiting on the author for more than stale_days')
    p.add_argument('--mark', action='store_true', help="record today's digest as sent")
    p.set_defaults(fn=cmd_stale)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == '__main__':
    main()

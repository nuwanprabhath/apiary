"""Review stats over a time window: how the user has been reviewing MRs.

`compute()` is pure (raw MR + discussion objects in, numbers out) so it can be
tested; `render()` turns the numbers into chat-friendly markdown with text
bar charts.
"""

import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from statistics import median

PERIODS = {'week': 7, 'month': 30, 'quarter': 90, '3months': 90, 'year': 365}
WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def parse_period(text, now):
    """`week`, `month`, `quarter`, `30d`, `12w` -> (start, end, label)."""
    text = (text or 'month').strip().lower()
    if text in PERIODS:
        days = PERIODS[text]
    else:
        m = re.fullmatch(r'(\d+)\s*([dwm])', text)
        if not m:
            raise ValueError(f'unknown period {text!r}: use week, month, quarter, year, or e.g. 30d, 6w, 3m')
        days = int(m.group(1)) * {'d': 1, 'w': 7, 'm': 30}[m.group(2)]
    return now - timedelta(days=days), now, f'last {days} days'


def _t(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None


def _events(discussions, me):
    requests, mine, approvals, resets, threads = [], [], [], [], []
    req_re = re.compile(r'requested review from .*@' + re.escape(me) + r'\b')
    for d in discussions:
        notes = d.get('notes') or []
        if not notes:
            continue
        first = notes[0]
        if not first.get('system') and first['author']['username'] == me and first.get('resolvable'):
            threads.append((_t(first['created_at']), bool(first.get('resolved'))))
        for n in notes:
            at, who, body = _t(n['created_at']), n['author']['username'], n.get('body') or ''
            if n.get('system'):
                if req_re.search(body):
                    requests.append(at)
                elif who == me and body.startswith('approved this merge request'):
                    approvals.append(at)
                elif f'reset approvals from @{me}' in body:
                    resets.append(at)
            elif who == me:
                mine.append(at)
    return sorted(requests), sorted(mine), sorted(approvals), sorted(resets), threads


def _response_times(requests, activity):
    """Pair each review request with your next note or approval.

    A request superseded by a newer one before you responded doesn't count,
    so a burst of re-requests isn't scored as several slow responses.
    """
    out = []
    for i, r in enumerate(requests):
        nxt = next((a for a in activity if a >= r), None)
        if nxt is None:
            continue
        later = requests[i + 1] if i + 1 < len(requests) else None
        if later and later <= nxt:
            continue
        out.append((r, nxt))
    return out


def compute(items, me, start, end):
    """items: [(mr, discussions)] for MRs where `me` is a reviewer."""
    inside = lambda x: x is not None and start <= x < end
    rows = []
    for mr, discussions in items:
        if mr['author']['username'] == me:
            continue
        requests, mine, approvals, resets, threads = _events(discussions, me)
        activity = sorted(mine + approvals)
        if not any(inside(a) for a in activity):
            continue
        reqs = requests or [_t(mr['created_at'])]
        responses = [(r, a) for r, a in _response_times(reqs, activity) if inside(a)]
        approvals_in = [a for a in approvals if inside(a)]
        to_approve = []
        for a in approvals_in:
            prior = [r for r in reqs if r <= a]
            if prior:
                to_approve.append(a - max(prior))
        merged_at = _t(mr.get('merged_at'))
        rows.append({
            'iid': mr['iid'], 'url': mr['web_url'], 'title': mr['title'],
            'author': mr['author']['username'], 'target': mr['target_branch'], 'state': mr['state'],
            'created': _t(mr['created_at']), 'merged': merged_at,
            'responses': [a - r for r, a in responses],
            'to_approve': to_approve,
            'approved': bool(approvals_in),
            'approve_to_merge': (merged_at - approvals[-1]) if merged_at and approvals and merged_at > approvals[-1] else None,
            'requests': len([r for r in requests if inside(r)]),
            'resets': len([r for r in resets if inside(r)]),
            'notes': len([m for m in mine if inside(m)]),
            'threads': [(at, resolved) for at, resolved in threads if inside(at)],
            'activity': [a for a in activity if inside(a)],
        })
    return summarise(rows, start, end)


def _spread(pairs):
    """[(duration, row)] -> median/min/max with the MRs at the extremes."""
    if not pairs:
        return None
    pairs = sorted(pairs, key=lambda p: p[0])
    return {'median': median(p[0] for p in pairs), 'min': pairs[0], 'max': pairs[-1], 'n': len(pairs)}


def summarise(rows, start, end):
    week_start = lambda d: (d - timedelta(days=d.weekday())).date()
    weeks = Counter()
    weekdays = Counter()
    hours = Counter()
    for r in rows:
        for wk in {week_start(a.astimezone()) for a in r['activity']}:
            weeks[wk] += 1
        for a in r['activity']:
            local = a.astimezone()
            weekdays[local.weekday()] += 1
            hours[local.hour] += 1
    threads = [t for r in rows for t in r['threads']]
    return {
        'start': start, 'end': end, 'rows': rows,
        'reviewed': len(rows),
        'approved': sum(r['approved'] for r in rows),
        'merged': sum(r['state'] == 'merged' for r in rows),
        'open': sum(r['state'] == 'opened' for r in rows),
        'closed': sum(r['state'] == 'closed' for r in rows),
        'response': _spread([(d, r) for r in rows for d in r['responses']]),
        'to_approve': _spread([(d, r) for r in rows for d in r['to_approve']]),
        'approve_to_merge': _spread([(r['approve_to_merge'], r) for r in rows if r['approve_to_merge']]),
        'lifetime': _spread([(r['merged'] - r['created'], r) for r in rows if r['merged']]),
        'notes': sum(r['notes'] for r in rows),
        'threads_opened': len(threads),
        'threads_resolved': sum(1 for _, resolved in threads if resolved),
        'most_threads': max(rows, key=lambda r: len(r['threads']), default=None),
        'requests': sum(r['requests'] for r in rows),
        'most_rounds': max(rows, key=lambda r: r['requests'], default=None),
        'resets': sum(r['resets'] for r in rows),
        'authors': Counter(r['author'] for r in rows).most_common(),
        'targets': Counter(r['target'] for r in rows).most_common(),
        'weeks': sorted(weeks.items()),
        'weekdays': weekdays,
        'hours': hours,
    }


# --------------------------------------------------------------------------
# Rendering

def fmt_dur(d):
    s = d.total_seconds()
    if s < 3600:
        return f'{max(1, round(s / 60))}m'
    if s < 48 * 3600:
        return f'{s / 3600:.1f}h'
    return f'{s / 86400:.1f}d'


def _link(r):
    return f'[!{r["iid"]}]({r["url"]})'


def _timing_row(label, sp):
    if not sp:
        return f'| {label} | - | - | - | 0 |'
    lo, hi = sp['min'], sp['max']
    return (f'| {label} | **{fmt_dur(sp["median"])}** | {fmt_dur(lo[0])} {_link(lo[1])} '
            f'| {fmt_dur(hi[0])} {_link(hi[1])} | {sp["n"]} |')


def _bars(pairs, width=24):
    """Text bar chart; pairs = [(label, count)]."""
    top = max((c for _, c in pairs), default=0) or 1
    pad = max((len(str(l)) for l, _ in pairs), default=0)
    return '\n'.join(f'{str(l).ljust(pad)}  {"█" * max(1 if c else 0, round(c / top * width))} {c}'
                     for l, c in pairs)


def render(s, label):
    if not s['reviewed']:
        return f'**MR review stats · {label}**\n\nNo review activity in this period.'
    pct = lambda x, y: f'{round(100 * x / y)}%' if y else '-'
    out = [
        f'**MR review stats · {label}** ({s["start"].astimezone():%d %b} to {s["end"].astimezone():%d %b})',
        '',
        '| Reviewed | You approved | Merged | Still open | Closed unmerged |',
        '|---|---|---|---|---|',
        f'| **{s["reviewed"]}** | {s["approved"]} | {s["merged"]} | {s["open"]} | {s["closed"]} |',
        '',
        '| Time | Median | Fastest | Slowest | Count |',
        '|---|---|---|---|---|',
        _timing_row('Review request → your first response', s['response']),
        _timing_row('Review request → your approval', s['to_approve']),
        _timing_row('Your approval → merged', s['approve_to_merge']),
        _timing_row('MR opened → merged', s['lifetime']),
        '',
        '| Threads you opened | Resolved | Your comments | Review requests | Per MR | Approvals reset by a push |',
        '|---|---|---|---|---|---|',
        f'| {s["threads_opened"]} | {s["threads_resolved"]} ({pct(s["threads_resolved"], s["threads_opened"])}) '
        f'| {s["notes"]} | {s["requests"]} | {s["requests"] / s["reviewed"]:.1f} | {s["resets"]} |',
        '',
    ]
    notes = []
    if s['most_threads'] and s['most_threads']['threads']:
        mt = s['most_threads']
        notes.append(f'Most discussed: {_link(mt)} ({len(mt["threads"])} threads from you)')
    if s['requests'] and s['most_rounds']['requests'] > 1:
        mr = s['most_rounds']
        notes.append(f'most review rounds: {_link(mr)} ({mr["requests"]})')
    if s['weekdays']:
        busiest = max(s['weekdays'], key=s['weekdays'].get)
        peak = max(s['hours'], key=s['hours'].get)
        notes.append(f'busiest day {WEEKDAY_NAMES[busiest]}, peak hour {peak:02d}:00')
    if notes:
        out += ['; '.join(notes) + '.', '']
    out += ['Authors: ' + ' · '.join(f'@{a} {n}' for a, n in s['authors'][:6]), '',
            'Branches: ' + ' · '.join(f'{b} {n}' for b, n in s['targets'][:5]), '',
            'Times are wall-clock, so nights and weekends count.']
    if len(s['weeks']) > 1:
        out += ['', 'MRs you touched per week (week starting):', '```',
                _bars([(f'{w:%d %b}', n) for w, n in s['weeks']]), '```']
    if s['weekdays']:
        out += ['', 'Review activity by weekday:', '```',
                _bars([(WEEKDAYS[d], s['weekdays'].get(d, 0)) for d in range(7)]), '```']
    return '\n'.join(out)


def to_json(s):
    def conv(v):
        if isinstance(v, timedelta):
            return round(v.total_seconds())
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, dict):
            return {str(k): conv(x) for k, x in v.items() if k != 'rows'}
        if isinstance(v, (list, tuple)):
            return [conv(x) for x in v]
        return v
    out = conv({k: v for k, v in s.items() if k != 'rows'})
    for key in ('response', 'to_approve', 'approve_to_merge', 'lifetime', 'most_threads', 'most_rounds'):
        v = s.get(key)
        if isinstance(v, dict) and 'min' in v:
            out[key] = {'median_s': round(v['median'].total_seconds()), 'n': v['n'],
                        'min_s': round(v['min'][0].total_seconds()), 'min_iid': v['min'][1]['iid'],
                        'max_s': round(v['max'][0].total_seconds()), 'max_iid': v['max'][1]['iid']}
        elif isinstance(v, dict) and 'iid' in v:
            out[key] = v['iid']
    out['mrs'] = [{'iid': r['iid'], 'author': r['author'], 'state': r['state'], 'approved': r['approved'],
                   'threads': len(r['threads']), 'requests': r['requests']} for r in s['rows']]
    return out

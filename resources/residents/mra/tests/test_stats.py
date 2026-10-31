import unittest
from datetime import datetime, timedelta, timezone

from mra import stats

ME = 'me'
T0 = datetime(2026, 10, 20, tzinfo=timezone.utc)


def note(nid, who, body, hours, system=False, resolvable=False, resolved=False):
    at = (T0 + timedelta(hours=hours)).isoformat().replace('+00:00', 'Z')
    return {'id': nid, 'author': {'username': who}, 'body': body, 'system': system, 'created_at': at,
            'resolvable': resolvable, 'resolved': resolved}


def mr(iid, author='alice', state='merged', merged_h=30):
    return {'iid': iid, 'web_url': f'u/{iid}', 'title': 't', 'author': {'username': author},
            'target_branch': 'dev/1.0.12', 'state': state, 'created_at': T0.isoformat(),
            'merged_at': (T0 + timedelta(hours=merged_h)).isoformat() if state == 'merged' else None}


class Compute(unittest.TestCase):
    def test_review_flow(self):
        discs = [
            {'notes': [note(1, 'alice', 'requested review from @me and @bob', 1, system=True)]},
            {'notes': [note(2, ME, 'fix this', 3, resolvable=True, resolved=True),
                       note(3, 'alice', 'done', 5)]},
            {'notes': [note(4, 'alice', 'requested review from @me', 6, system=True)]},
            {'notes': [note(5, 'alice', 'requested review from @me', 7, system=True)]},
            {'notes': [note(6, ME, 'approved this merge request', 9, system=True)]},
        ]
        s = stats.compute([(mr(1), discs), (mr(2, author=ME), discs)], ME, T0, T0 + timedelta(days=7))
        self.assertEqual(s['reviewed'], 1)  # own MR excluded
        self.assertEqual(s['approved'], 1)
        self.assertEqual(s['merged'], 1)
        # request@1 -> note@3 (2h); request@6 superseded by request@7 -> approval@9 (2h)
        self.assertEqual(sorted(s['rows'][0]['responses']), [timedelta(hours=2), timedelta(hours=2)])
        self.assertEqual(s['rows'][0]['to_approve'], [timedelta(hours=2)])
        self.assertEqual(s['approve_to_merge']['median'], timedelta(hours=21))
        self.assertEqual((s['threads_opened'], s['threads_resolved']), (1, 1))
        self.assertIn('| **1** | 1 | 1 |', stats.render(s, 'last 7 days'))

    def test_activity_outside_window_is_ignored(self):
        discs = [{'notes': [note(1, ME, 'old', -500)]}]
        s = stats.compute([(mr(3), discs)], ME, T0, T0 + timedelta(days=7))
        self.assertEqual(s['reviewed'], 0)

    def test_periods(self):
        now = T0
        self.assertEqual(stats.parse_period('week', now)[0], now - timedelta(days=7))
        self.assertEqual(stats.parse_period('3m', now)[0], now - timedelta(days=90))
        with self.assertRaises(ValueError):
            stats.parse_period('soon', now)


if __name__ == '__main__':
    unittest.main()

import unittest
from datetime import datetime, timezone

from mra import logic
from mra.config import DEFAULTS

ME = 'me'
CFG = dict(DEFAULTS, project='g/p', repo_path='/r')
NOW = datetime(2026, 10, 29, tzinfo=timezone.utc)


def note(nid, who, body='x', system=False, at='2026-10-20T00:00:00Z', resolvable=False, resolved=False, pos=None):
    return {'id': nid, 'author': {'username': who}, 'body': body, 'system': system, 'created_at': at,
            'resolvable': resolvable, 'resolved': resolved, 'position': pos}


def mr(**kw):
    base = {'iid': 1, 'title': 'feat: thing', 'description': '', 'web_url': 'https://gl/g/p/-/merge_requests/1',
            'author': {'username': 'alice'}, 'assignees': [], 'reviewers': [{'username': ME}],
            'source_branch': 'f', 'target_branch': 'dev/1.0.12', 'labels': [], 'draft': False,
            'sha': 'a' * 40, 'updated_at': '2026-10-28T00:00:00Z', 'created_at': '2026-10-01T00:00:00Z',
            'has_conflicts': False, 'detailed_merge_status': 'mergeable',
            'head_pipeline': {'id': 9, 'status': 'success', 'web_url': 'u'}}
    base.update(kw)
    return base


def snap(m=None, discussions=(), approved_by=(), reviewers=()):
    approvals = {'approved_by': [{'user': {'username': u}} for u in approved_by]}
    revs = [{'user': {'username': u}, 'state': s} for u, s in reviewers]
    return logic.snapshot(m or mr(), approvals, revs, list(discussions), ME, CFG)


def my_thread(did='d1', resolved=False, replies=()):
    first = note(10, ME, 'please fix', resolvable=True, resolved=resolved,
                 pos={'new_path': 'a.js', 'new_line': 3})
    return {'id': did, 'notes': [first, *replies]}


class Tickets(unittest.TestCase):
    def test_extracts_issue_refs_not_mr_refs(self):
        got = logic.extract_tickets('fix: #2836 thing', 'Closes #2900, see !1250 and '
                                    'https://gl/g/p/-/work_items/3000', 'https://gl/g/p')
        self.assertEqual(got, ['https://gl/g/p/-/work_items/3000', 'https://gl/g/p/-/work_items/2836',
                               'https://gl/g/p/-/work_items/2900'])


class Urgency(unittest.TestCase):
    def test_lowest_active_release_first(self):
        mrs = [{'target_branch': b, 'updated_at': '2026-10-28T00:00:00Z'}
               for b in ['dev/1.0.13', 'paratoo/dev/1.0.11', 'dev/1.0.12', 'main']]
        mrs.append({'target_branch': 'dev/1.0.9', 'updated_at': '2025-01-01T00:00:00Z'})  # stale
        self.assertEqual(logic.open_release_versions(mrs, CFG, NOW), [(1, 0, 11), (1, 0, 12), (1, 0, 13)])

    def test_rank_order(self):
        versions = [(1, 0, 11), (1, 0, 12), (1, 0, 13)]
        s12 = snap(mr(iid=5, target_branch='dev/1.0.12'))
        s11 = snap(mr(iid=6, target_branch='paratoo/dev/1.0.11'))
        s13_label12 = snap(mr(iid=7, target_branch='dev/1.0.13', labels=['release::1.0.12']))
        smain = snap(mr(iid=8, target_branch='main'))
        k = lambda s, rr=False: logic.urgency(s, versions, rr)[0]
        self.assertLess(k(s11), k(s12))
        self.assertLess(k(s12, rr=True), k(s12))
        self.assertEqual(k(s13_label12)[0], 1)  # label pulls it into the 1.0.12 tier
        self.assertLess(k(s13_label12), k(smain))

    def test_rank_survives_json_round_trip(self):
        import json
        versions = [(1, 0, 11), (1, 0, 12)]
        s = json.loads(json.dumps(snap(mr(target_branch='main', labels=['release::1.0.11']))))
        self.assertEqual(logic.urgency(s, versions, False)[0][0], 0)

    def test_bumps(self):
        s = snap(mr(title='fix: crash', labels=['Bug'], description='Needed for release ASAP'))
        self.assertIn('Bug label', s['bump_reasons'])
        self.assertIn('fix in title', s['bump_reasons'])
        self.assertIn('"asap" in title/description', s['bump_reasons'])


class Classify(unittest.TestCase):
    def k(self, s, st=None, todos=()):
        return logic.classify(s, st or {}, list(todos), ME)[0]

    def test_new_mr_gets_review(self):
        self.assertEqual(self.k(snap()), 'review')

    def test_reviewed_mr_then_quiet_after_ready_reported(self):
        s = snap()
        self.assertEqual(self.k(s, {'reviewed_sha': s['sha']}), 'approve_check')
        self.assertIsNone(self.k(s, {'reviewed_sha': s['sha'], 'ready_reported_sha': s['sha']}))

    def test_running_pipeline_finishing_reports_again(self):
        s = snap(mr(head_pipeline={'id': 1, 'status': 'success', 'web_url': 'u'}))
        st = {'reviewed_sha': s['sha'], 'ready_reported_sha': s['sha'], 'ready_reported_pipeline': 'running'}
        self.assertEqual(self.k(s, st), 'approve_check')
        st['ready_reported_pipeline'] = 'success'
        self.assertIsNone(self.k(s, st))

    def test_open_thread_verified_once_per_change(self):
        s = snap(discussions=[my_thread()])
        self.assertIsNone(self.k(s))  # no push, no reply: waiting on the author
        s = snap(discussions=[my_thread(), {'id': 'p', 'notes': [
            note(1, 'alice', 'added 1 commit', system=True, at='2026-10-21T00:00:00Z')]}])
        self.assertEqual(self.k(s), 'verify_threads')
        st = {'verified_sha': s['sha'], 'verified_note_id': 0}
        self.assertIsNone(self.k(s, st))
        s2 = snap(discussions=[my_thread(replies=[note(11, 'alice', 'done')])])
        self.assertEqual(self.k(s2, st), 'verify_threads')

    def test_fresh_thread_at_head_is_not_reverified(self):
        d = [{'id': 'p', 'notes': [note(1, 'alice', 'added 1 commit', system=True, at='2026-10-19T00:00:00Z')]},
             my_thread()]  # my thread note is 2026-10-20, after the push
        self.assertIsNone(self.k(snap(discussions=d), {'reviewed_sha': 'a' * 40, 'ready_reported_sha': 'a' * 40}))

    def test_push_after_my_thread_reverifies_once(self):
        d = [my_thread(),
             {'id': 'p', 'notes': [note(1, 'alice', 'added 1 commit', system=True, at='2026-10-21T00:00:00Z')]}]
        s = snap(discussions=d)
        self.assertEqual(self.k(s, {'looked_sha': 'old'}), 'verify_threads')
        self.assertIsNone(self.k(s, {'looked_sha': s['sha'], 'verified_note_id': 0, 'ready_reported_sha': s['sha']}))

    def test_bot_reply_is_not_activity(self):
        s = snap(discussions=[my_thread(replies=[note(11, 'project_123_bot_abc', 'lgtm')])])
        self.assertIsNone(self.k(s, {'verified_sha': s['sha'], 'verified_note_id': 0}))

    def test_approved_is_skipped_unless_rerequested(self):
        s = snap(approved_by=[ME])
        self.assertIsNone(self.k(s))
        rr = [{'id': 1, 'action_name': 'review_requested'}]
        self.assertIsNotNone(self.k(s, {}, rr))
        self.assertIsNone(self.k(s, {'handled_todo_ids': [1]}, rr))

    def test_parked_until_new_commits(self):
        s = snap()
        self.assertIsNone(self.k(s, {'parked': {'sha': s['sha']}}))
        self.assertEqual(self.k(s, {'parked': {'sha': 'b' * 40}}), 'review')

    def test_rerequest_overrides_park(self):
        s = snap()
        rr = [{'id': 1, 'action_name': 'review_requested'}]
        self.assertEqual(self.k(s, {'parked': {'sha': s['sha']}}, rr), 'review')

    def test_approval_reset_by_push(self):
        d = [{'id': 's1', 'notes': [note(1, ME, 'approved this merge request', system=True, at='2026-10-20T00:00:00Z')]},
             {'id': 's2', 'notes': [note(2, 'alice', 'reset approvals from @me by pushing to the branch',
                                         system=True, at='2026-10-21T00:00:00Z')]}]
        s = snap(discussions=d)
        self.assertEqual(self.k(s, {'reviewed_sha': 'old'}), 'reapprove_check')
        self.assertNotEqual(self.k(s, {'reviewed_sha': 'old', 'reset_checked_sha': s['sha']}), 'reapprove_check')

    def test_push_after_approval_without_reset_note(self):
        sha2 = 'b' * 40
        d = [{'id': 's1', 'notes': [note(1, ME, 'approved this merge request', system=True, at='2026-10-20T00:00:00Z')]},
             {'id': 's2', 'notes': [note(2, 'alice', f'added 1 commit\n\n<ul><li>{sha2} - ci: tag</li></ul>',
                                         system=True, at='2026-10-21T00:00:00Z')]}]
        s = snap(mr(sha=sha2), discussions=d)
        self.assertEqual(s['commits_since_my_approval'], [sha2])
        self.assertEqual(self.k(s, {'ready_reported_sha': sha2}), 'reapprove_check')

    def test_rerequest_with_new_commits_and_no_threads_gets_delta(self):
        s = snap()
        rr = [{'id': 1, 'action_name': 'review_requested'}]
        self.assertEqual(self.k(s, {'reviewed_sha': 'old'}, rr), 'review_delta')

    def test_submitted_review_counts_as_engaged(self):
        s = snap(reviewers=[(ME, 'reviewed')])
        self.assertEqual(self.k(s), 'approve_check')


class Ready(unittest.TestCase):
    def test_unraised_review_blockers_block_until_threads_exist(self):
        s = snap()
        r = logic.ready_info(s, {'reviewed_sha': s['sha'], 'review_blockers': 2}, ME)
        self.assertFalse(r['ok'])
        s2 = snap(discussions=[my_thread(resolved=True)])
        self.assertTrue(logic.ready_info(s2, {'review_blockers': 2}, ME)['ok'])

    def test_pipeline_and_rebase(self):
        s = snap(mr(head_pipeline={'id': 1, 'status': 'running'}, detailed_merge_status='need_rebase'))
        r = logic.ready_info(s, {}, ME)
        self.assertEqual(r['not_ready_because'], ['pipeline running', 'needs rebase onto target'])

    def test_comments_after_my_approval_are_surfaced(self):
        d = [{'id': 's1', 'notes': [note(1, ME, 'approved this merge request', system=True, at='2026-10-28T05:29:00Z')]},
             {'id': 'n1', 'notes': [note(5, 'luke', 'need an e2e run; holding off approving', at='2026-10-28T06:02:00Z')]},
             {'id': 'n0', 'notes': [note(4, 'luke', 'old chatter', at='2026-10-27T00:00:00Z')]},
             {'id': 'b1', 'notes': [note(6, 'project_1_bot_x', 'bot noise', at='2026-10-28T07:00:00Z')]}]
        r = logic.ready_info(snap(discussions=d), {}, ME)
        self.assertEqual([c['id'] for c in r['comments_since_you_looked']], [5])
        self.assertTrue(r['comments_since_you_looked'][0]['url'].endswith('#note_5'))

    def test_others_requested_changes_reported_not_blocking(self):
        s = snap(reviewers=[('luke', 'requested_changes'), (ME, 'unreviewed')])
        r = logic.ready_info(s, {}, ME)
        self.assertTrue(r['ok'])
        self.assertEqual(r['others_requested_changes'], ['luke'])


class Refs(unittest.TestCase):
    def test_numbers_and_iids(self):
        from mra.cli import resolve_ref, store_numbering
        state = {}
        store_numbering(state, [(1524, 'a'), (767, 'b')])
        self.assertEqual(resolve_ref(state, '2'), (767, 'b'))
        self.assertEqual(resolve_ref(state, '!2'), (2, None))
        self.assertEqual(resolve_ref(state, '1191'), (1191, None))


class Hours(unittest.TestCase):
    ACTIVE = {'days': [0, 1, 2, 3, 4], 'start': '09:00', 'end': '18:00'}

    def test_window(self):
        from datetime import datetime
        thu = lambda h, m=0: datetime(2026, 10, 29, h, m)
        self.assertTrue(logic.in_active_hours(self.ACTIVE, thu(9)))
        self.assertTrue(logic.in_active_hours(self.ACTIVE, thu(17, 59)))
        self.assertFalse(logic.in_active_hours(self.ACTIVE, thu(18)))
        self.assertFalse(logic.in_active_hours(self.ACTIVE, thu(8, 59)))
        self.assertFalse(logic.in_active_hours(self.ACTIVE, datetime(2026, 10, 31, 12)))  # Saturday
        self.assertTrue(logic.in_active_hours(None, datetime(2026, 10, 31, 3)))

    def test_cron(self):
        self.assertEqual(logic.cron_for(self.ACTIVE, [7, 22, 37, 52]), '7,22,37,52 9-17 * * 1,2,3,4,5')
        self.assertEqual(logic.cron_for(None, [7]), '7 * * * *')


if __name__ == '__main__':
    unittest.main()

import contextlib
import io
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

from mra import cli, logic
from tests.test_logic import CFG, ME, mr, snap

SHA = 'a' * 40


class FakeGL:
    def __init__(self, sha=SHA):
        self.sha = sha
        self.approved = []

    def mr(self, iid):
        return {'sha': self.sha, 'title': 'feat: thing', 'web_url': 'https://gl/mr/1'}

    def approve(self, iid, sha):
        self.approved.append((iid, sha))

    def failed_jobs(self, pipeline_id):
        return []


def run(argv, state, gl, rows=None):
    cfg = dict(CFG, active_hours=None)
    buf = io.StringIO()
    def ctx(a):
        if isinstance(getattr(a, 'iid', None), str):
            a.iid, a.shown_sha = cli.resolve_ref(state, a.iid)
        return cfg, gl, state

    patches = [mock.patch.object(cli, 'ctx', ctx),
               mock.patch.object(cli, 'save_state', lambda c, s: None)]
    if rows is not None:
        patches.append(mock.patch.object(cli, 'collect',
                                         lambda c, g, s: (rows, [], [], datetime.now(timezone.utc))))
        patches.append(mock.patch.object(logic, 'in_active_hours', lambda a, n: True))
    with contextlib.ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        with contextlib.redirect_stdout(buf):
            cli.main(argv)
    return buf.getvalue()


def watched(state_extra=None, **mr_kw):
    s = snap(mr(**mr_kw))
    st = {'snapshot': s, **(state_extra or {})}
    row = {'iid': 1, 'snap': s, 'st': st, 'kind': None, 'extra': {'rerequest': False, 'unparked': False},
           'scope': None, 'sort': (0,), 'tier': 0, 'reasons': [], 'todos': []}
    return row, {'me': ME, 'mrs': {'1': st}}


class ApproveByNumber(unittest.TestCase):
    def test_bare_number_is_refused_with_the_fix(self):
        for ref in ('1', '#1', ' 3 '):
            gl = FakeGL()
            with self.assertRaises(SystemExit) as cm:
                run(['approve', ref], {'mrs': {}, 'numbering': {'items': [{'n': 1, 'iid': 1559, 'sha': SHA}]}}, gl)
            self.assertIn('Refusing to approve by list number', str(cm.exception))
            self.assertIn('mra approve !<iid>', str(cm.exception))
            self.assertEqual(gl.approved, [])

    def test_iid_approves_pinned_to_the_shown_sha(self):
        row, state = watched()
        gl = FakeGL()
        run(['approve', '!1'], state, gl)
        self.assertEqual(gl.approved, [(1, SHA)])

    def test_moved_head_is_refused(self):
        row, state = watched()
        gl = FakeGL(sha='b' * 40)
        with self.assertRaises(SystemExit):
            run(['approve', '!1'], state, gl)
        self.assertEqual(gl.approved, [])


class WhenGreen(unittest.TestCase):
    def test_records_without_approving(self):
        row, state = watched()
        gl = FakeGL()
        run(['approve', '!1', '--when-green'], state, gl)
        self.assertEqual(gl.approved, [])
        self.assertEqual(state['mrs']['1']['approve_when_green']['sha'], SHA)

    def test_cancel_removes_it(self):
        row, state = watched({'approve_when_green': {'sha': SHA, 'at': 'x'}})
        run(['approve', '!1', '--cancel-when-green'], state, FakeGL())
        self.assertNotIn('approve_when_green', state['mrs']['1'])

    def test_desk_marks_it(self):
        row, state = watched({'approve_when_green': {'sha': SHA, 'at': 'x'}})
        with mock.patch.object(cli, 'collect', lambda c, g, s: ([row], [], [], datetime.now(timezone.utc))):
            text = run(['desk'], state, FakeGL())
        self.assertIn('approve when green', text)

    def desk(self, pipeline_status):
        row, state = watched(head_pipeline={'id': 9, 'status': pipeline_status, 'web_url': 'u'})
        with mock.patch.object(cli, 'collect', lambda c, g, s: ([row], [], [], datetime.now(timezone.utc))):
            return run(['desk'], state, FakeGL())

    def test_desk_says_ready_rather_than_asking(self):
        text = self.desk('success')
        self.assertIn('Waiting on you', text)
        self.assertIn('ready to approve', text)
        self.assertNotIn('?', text)

    def test_desk_says_why_it_is_not_ready(self):
        text = self.desk('failed')
        self.assertIn('not ready to approve: pipeline failed', text)
        self.assertNotIn('?', text)

    def poll(self, pipeline_status, sha=SHA, pinned=SHA):
        row, state = watched({'approve_when_green': {'sha': pinned, 'at': 'x'}}, sha=sha,
                             head_pipeline={'id': 9, 'status': pipeline_status, 'web_url': 'u'})
        out = json.loads(run(['poll'], state, FakeGL(), rows=[row]))
        return [a for a in out['actions'] if a['kind'] == 'approve_when_green'], state

    def test_success_at_pinned_sha_is_ready(self):
        actions, state = self.poll('success')
        self.assertEqual(len(actions), 1)
        self.assertFalse(actions[0]['dropped'])
        self.assertIn('approve_when_green', state['mrs']['1'])

    def test_failed_is_dropped(self):
        for status in ('failed', 'canceled'):
            actions, state = self.poll(status)
            self.assertTrue(actions[0]['dropped'], status)
            self.assertIn(status, actions[0]['why'])
            self.assertNotIn('approve_when_green', state['mrs']['1'])

    def test_moved_head_is_dropped(self):
        actions, state = self.poll('success', pinned='c' * 40)
        self.assertTrue(actions[0]['dropped'])
        self.assertIn('head moved', actions[0]['why'])
        self.assertNotIn('approve_when_green', state['mrs']['1'])

    def test_running_stays_pending_without_an_action(self):
        actions, state = self.poll('running')
        self.assertEqual(actions, [])
        self.assertIn('approve_when_green', state['mrs']['1'])


if __name__ == '__main__':
    unittest.main()

import contextlib
import io
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from mra import cli, diffs, gitlab
from tests.test_logic import CFG, ME

SHA = 'a' * 40
REFS = {'base_sha': 'b' * 40, 'start_sha': 'c' * 40, 'head_sha': SHA}
DIFF = ('@@ -1,4 +1,5 @@\n'
        ' keep1\n'
        '-gone\n'
        '+new1\n'
        '+new2\n'
        ' keep2\n'
        ' keep3\n')
ENTRY = {'old_path': 'src/a.js', 'new_path': 'src/a.js', 'diff': DIFF}


class FakeGL:
    def __init__(self, sha=SHA):
        self.sha = sha
        self.calls = []
        self.drafts_list = []
        self.inflight = set()
        self.discussion_data = {'id': 'd1', 'notes': [
            {'id': 5, 'author': {'username': ME}, 'created_at': '2026-10-20T00:00:00Z', 'body': 'x >>> y',
             'system': False, 'resolvable': True, 'resolved': False}]}

    def mr(self, iid):
        return {'iid': iid, 'sha': self.sha, 'web_url': 'https://gl/mr/1',
                'diff_refs': dict(REFS, head_sha=self.sha)}

    def diffs(self, iid):
        return [ENTRY]

    def create_draft(self, iid, payload):
        self.calls.append(('create', payload))
        return {'id': 77}

    def drafts(self, iid):
        return self.drafts_list

    def update_draft(self, iid, did, payload):
        self.calls.append(('update', did, payload))
        return {'id': did}

    def delete_draft(self, iid, did):
        self.calls.append(('delete', did))

    def publish_drafts(self, iid):
        self.calls.append(('publish',))

    def discussion(self, iid, did):
        return self.discussion_data

    def reply(self, iid, did, body):
        self.calls.append(('reply', did, body))
        return {'id': 99}

    def resolve_discussion(self, iid, did):
        self.calls.append(('resolve', did))

    def raw_get(self, path, paginate=False, fields=()):
        self.calls.append(('raw_get', path, paginate, tuple(fields)))
        return '[{"id": 1}]'


def run(argv, gl, state=None):
    state = state if state is not None else {'me': ME, 'mrs': {}}
    buf = io.StringIO()

    def ctx(a):
        if isinstance(getattr(a, 'iid', None), str):
            a.iid, a.shown_sha = cli.resolve_ref(state, a.iid)
        return dict(CFG, active_hours=None), gl, state

    with mock.patch.object(cli, 'ctx', ctx), mock.patch.object(cli, 'save_state', lambda c, s: None), \
            contextlib.redirect_stdout(buf):
        try:
            cli.main(argv)
            code = 0
        except SystemExit as e:
            code = e.code
    text = buf.getvalue().strip()
    return code, (json.loads(text) if text.startswith(('{', '[')) else text), state


@contextlib.contextmanager
def body_file(text='looks off'):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d, 'body.md')
        p.write_text(text)
        yield str(p)


@contextlib.contextmanager
def action_nonce(value='n0nce', env_value=None):
    with tempfile.TemporaryDirectory() as d:
        Path(d, 'action.nonce').write_text(value)
        env = {'MRA_STATE_DIR': d, 'MRA_ACTION_NONCE': value if env_value is None else env_value}
        with mock.patch.dict(os.environ, env):
            yield Path(d, 'action.nonce')


class DiffLines(unittest.TestCase):
    def test_added_context_and_removed_lines(self):
        m = diffs.line_map(DIFF)
        self.assertEqual(m['added'], {2, 3})
        self.assertEqual(m['context'], {1: 1, 4: 3, 5: 4})
        self.assertEqual(m['removed'], {2})

    def test_position_for_added_has_only_new_line(self):
        pos = diffs.position(REFS, [ENTRY], 'src/a.js', 3, None)
        self.assertEqual(pos['new_line'], 3)
        self.assertNotIn('old_line', pos)

    def test_position_for_context_has_both_numbers(self):
        pos = diffs.position(REFS, [ENTRY], 'src/a.js', 4, None)
        self.assertEqual((pos['new_line'], pos['old_line']), (4, 3))

    def test_line_outside_the_diff_is_refused(self):
        with self.assertRaises(diffs.NotInDiff):
            diffs.position(REFS, [ENTRY], 'src/a.js', 40, None)
        with self.assertRaises(diffs.NotInDiff):
            diffs.position(REFS, [dict(ENTRY, old_path='x', new_path='x')], 'src/a.js', 1, None)

    def test_old_line_alone_targets_a_removed_line(self):
        pos = diffs.position(REFS, [ENTRY], 'src/a.js', None, 2)
        self.assertEqual(pos['old_line'], 2)
        self.assertNotIn('new_line', pos)


class DraftAdd(unittest.TestCase):
    def test_add_anchors_to_current_diff_refs_and_records_head(self):
        gl = FakeGL()
        with body_file() as f:
            code, res, state = run(['draft', 'add', '!1', '--file', 'src/a.js', '--line', '4', '--body-file', f], gl)
        self.assertEqual(code, 0)
        payload = gl.calls[0][1]
        self.assertEqual(payload['note'], 'looks off')
        pos = payload['position']
        self.assertEqual((pos['base_sha'], pos['start_sha'], pos['head_sha']), ('b' * 40, 'c' * 40, SHA))
        self.assertEqual((pos['position_type'], pos['new_path'], pos['old_path'], pos['new_line'], pos['old_line']),
                         ('text', 'src/a.js', 'src/a.js', 4, 3))
        self.assertEqual(res, {'id': 77, 'url': 'https://gl/mr/1', 'head_sha': SHA, 'file': 'src/a.js', 'line': 4})
        self.assertEqual(state['drafts']['1']['77'], SHA)

    def test_add_on_a_line_not_in_the_diff_is_refused_and_creates_nothing(self):
        gl = FakeGL()
        with body_file() as f:
            code, res, _ = run(['draft', 'add', '!1', '--file', 'src/a.js', '--line', '40', '--body-file', f], gl)
        self.assertEqual(code, 2)
        self.assertIn('error', res)
        self.assertEqual(gl.calls, [])

    def test_add_removed_line_with_old_line(self):
        gl = FakeGL()
        with body_file() as f:
            code, res, _ = run(['draft', 'add', '!1', '--file', 'src/a.js', '--old-line', '2', '--body-file', f], gl)
        self.assertEqual(code, 0)
        self.assertEqual(gl.calls[0][1]['position']['old_line'], 2)


class DraftListEditMove(unittest.TestCase):
    def test_list_marks_outdated_when_head_moved(self):
        gl = FakeGL(sha='d' * 40)
        gl.drafts_list = [{'id': 7, 'note': 'a', 'position': {'new_path': 'f', 'new_line': 3}},
                          {'id': 8, 'note': 'b', 'position': {'new_path': 'g', 'new_line': 1}}]
        state = {'me': ME, 'mrs': {}, 'drafts': {'1': {'7': SHA, '8': 'd' * 40}}}
        code, res, _ = run(['draft', 'list', '!1'], gl, state)
        self.assertEqual(res['head_sha'], 'd' * 40)
        self.assertEqual([(d['id'], d['outdated'], d['head_sha']) for d in res['drafts']],
                         [(7, True, SHA), (8, False, 'd' * 40)])
        self.assertEqual(res['drafts'][0]['file'], 'f')
        self.assertEqual(res['drafts'][0]['line'], 3)

    def test_edit_delete_and_move(self):
        gl = FakeGL()
        state = {'me': ME, 'mrs': {}, 'drafts': {'1': {'7': 'old'}}}
        with body_file('new text') as f:
            self.assertEqual(run(['draft', 'edit', '!1', '7', '--body-file', f], gl, state)[0], 0)
        self.assertEqual(gl.calls[-1], ('update', 7, {'note': 'new text'}))
        code, res, state = run(['draft', 'move', '!1', '7', '--file', 'src/a.js', '--line', '3'], gl, state)
        self.assertEqual(code, 0)
        self.assertEqual(gl.calls[-1][2]['position']['new_line'], 3)
        self.assertEqual(state['drafts']['1']['7'], SHA)
        self.assertEqual(run(['draft', 'move', '!1', '7', '--file', 'src/a.js', '--line', '99'], gl, state)[0], 2)
        self.assertEqual(run(['draft', 'delete', '!1', '7'], gl, state)[0], 0)
        self.assertEqual(gl.calls[-1], ('delete', 7))
        self.assertNotIn('7', state['drafts'].get('1', {}))


class NonceGated(unittest.TestCase):
    def commands(self, f):
        return {'publish': ['draft', 'publish', '!1'],
                'reply': ['reply', '!1', '--discussion', 'd1', '--body-file', f],
                'resolve': ['resolve', '!1', 'd1']}

    def test_each_refuses_without_and_with_a_wrong_nonce(self):
        with body_file() as f:
            for name, argv in self.commands(f).items():
                gl = FakeGL()
                with mock.patch.dict(os.environ, {}):
                    os.environ.pop('MRA_ACTION_NONCE', None)
                    code, res, _ = run(argv, gl)
                self.assertEqual(code, 2, name)
                self.assertIn('error', res, name)
                with action_nonce('right', env_value='wrong'):
                    code, res, _ = run(argv, gl)
                self.assertEqual(code, 2, name)
                self.assertEqual(gl.calls, [], name)

    def test_each_runs_with_the_right_nonce_and_burns_it(self):
        with body_file() as f:
            for name, argv in self.commands(f).items():
                gl = FakeGL()
                gl.drafts_list = [{'id': 1, 'note': 'a'}, {'id': 2, 'note': 'b'}]
                with action_nonce() as nf:
                    code, res, _ = run(argv, gl)
                    self.assertFalse(nf.exists(), name)
                self.assertEqual(code, 0, name)
                self.assertEqual(len(gl.calls), 1, name)
        gl = FakeGL()
        gl.drafts_list = [{'id': 1}, {'id': 2}]
        with action_nonce():
            self.assertEqual(run(['draft', 'publish', '!1'], gl)[1], {'published': 2})

    def test_reply_prints_note_id_and_url(self):
        gl = FakeGL()
        with body_file('thanks') as f, action_nonce():
            _, res, _ = run(['reply', '!1', '--discussion', 'd1', '--body-file', f], gl)
        self.assertEqual(res, {'note_id': 99, 'url': 'https://gl/mr/1#note_99'})
        self.assertEqual(gl.calls[0], ('reply', 'd1', 'thanks'))

    def test_resolve_still_refuses_other_peoples_threads(self):
        gl = FakeGL()
        gl.discussion_data['notes'][0]['author']['username'] = 'alice'
        with action_nonce():
            code, res, _ = run(['resolve', '!1', 'd1'], gl)
        self.assertEqual(res[0]['resolved'], False)
        self.assertEqual(gl.calls, [])


class Thread(unittest.TestCase):
    def test_notes_are_wrapped_as_untrusted(self):
        code, res, _ = run(['thread', '!1', '--discussion', 'd1'], FakeGL())
        n = res['notes'][0]
        self.assertEqual((n['author'], n['created_at']), (ME, '2026-10-20T00:00:00Z'))
        self.assertTrue(n['body'].startswith('<<<UNTRUSTED\n'))
        self.assertNotIn('x >>> y', n['body'])


class ApiReadOnly(unittest.TestCase):
    def test_refuses_every_write_spelling(self):
        for extra in (['-X', 'POST'], ['--method', 'DELETE'], ['--method=PUT'], ['-XPOST'], ['--input', 'f'],
                      ['-f', 'a=b'], ['--raw-field', 'a=b'], ['-x', 'post'],
                      ['-H', 'X-HTTP-Method-Override: PUT'], ['-F', 'a=@/etc/passwd']):
            gl = FakeGL()
            code, res, _ = run(['api', 'projects/1/merge_requests', *extra], gl)
            self.assertEqual(code, 2, extra)
            self.assertIn('error', res, extra)
            self.assertEqual(gl.calls, [], extra)

    def test_refuses_paths_outside_the_allowed_roots(self):
        for path in ('graphql', 'admin/x', 'projectsx/1', '../user', 'https://evil/projects/1', 'projects/../admin'):
            gl = FakeGL()
            self.assertEqual(run(['api', path], gl)[0], 2, path)
            self.assertEqual(gl.calls, [], path)

    def test_get_with_fields_prints_body_unchanged(self):
        gl = FakeGL()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), mock.patch.object(cli, 'ctx', lambda a: (CFG, gl, {})):
            cli.main(['api', 'projects/1/merge_requests', '--paginate', '-F', 'state=opened'])
        self.assertEqual(buf.getvalue(), '[{"id": 1}]\n')
        self.assertEqual(gl.calls, [('raw_get', 'projects/1/merge_requests', True, ('state=opened',))])

    def test_glab_is_always_called_with_get(self):
        seen = {}

        def fake_run(cmd, **kw):
            seen['cmd'] = cmd
            return mock.Mock(returncode=0, stdout='[]', stderr='')

        with mock.patch.object(gitlab.subprocess, 'run', fake_run):
            gitlab.GitLab('h', 'g/p').raw_get('projects/1', paginate=True, fields=['a=b'])
        self.assertEqual(seen['cmd'][seen['cmd'].index('-X') + 1], 'GET')


class PollFailsVisibly(unittest.TestCase):
    def poll(self, collect, env=None, gl=None):
        state = {'me': ME, 'mrs': {}}
        exits = []
        with mock.patch.dict(os.environ, env or {}), mock.patch.object(cli, 'collect', collect), \
                mock.patch.object(cli, '_hard_exit', exits.append):
            code, res, _ = run(['poll', '--force'], gl or FakeGL(), state)
        return code, res, exits

    def test_deadline_prints_error_json_naming_the_running_call(self):
        gl = FakeGL()
        gl.inflight = {'projects/g%2Fp/merge_requests?state=opened'}

        def slow(cfg, g, s):
            time.sleep(5)

        t0 = time.time()
        code, res, exits = self.poll(slow, {'MRA_POLL_DEADLINE_S': '0.2'}, gl)
        self.assertLess(time.time() - t0, 3)
        self.assertEqual(code, 2)
        self.assertEqual(res['error'], 'poll deadline reached')
        self.assertTrue(res['partial'])
        self.assertIn('merge_requests?state=opened', res['cause'])

    def test_a_failed_state_write_leaves_the_old_file_valid(self):
        from mra import config
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {'MRA_STATE_DIR': d}):
            config.save_state(CFG, {'mrs': {'1': {}}, 'first_run': False})
            before = config.state_path(CFG).read_text()
            with mock.patch.object(config.os, 'replace', side_effect=OSError('disk')), self.assertRaises(OSError):
                config.save_state(CFG, {'mrs': {'2': {}}})
            self.assertEqual(config.state_path(CFG).read_text(), before)
            self.assertEqual(json.loads(before)['mrs'], {'1': {}})

    def test_a_gitlab_error_is_json_not_a_traceback(self):
        def failing(cfg, g, s):
            raise gitlab.GitLabError('glab api GET todos: no response in 45s')

        code, res, _ = self.poll(failing)
        self.assertEqual(code, 2)
        self.assertIn('error', res)
        self.assertIn('glab api GET todos', res['cause'])

    def test_an_unexpected_exception_is_json_too(self):
        def failing(cfg, g, s):
            raise KeyError('snapshot')

        code, res, _ = self.poll(failing)
        self.assertEqual(code, 2)
        self.assertIn('snapshot', res['cause'])

    def test_drafts_outdated_lists_mrs_whose_head_moved(self):
        gl = FakeGL(sha='d' * 40)
        gl.drafts_list = [{'id': 7, 'note': 'a'}]
        state = {'me': ME, 'mrs': {}, 'drafts': {'1': {'7': SHA}}}
        buf = io.StringIO()

        def collect(cfg, g, s):
            return [], [], [], datetime.now(timezone.utc)

        with mock.patch.object(cli, 'collect', collect), \
                mock.patch.object(cli, 'ctx', lambda a: (dict(CFG, active_hours=None), gl, state)), \
                mock.patch.object(cli, 'save_state', lambda c, s: None), contextlib.redirect_stdout(buf):
            cli.main(['poll', '--force'])
        res = json.loads(buf.getvalue())
        self.assertEqual(res['drafts_outdated'], [{'iid': 1, 'drafts': 1, 'head_sha': 'd' * 40}])


class Help(unittest.TestCase):
    def test_every_new_subcommand_has_help(self):
        for argv in (['--help'], ['draft', '--help'], ['draft', 'add', '--help'], ['draft', 'list', '--help'],
                     ['draft', 'edit', '--help'], ['draft', 'move', '--help'], ['draft', 'delete', '--help'],
                     ['draft', 'publish', '--help'], ['reply', '--help'], ['thread', '--help'], ['api', '--help'],
                     ['resolve', '--help']):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit) as cm:
                cli.main(argv)
            self.assertEqual(cm.exception.code, 0, argv)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit):
            cli.main(['--help'])
        for word in ('draft', 'reply', 'thread', 'api'):
            self.assertIn(word, buf.getvalue())

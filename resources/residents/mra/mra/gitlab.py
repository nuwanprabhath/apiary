"""Thin GitLab client over `glab api`, so auth is whatever `glab auth` has."""

import json
import subprocess
import urllib.parse
from pathlib import Path


API_TIMEOUT_S = 45


class GitLabError(RuntimeError):
    pass


class GitLab:
    def __init__(self, host, project):
        self.host = host
        self.project = project
        self.pid = urllib.parse.quote(project, safe='')

    def api(self, path, method='GET'):
        cmd = ['glab', 'api', '--hostname', self.host]
        if method != 'GET':
            cmd += ['-X', method]
        cmd.append(path)
        # Run outside any checkout: glab reads repo-local config from the cwd
        # and chokes on a worktree whose .git is a file. Retry once, since
        # parallel calls occasionally trip over each other's config reads.
        for attempt in (1, 2):
            try:
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=API_TIMEOUT_S,
                                   cwd=str(Path.home()))
            except subprocess.TimeoutExpired:
                if attempt == 2:
                    raise GitLabError(f'glab api {method} {path}: no response in {API_TIMEOUT_S}s')
                continue
            if p.returncode == 0 or method != 'GET':
                break
        if p.returncode != 0:
            raise GitLabError(f'glab api {method} {path}: {(p.stderr or p.stdout).strip()[:400]}')
        out = p.stdout.strip()
        return json.loads(out) if out else None

    def paged(self, path, per_page=100, max_pages=20):
        sep = '&' if '?' in path else '?'
        items = []
        for page in range(1, max_pages + 1):
            batch = self.api(f'{path}{sep}per_page={per_page}&page={page}')
            items.extend(batch)
            if len(batch) < per_page:
                break
        return items

    # -- reads -------------------------------------------------------------

    def me(self):
        return self.api('user')['username']

    def project_id(self):
        return self.api(f'projects/{self.pid}')['id']

    def open_mrs(self):
        return self.paged(f'projects/{self.pid}/merge_requests?state=opened')

    def mr(self, iid):
        return self.api(f'projects/{self.pid}/merge_requests/{iid}')

    def mr_detail(self, iid):
        base = f'projects/{self.pid}/merge_requests/{iid}'
        return {
            'mr': self.api(base),
            'approvals': self.api(f'{base}/approvals'),
            'reviewers': self.api(f'{base}/reviewers'),
            'discussions': self.paged(f'{base}/discussions'),
        }

    def discussion(self, iid, did):
        return self.api(f'projects/{self.pid}/merge_requests/{iid}/discussions/{did}')

    def pending_mr_todos(self, project_id):
        return self.paged(f'todos?state=pending&type=MergeRequest&project_id={project_id}')

    def failed_jobs(self, pipeline_id):
        jobs = self.paged(f'projects/{self.pid}/pipelines/{pipeline_id}/jobs?scope[]=failed')
        return [{'name': j['name'], 'url': j['web_url'], 'allow_failure': j.get('allow_failure', False)}
                for j in jobs]

    def e2e_status(self, sha, job_regex, max_pipelines=6):
        """Latest pipeline at `sha` that ran jobs matching `job_regex`.

        MR pipelines often run only unit tests, so the head pipeline being
        green says nothing about E2E.
        """
        import re
        for pipe in self.api(f'projects/{self.pid}/pipelines?sha={sha}&per_page={max_pipelines}') or []:
            jobs = self.paged(f'projects/{self.pid}/pipelines/{pipe["id"]}/jobs?include_retried=false')
            e2e = [j for j in jobs if re.search(job_regex, j['name'])]
            if e2e:
                failed = [j['name'] for j in e2e if j['status'] == 'failed' and not j.get('allow_failure')]
                running = [j['name'] for j in e2e if j['status'] in ('running', 'pending', 'created')]
                status = 'failed' if failed else 'running' if running else (
                    'passed' if all(j['status'] in ('success', 'skipped', 'manual') for j in e2e) else pipe['status'])
                return {'ran': True, 'status': status, 'pipeline_url': pipe['web_url'],
                        'jobs': len(e2e), 'failed_jobs': failed[:10]}
        return {'ran': False}

    # -- the only writes this tool makes ------------------------------------

    def resolve_discussion(self, iid, did):
        return self.api(f'projects/{self.pid}/merge_requests/{iid}/discussions/{did}?resolved=true', method='PUT')

    def approve(self, iid, sha):
        # Only ever called from `mra approve`, which the user triggers explicitly.
        return self.api(f'projects/{self.pid}/merge_requests/{iid}/approve?sha={sha}', method='POST')

    def mark_todo_done(self, todo_id):
        return self.api(f'todos/{todo_id}/mark_as_done', method='POST')

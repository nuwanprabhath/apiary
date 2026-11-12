import { randomBytes } from 'node:crypto'
import { errorMessage } from '@shared/errors'
import type { MrHead, ResidentApproval, ResidentNonce, UserAction } from '../kindTypes'
import { removeFileForProgram, writeFileForProgram } from '../../fs/textFile'
import { fail, intIn, ok, text, tool, type ApprovalControl, type Tool } from './toolKit'

const IID_MAX = 1_000_000_000
const BODY_MAX = 10_000
const DISCUSSION_MAX = 200
const IID_HELP = 'iid is the MR\'s number, a whole number from 1 (no list numbers, no "!").'
const cut = (e: unknown): string => errorMessage(e).slice(0, 300)

/** The MR as main reads it from GitLab, or why it could not: the card never shows the agent's words. */
async function readHead(control: ApprovalControl, approval: ResidentApproval, residentId: string, iid: number): Promise<MrHead | string> {
  try {
    return approval.parseHead(await control.run(residentId, approval.readArgv(iid), {})) ?? 'it did not give the title, target branch and head'
  } catch (e) {
    return cut(e)
  }
}

/** Runs `argv` with a nonce written for this one call, so the same command from the agent's shell is refused. */
async function runWithNonce(control: ApprovalControl, nonce: ResidentNonce, residentId: string, argv: string[]): Promise<string> {
  const file = nonce.nonceFile(control.spaceDir(residentId))
  const value = randomBytes(32).toString('hex')
  writeFileForProgram(file, value)
  try {
    return (await control.run(residentId, argv, { [nonce.nonceEnv]: value })).trim()
  } finally {
    removeFileForProgram(file)
  }
}

/** Whether the user lets this go ahead: without a card when the resident may act unasked on that MR
 *  (`ApprovalControl.actsUnasked`), otherwise their answer on a card showing main's summary. */
async function userAllows(control: ApprovalControl, residentId: string, tool: string, iid: number, summary: string): Promise<boolean> {
  return control.actsUnasked(residentId, iid) || control.askUser(residentId, tool, summary)
}

function parseUserAction(a: Record<string, unknown>): UserAction | string {
  const iid = intIn(a.iid, 1, IID_MAX)
  if (iid === null) return IID_HELP
  if (a.kind === 'publish_drafts') return { kind: 'publish_drafts', iid }
  if (a.kind !== 'reply' && a.kind !== 'resolve') return 'kind is publish_drafts, reply or resolve.'
  const discussionId = text(a.discussionId, DISCUSSION_MAX)
  if (discussionId === null || !/^[\w-]+$/.test(discussionId)) return `discussionId (the thread's id from mra) is required for ${a.kind}.`
  if (a.kind === 'resolve') return { kind: 'resolve', iid, discussionId }
  const body = text(a.body, BODY_MAX)
  return body === null ? `body is the reply to post, 1 to ${String(BODY_MAX)} characters.` : { kind: 'reply', iid, discussionId, body }
}

const DONE: Record<UserAction['kind'], string> = { publish_drafts: 'publishing the drafts', reply: 'replying', resolve: 'resolving the thread' }

export const GITLAB_TOOLS: Tool[] = [
  tool<{ iid: number }>({
    name: 'approve_mr',
    capability: 'gitlab.approve',
    description: 'Approve a merge request the user named by its iid. Apiary approves at once when the user named that MR in this chat; otherwise it shows them the MR and approves only if they allow it. The answer says which.',
    inputSchema: { type: 'object', properties: { iid: { type: 'integer', minimum: 1 } }, required: ['iid'] },
    parse: (a) => {
      const iid = intIn(a.iid, 1, IID_MAX)
      return iid === null ? IID_HELP : { iid }
    },
    run: async ({ iid }, { residentId }, deps) => {
      const control = deps.approval
      const approval = control?.approvalOf(residentId) ?? null
      if (control === undefined || approval === null) return fail('Approving is not available here.')
      const head = await readHead(control, approval, residentId, iid)
      if (typeof head === 'string') return fail(`Could not read !${String(iid)}: ${head}`)
      const summary = `Approve !${String(iid)}: ${head.title} → ${head.targetBranch} at ${head.sha.slice(0, 10)}`
      if (!await userAllows(control, residentId, 'approve_mr', iid, summary)) return fail(`The user did not allow approving !${String(iid)}. Nothing was approved.`)
      try {
        return ok(await runWithNonce(control, approval, residentId, approval.approveArgv(iid)))
      } catch (e) {
        return fail(`Approving !${String(iid)} failed: ${cut(e)}`)
      }
    },
  }),
  tool<UserAction>({
    name: 'request_user_action',
    capability: 'gitlab.approve',
    description: 'Ask the user to let Apiary publish your draft comments on an MR (publish_drafts), post a reply in a thread (reply, with the exact body), or resolve a thread (resolve). Apiary reads the MR and thread from GitLab and runs it at once when the user named that MR in this chat; otherwise it shows them what will happen and runs it only if they allow it. The answer says which.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['publish_drafts', 'reply', 'resolve'] },
        iid: { type: 'integer', minimum: 1 },
        discussionId: { type: 'string', description: 'The thread id, for reply and resolve.' },
        body: { type: 'string', maxLength: BODY_MAX, description: 'The reply, posted exactly as written.' },
      },
      required: ['kind', 'iid'],
    },
    parse: parseUserAction,
    run: async (action, { residentId }, deps) => {
      const control = deps.approval
      const actions = control?.userActionsOf(residentId) ?? null
      if (control === undefined || actions === null) return fail('Asking the user to act is not available here.')
      const iid = `!${String(action.iid)}`
      let card: { summary: string } | { problem: string }
      try {
        const outputs: string[] = []
        for (const argv of actions.readArgvs(action)) outputs.push(await control.run(residentId, argv, {}))
        card = actions.card(action, outputs)
      } catch (e) {
        return fail(`Could not read ${iid}: ${cut(e)}`)
      }
      if ('problem' in card) return fail(`Nothing to ask the user: ${card.problem}.`)
      if (!await userAllows(control, residentId, 'request_user_action', action.iid, card.summary)) {
        return fail(`The user declined ${DONE[action.kind]} on ${iid}. Nothing was done.`)
      }
      const bodyFile = actions.bodyFile(control.spaceDir(residentId))
      try {
        if (action.kind === 'reply') writeFileForProgram(bodyFile, action.body)
        return ok(await runWithNonce(control, actions, residentId, actions.actArgv(action, bodyFile)))
      } catch (e) {
        return fail(`${DONE[action.kind]} on ${iid} failed: ${cut(e)}`)
      } finally {
        if (action.kind === 'reply') removeFileForProgram(bodyFile)
      }
    },
  }),
]

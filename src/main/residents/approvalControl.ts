import type { ResidentConfig } from '@shared/domain/residents'
import { ASK_BEFORE_ACTING } from '@shared/domain/residents'
import type { ResidentKind } from './kinds'
import type { ApprovalControl } from './mcp/toolKit'
import type { ResidentChat } from './residentChat'

/** What `approve_mr` and `request_user_action` need of a resident. */
export interface ApprovingResident {
  config: ResidentConfig
  kind: ResidentKind
  chat: Pick<ResidentChat, 'askUser' | 'userNamed'>
  space: { dir: string }
}

/**
 * The tools' reach into the resident a token names: its kind's approval and actions, the user's
 * answer on a card, and a command run as a quick action's is. It acts unasked only on an MR the
 * user typed in its chat, and never while its "Ask before acting on GitLab" option is on.
 */
export function approvalControlFor<R extends ApprovingResident>(
  require: (id: string) => R,
  runIn: (resident: R, argv: string[], extraEnv: Record<string, string>) => Promise<string>,
): ApprovalControl {
  return {
    approvalOf: (id) => require(id).kind.approval ?? null,
    userActionsOf: (id) => require(id).kind.userActions ?? null,
    askUser: (id, tool, summary) => require(id).chat.askUser(tool, summary),
    actsUnasked: (id, iid) => {
      const r = require(id)
      return r.config.options[ASK_BEFORE_ACTING] !== 'on' && r.chat.userNamed(iid)
    },
    run: (id, argv, extraEnv) => runIn(require(id), argv, extraEnv),
    spaceDir: (id) => require(id).space.dir,
  }
}

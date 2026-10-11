import type { JSX, ReactNode } from 'react'
import { DialogOpenContext, type DialogRequest } from '../features/dialogs/useDialogs'
import { LayoutContext, type LayoutActions, type LayoutState, LayoutStateContext } from '../features/layout/layoutContext'
import { ChatModeContext } from '../state/chatStore'

/** The contexts every part of a window reads: chat mode, the dialog opener and the layout's actions and state. */
export function WindowContextProvider({ chat, openDialog, layoutActions, layoutState, children }: {
  chat: boolean
  openDialog: (request: DialogRequest) => void
  layoutActions: LayoutActions
  layoutState: LayoutState
  children: ReactNode
}): JSX.Element {
  return (
    <ChatModeContext value={chat}>
      <DialogOpenContext value={openDialog}>
        <LayoutContext value={layoutActions}>
          <LayoutStateContext value={layoutState}>{children}</LayoutStateContext>
        </LayoutContext>
      </DialogOpenContext>
    </ChatModeContext>
  )
}

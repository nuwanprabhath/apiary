import type { BrowseView } from '@shared/domain/folders'
import type { NewSessionInfo } from '@shared/domain/session'

/**
 * Commands of the folder browser a remote window shows where a local one has the native picker. The
 * work machine holds the position; these pass an opaque id, a child's name or a crumb index, never
 * a path (ADR-0001). The dialog awaits each and shows a failure inline (`policy.ts`, "returned").
 */
export const openFolderBrowse = (): Promise<BrowseView> => window.apiary.folderBrowseOpen()
export const enterBrowsedFolder = (id: string, name: string): Promise<BrowseView> => window.apiary.folderBrowseEnter(id, name)
export const upBrowsedFolder = (id: string): Promise<BrowseView> => window.apiary.folderBrowseUp(id)
export const jumpToBrowsedCrumb = (id: string, index: number): Promise<BrowseView> => window.apiary.folderBrowseCrumb(id, index)
export const closeFolderBrowse = (id: string): void => { window.apiary.folderBrowseClose(id) }
export const startSessionInBrowsedFolder = (id: string): Promise<NewSessionInfo> => window.apiary.newSessionInBrowsedFolder(id)

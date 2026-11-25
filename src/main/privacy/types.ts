import type { PrivacyStatus, PurgeRequest, PurgeResult } from '@shared/domain/privacy'

/** What the privacy IPC handlers delegate to; built by `createPrivacy` (`app/privacyContainer.ts`). */
export interface PrivacyService {
  status(): Promise<PrivacyStatus>
  purge(req: PurgeRequest): Promise<PurgeResult>
  /** Main asks where to write the export; null when the person cancelled. */
  export(): Promise<string | null>
}

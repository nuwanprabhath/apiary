import { powerMonitor } from 'electron'
import { startDesk } from '../desk/desk'
import { mrDeskRepo } from '../desk/references'
import { fireAndForget } from '../log/fireAndForget'
import type { Container } from './container'

/**
 * Starts what runs on its own once a window can hear it: the residents, scheduled messages, the
 * Slack desk and the retention sweeper. Returns how to stop them all, for quit.
 */
export function startBackgroundWork(container: Container): () => Promise<void> {
  // Stops every resident's claude and the MCP server.
  const disposeResidents = container.residents.start()
  const disposeSchedules = startSchedules(container)
  // Stops the Slack poller.
  const disposeSlack = startDesk({
    bridge: container.slack, driver: container.driving, residents: container.residents,
    repos: {
      ofSession: (id) => container.service.repoWebLocation({ kind: 'session', id }),
      mrDesk: () => mrDeskRepo(container.settingsService.get().residents),
    },
  })
  const disposeSweeper = container.privacy.startSweeper()
  return async () => {
    await disposeResidents()
    disposeSchedules()
    disposeSweeper()
    await disposeSlack()
  }
}

/**
 * Scheduled messages: the script and the pid the OS jobs check, then the timer; what came due while
 * the machine slept goes at wake. Stopping removes `apiary.pid`, so the OS jobs send from then on.
 */
function startSchedules(container: Container): () => void {
  const { service, jobs } = container.schedules
  jobs.install(process.pid)
  fireAndForget(service.start(), 'schedule')
  const onResume = (): void => { service.resume() }
  powerMonitor.on('resume', onResume)
  return () => {
    powerMonitor.off('resume', onResume)
    service.dispose()
    container.driving.dispose()
    jobs.uninstall()
  }
}

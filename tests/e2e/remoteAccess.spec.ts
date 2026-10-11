import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { launchApiary, type Harness } from './helpers'

// The real main process behind remote access's local calls. The component tests run these against
// the fake, and the contract loopback wires its own registrar, so neither noticed index.ts handing
// the registrar no host directory, server or pairing store: the connect dialog listed no hosts and
// the pairing code could not be shown. Over SSH itself: tests/remote (Docker).

let h: Harness

test.afterEach(async () => { await h.close() })

test("the connect dialog's host list comes from the ssh config", async () => {
  const config = test.info().outputPath('ssh_config')
  writeFileSync(config, 'Host work-box\n  HostName work-box.example.com\n\nHost *.example.com\n  User dev\n')
  h = await launchApiary({ sshConfig: config })
  const hosts = await h.page.evaluate(() => window.apiary.remoteHosts(false))
  expect(hosts.map((x) => [x.name, x.source])).toContainEqual(['work-box', 'ssh-config'])
  // A pattern is not a host someone can pick.
  expect(hosts.map((x) => x.name)).not.toContain('*.example.com')
})

test('the work machine shows a pairing code, and a new one replaces it', async () => {
  h = await launchApiary()
  const code = await h.page.evaluate(() => window.apiary.remotePairing())
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  const next = await h.page.evaluate(() => window.apiary.remotePairingNew())
  expect(next).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  expect(next).not.toBe(code)
  expect(await h.page.evaluate(() => window.apiary.remoteClients())).toEqual([])
})

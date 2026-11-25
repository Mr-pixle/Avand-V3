import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp, type AppConfig } from '../server/http'

const staticDir = await mkdtemp(path.join(tmpdir(), 'avand-web-update-'))
const index = path.join(staticDir, 'index.html')
const render = (asset: string) => `<!doctype html><html><head></head><body><script src="/assets/${asset}.js"></script></body></html>`
const app = createApp({
  staticDir,
  version: 'test',
  core: {} as AppConfig['core'],
  db: {} as AppConfig['db'],
  jobs: {} as AppConfig['jobs'],
  secureCookies: false, syncEveryHours: 2, writebackDelaySec: 120, schedule: false,
})
const server = createServer((req, res) => { void app(req, res) })

try {
  await writeFile(index, render('old'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const before = await fetch(base + '/')
  assert.equal(before.status, 200)
  assert.match(await before.text(), /\/assets\/old\.js/)

  await writeFile(index, render('new'))
  for (const url of ['/', '/index.html', '/projects']) {
    const after = await fetch(base + url)
    assert.equal(after.status, 200)
    assert.equal(after.headers.get('cache-control'), 'no-cache')
    const html = await after.text()
    assert.match(html, /\/assets\/new\.js/)
    assert.match(html, /name="taraz-server" content="test"/)
  }
  console.log('A running server serves the updated web entry point.')
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()))
  await unlink(index)
  await rmdir(staticDir)
}

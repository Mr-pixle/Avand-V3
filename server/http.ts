import { scoreReport, validDate } from './scores'
import { isActiveProjectId } from '../src/lib/projectDetails'
import type { ScoreRecord } from '../src/lib/scores'
// HTTP API and the web app. Every request is checked on the server: the signed-in person comes from an HttpOnly
// session cookie, reads are cut to what that person may see (view.ts), and writes go through the guarded reducer.
import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { COLLECTIONS, type Collection } from '../src/lib/collections'
import { canAdministerAccount, canSeeRequest, canSyncProject, canViewTask, has } from '../src/lib/policy'
import type { Action } from '../src/lib/state'
import type { User } from '../src/lib/types'
import {
  clearCookie, clearFailures, createSession, dropSession, dropSessionsOf, parseCookies, passwordHashOf, passwordProblem,
  recordFailure, sessionCookie, sessionUser, setPassword, throttled, verifyPassword, COOKIE,
} from './auth'
import type { Core } from './core'
import type { Db } from './db'
import type { Jobs } from './jobs'
import { filesOf, prepare, Rejected } from './sanitize'
import { deltaOf, sentOf, viewOf, type Sent } from './view'
import { BackupError, backupPassphrase, backupSummary, exportBackup, MAX_BACKUP_BYTES, openBackup, restoreBackup } from './backup'

export interface AppConfig {
  core: Core; jobs: Jobs; db: Db
  staticDir: string | null
  secureCookies: boolean
  syncEveryHours: number; writebackDelaySec: number; schedule: boolean
  version: string
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const MAX_FILE = 3 * 1024 * 1024
const MAX_FILES = 8
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
}
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': data.length, ...headers })
  res.end(data)
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '')
  if (!type.startsWith('application/json')) throw new HttpError(415, "The application must be JSON.")
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw new HttpError(413, "Too much request volume is allowed.")
    chunks.push(c as Buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw new HttpError(400, "JSON is invalid.") }
}

const publicUser = ({ password: _p, ...u }: User) => u

export function createApp(cfg: AppConfig) {
  const { core, jobs, db } = cfg
  // what each open tab already has, so the next read sends only what changed
  const views = new Map<string, { token: string; sent: Sent; at: number }>()
  let backupBusy = false, restoring = false, activeRequests = 0

  const serverInfo = (me: User) => (has(me, 'control.section') ? {
    google: { configured: !!jobs.googleEmail, email: jobs.googleEmail }, syncEveryHours: cfg.schedule ? cfg.syncEveryHours : 0, writebackDelaySec: cfg.writebackDelaySec,
  } : {})

  async function auth(req: IncomingMessage) {
    const token = parseCookies(req.headers.cookie)[COOKIE]
    const s = await sessionUser(db, token)
    if (!s) return null
    const me = core.state.users.find((u) => u.id === s.userId)
    if (!me || me.status !== 'active') return null
    return { me, key: s.key, token: token! }
  }
  async function need(req: IncomingMessage) {
    const a = await auth(req)
    if (!a) throw new HttpError(401, "Sign in to continue.")
    return a
  }
  const ip = (req: IncomingMessage) => String(req.socket.remoteAddress ?? '')

  function sendBackup(res: ServerResponse, archive: Buffer, prefix: string) {
    const name = `Avand-${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.avandbackup`
    res.writeHead(200, { 'content-type':'application/octet-stream', 'content-length':archive.length, 'content-disposition':`attachment; filename="${name}"`, 'cache-control':'private, no-store' })
    res.end(archive)
  }
  async function onBackup(req: IncomingMessage, res: ServerResponse, mode: 'download'|'inspect'|'restore'|'recovery') {
    const { me } = await need(req)
    // Company-wide archives include private, financial and credential data. Never delegate via ordinary roles.
    if (me.role !== 'ceo') throw new HttpError(403,'Company backups are restricted to the CEO account.')
    if (backupBusy) throw new HttpError(409,'Another backup operation is in progress. Try again shortly.')
    backupBusy = true
    let paused = false
    try {
      const body = await readBody(req, mode === 'inspect' || mode === 'restore' ? Math.ceil(MAX_BACKUP_BYTES*4/3)+32768 : 16384) as Record<string,unknown> | null
      if (!body || typeof body !== 'object') throw new HttpError(400,'Invalid backup request.')
      const key = `backup:${me.id}`
      if (throttled(key,8)) throw new HttpError(429,'Too many unsuccessful attempts. Try again in 15 minutes.')
      if (typeof body.password !== 'string' || body.password.length > 200 || !await verifyPassword(body.password,await passwordHashOf(db,me.id))) { recordFailure(key); throw new HttpError(403,'The current account password is incorrect.') }
      clearFailures(key)
      if (mode==='recovery') {
        const row = (await db.query<{data:Buffer}>('SELECT data FROM backup_recovery WHERE slot=1')).rows[0]
        if (!row) throw new HttpError(404,'No pre-restore recovery backup exists yet.')
        return sendBackup(res,row.data,'Pre-Restore')
      }
      const passphrase = backupPassphrase(body.passphrase)
      if (mode==='download') {
        const archive = await core.exclusive(async()=>{
          const current=await auth(req)
          if(current?.me.role!=='ceo' || current.me.id!==me.id || !await verifyPassword(String(body.password),await passwordHashOf(db,me.id))) throw new HttpError(403,'Your session or account password changed. Sign in again.')
          return exportBackup(db,passphrase)
        })
        await core.audit({userId:me.id,kind:'admin',text:'Encrypted company backup downloaded.'})
        return sendBackup(res,archive,'Backup')
      }
      if (typeof body.archive!=='string' || body.archive.length > Math.ceil(MAX_BACKUP_BYTES*4/3)+4) throw new HttpError(400,'Choose a backup file up to 128 MB.')
      const archive=Buffer.from(body.archive,'base64')
      if (archive.toString('base64')!==body.archive) throw new HttpError(400,'Invalid backup file encoding.')
      const payload=await openBackup(archive,passphrase), summary=backupSummary(payload,archive)
      if (mode==='inspect') return send(res,200,summary)
      if (body.confirmation !== 'RESTORE' || body.fingerprint !== summary.fingerprint || body.replaceAccepted !== true) throw new HttpError(400,'Inspect the backup and explicitly confirm replacement first.')
      const recoveryPassphrase=backupPassphrase(body.recoveryPassphrase)
      if(recoveryPassphrase.normalize('NFC')===passphrase.normalize('NFC')) throw new HttpError(400,'Choose a separate recovery passphrase for the destination.')
      // Block new API activity, let already-authorized requests finish, then stop background jobs.
      restoring=true
      const deadline=Date.now()+5000
      while(activeRequests>1 && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50))
      if(activeRequests>1 || !jobs.pauseForRestore()) throw new HttpError(409,'The server is busy with another request or background job. Try again shortly.')
      paused=true
      await core.exclusive(async()=>{
        const authNow=await auth(req)
        if(authNow?.me.role!=='ceo' || authNow.me.id!==me.id || !await verifyPassword(String(body.password),await passwordHashOf(db,me.id))) throw new HttpError(403,'Your session or account password changed. Sign in again.')
        const next=await restoreBackup(db,payload,recoveryPassphrase,core.state,me.name)
        views.clear()
        core.publishRestoredState(next)
      })
      return send(res,200,{ok:true,summary},{'set-cookie':clearCookie(cfg.secureCookies)})
    } catch(e) {
      if(e instanceof BackupError) throw new HttpError(400,e.message)
      if(e instanceof HttpError) throw e
      console.error('[backup] operation failed:', e instanceof Error ? e.name : 'unknown error')
      throw new HttpError(500,'The backup operation could not be completed. No restore changes were committed.')
    } finally { try { if(paused) jobs.resumeAfterRestore() } catch { console.error('[backup] could not rearm background jobs') } finally { restoring=false; backupBusy=false } }
  }

  /** Files of an action are stored with it in one transaction; the state keeps only their URL */
  function takeFiles(action: Action) {
    const files = filesOf(action)
    if (!files) return { action, rows: [] as { id: string; name: string; mime: string; size: number; data: Buffer }[] }
    if (files.length > MAX_FILES) throw new Rejected(`Maximum ${MAX_FILES} files per time.`)
    const rows: { id: string; name: string; mime: string; size: number; data: Buffer }[] = []
    const out = files.map((f) => {
      const m = /^data:([\w.+-]+\/[\w.+-]+)?(;[^,]*)?;base64,([A-Za-z0-9+/=\s]*)$/.exec(String(f?.dataUrl ?? ''))
      if (!m) throw new Rejected("The file is invalid.")
      const data = Buffer.from(m[3], 'base64')
      if (data.length > MAX_FILE) throw new Rejected("The maximum file size is 3 MB.")
      const id = `fl-${randomBytes(12).toString('base64url')}`
      const name = String(f.name ?? 'file').slice(0, 200)
      const mime = String(m[1] ?? f.mime ?? 'application/octet-stream').slice(0, 100)
      rows.push({ id, name, mime, size: data.length, data })
      return { name, mime, size: data.length, dataUrl: `/api/files/${id}` }
    })
    return { action: { ...action, files: out } as Action, rows }
  }

  async function onAction(req: IncomingMessage, res: ServerResponse) {
    const { me } = await need(req)
    const body = await readBody(req, 40 * 1024 * 1024) as { action?: unknown }
    let prepared
    try {
      prepared = prepare(body.action, me, core.state.tasks)
      const f = takeFiles(prepared.action)
      prepared = { ...prepared, action: f.action, files: f.rows }
    } catch (e) {
      if (!(e instanceof Rejected)) throw e
      // not something the app sends: recorded as a security event
      await core.audit({ userId: me.id, kind: 'security', text: `Rejected Request ${String((body.action as { type?: unknown })?.type ?? '?').slice(0, 40)}: ${e.message}` })
      return send(res, 403, { ok: false, denial: e.message })
    }
    const { action, newPassword, files } = prepared
    const out = await core.dispatch(me.id, action, async (c) => {
      if (action.type === 'docDelete' || (action.type === 'docSave' && action.files?.length)) {
        const oldUrl = core.state.documents[action.id]?.file.dataUrl
        const oldId = oldUrl && /^\/api\/files\/(fl-[A-Za-z0-9_-]+)$/.exec(oldUrl)?.[1]
        if (oldId) await c.query('DELETE FROM files WHERE id = $1', [oldId])
      }
      for (const f of files) await c.query('INSERT INTO files (id, name, mime, size, data, owner) VALUES ($1, $2, $3, $4, $5, $6)', [f.id, f.name, f.mime, f.size, f.data, me.id])
      if (newPassword) await setPassword(c, newPassword.userId, newPassword.password)
      // an account that is disabled or rejected is signed out everywhere at once
      const a = action as { type: string; id?: string; patch?: Partial<User> }
      if (a.type === 'updateUser' && a.patch?.status && a.patch.status !== 'active') await dropSessionsOf(c, String(a.id))
    })
    if (out.denial) return send(res, 403, { ok: false, denial: out.denial })
    send(res, 200, { ok: true, v: core.version })
  }

  async function onState(req: IncomingMessage, res: ServerResponse, url: URL) {
    const { me, key } = await need(req)
    const client = (url.searchParams.get('client') ?? '').slice(0, 64)
    const base = url.searchParams.get('base') ?? ''
    const view = viewOf(core.state, me)
    const k = `${key}:${client}`
    const prev = client ? views.get(k) : undefined
    const token = randomBytes(9).toString('base64url')
    if (client) {
      views.set(k, { token, sent: sentOf(view), at: Date.now() })
      if (views.size > 1000) for (const [x, v] of [...views].sort((a, b) => a[1].at - b[1].at).slice(0, 200)) { views.delete(x); void v }
    }
    const common = { me: me.id, token, v: core.version, server: serverInfo(me) }
    if (prev && base && prev.token === base) return send(res, 200, { ...common, full: false, delta: deltaOf(prev.sent, view) })
    const data: Partial<Record<Collection, [string, unknown][]>> = {}
    for (const c of COLLECTIONS) data[c] = view[c]
    send(res, 200, { ...common, full: true, data })
  }

  function onEvents(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(`retry: 3000\n\nevent: v\ndata: ${core.version}\n\n`)
    const off = core.subscribe((v) => res.write(`event: v\ndata: ${v}\n\n`))
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
    req.on('close', () => { off(); clearInterval(ping) })
  }

  async function onLogin(req: IncomingMessage, res: ServerResponse) {
    const body = await readBody(req, 16 * 1024) as { username?: unknown; password?: unknown }
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const keys = [`login:${ip(req)}:${username}`, `login-ip:${ip(req)}`]
    if (throttled(keys[0], 8) || throttled(keys[1], 40)) return send(res, 429, { ok: false, error: "There were many unsuccessful attempts; try again in 15 minutes." })
    const u = core.state.users.find((x) => x.username === username)
    const okPw = await verifyPassword(password, u ? await passwordHashOf(db, u.id) : undefined)
    if (!u || !okPw) { keys.forEach(recordFailure); return send(res, 401, { ok: false, error: "Incorrect username or password." }) }
    clearFailures(keys[0])
    if (u.status === 'pending') return send(res, 403, { ok: false, error: "Your account has not yet been verified. You can log in after the project control is confirmed." })
    if (u.status !== 'active') return send(res, 403, { ok: false, error: "This account is inactive." })
    const token = await createSession(db, u.id)
    send(res, 200, { ok: true, me: u.id }, { 'set-cookie': sessionCookie(token, cfg.secureCookies) })
  }

  async function onRegister(req: IncomingMessage, res: ServerResponse) {
    const body = await readBody(req, 16 * 1024) as { name?: unknown; username?: unknown; password?: unknown }
    const key = `register:${ip(req)}`
    if (throttled(key, 6)) return send(res, 429, { ok: false, error: "A large number of applications have been filed; try again a little later." })
    const name = String(body.name ?? '').trim().slice(0, 80)
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!name) return send(res, 400, { ok: false, error: "Enter the full name." })
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) return send(res, 400, { ok: false, error: "The user name must be 3 to 24 small English letters, numbers, dots, dark lines or subline." })
    const pw = passwordProblem(password)
    if (pw) return send(res, 400, { ok: false, error: pw })
    if (core.state.users.some((u) => u.username === username)) return send(res, 409, { ok: false, error: `User name ${username} has already been taken.` })
    recordFailure(key)
    const user: User = { id: `u-${randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`, name, username, teamId: '', role: 'member', capacity: 8, status: 'pending', createdAt: new Date().toISOString() }
    const out = await core.dispatch(null, { type: 'register', user }, async (c) => { await setPassword(c, user.id, password) })
    if (out.denial) return send(res, 409, { ok: false, error: out.denial })
    send(res, 200, { ok: true })
  }

  async function onOwnPassword(req: IncomingMessage, res: ServerResponse) {
    const { me, token } = await need(req)
    const body = await readBody(req, 16 * 1024) as { current?: unknown; next?: unknown }
    const key = `pw:${me.id}`
    if (throttled(key, 8)) return send(res, 429, { ok: false, error: "There were a lot of unsuccessful attempts; try again a little later." })
    if (!(await verifyPassword(String(body.current ?? ''), await passwordHashOf(db, me.id)))) { recordFailure(key); return send(res, 403, { ok: false, error: "The current code is not correct." }) }
    const p = passwordProblem(body.next)
    if (p) return send(res, 400, { ok: false, error: p })
    await setPassword(db, me.id, String(body.next))
    await dropSessionsOf(db, me.id, token)
    clearFailures(key)
    send(res, 200, { ok: true })
  }

  async function onResetPassword(req: IncomingMessage, res: ServerResponse, id: string) {
    const { me } = await need(req)
    const body = await readBody(req, 16 * 1024) as { password?: unknown }
    const target = core.state.users.find((u) => u.id === id)
    if (!target) return send(res, 404, { ok: false, error: "The user was not found." })
    if (target.id === me.id) return send(res, 400, { ok: false, error: "Change your password from the “Change Password” to the current password." })
    if (!has(me, 'users.manage')) { await core.audit({ userId: me.id, kind: 'security', text: `Access denied: reset password for ${target.username}` }); return send(res, 403, { ok: false, error: "The password of others is only for the system administrator and the administrator." }) }
    if (!canAdministerAccount(me, target)) return send(res, 403, { ok: false, error: "Change the CEO’s password only." })
    const p = passwordProblem(body.password)
    if (p) return send(res, 400, { ok: false, error: p })
    await setPassword(db, target.id, String(body.password))
    await dropSessionsOf(db, target.id)
    await core.audit({ userId: me.id, kind: 'admin', text: `Password reset for ${target.username}` })
    send(res, 200, { ok: true })
  }

  async function onFile(req: IncomingMessage, res: ServerResponse, id: string) {
    const { me } = await need(req)
    const url = `/api/files/${id}`
    const s = core.state
    const att = s.attachments.find((a) => a.dataUrl === url)
    const reqOf = att ? undefined : s.adminRequests.find((r) => r.files.some((f) => f.dataUrl === url))
    const doc = Object.values(s.documents).some(d => d.file.dataUrl === url)
    const allowed = (doc && has(me, 'library.view')) || (att ? !!s.tasks[att.taskId] && canViewTask(s, me, s.tasks[att.taskId]) : reqOf ? canSeeRequest(me, reqOf) : false)
    if (!allowed) return send(res, 404, { ok: false, error: "No file found." })
    const r = await db.query<{ name: string; mime: string; data: Buffer }>('SELECT name, mime, data FROM files WHERE id = $1', [id])
    const f = r.rows[0]
    if (!f) return send(res, 404, { ok: false, error: "No file found." })
    const inline = !doc && INLINE.has(f.mime)
    res.writeHead(200, {
      'content-type': inline ? f.mime : 'application/octet-stream', 'content-length': f.data.length,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    })
    res.end(f.data)
  }

  async function onSync(req: IncomingMessage, res: ServerResponse, projectId: string | null) {
    const { me } = await need(req)
    if (projectId) {
      const p = core.state.projects.find((x) => x.id === projectId)
      if (!p) return send(res, 404, { ok: false, error: "The project was not found." })
      if (!canSyncProject(core.state, me, projectId)) { await core.audit({ userId: me.id, kind: 'security', text: `Access Rejection: Sync Project ${projectId}` }); return send(res, 403, { ok: false, denial: "Sync this project is not allowed for you." }) }
      if (!p.mdrUrl) return send(res, 400, { ok: false, error: "The MDR link of this project is not registered." })
      const run = await jobs.syncProject(projectId, 'manual', me.id)
      return send(res, 200, { ok: true, runs: [run] })
    }
    if (!has(me, 'sync.run')) { await core.audit({ userId: me.id, kind: 'security', text: "Access denied: sync all projects" }); return send(res, 403, { ok: false, denial: "Sync is not allowed for all projects." }) }
    send(res, 200, { ok: true, runs: await jobs.syncAll('manual', me.id) })
  }

  async function onFlush(req: IncomingMessage, res: ServerResponse) {
    const { me } = await need(req)
    if (!has(me, 'sync.run')) return send(res, 403, { ok: false, denial: "Writing-back lines are only for project control and management." })
    send(res, 200, { ok: true, runs: await jobs.flushWriteBack(true) })
  }

  async function onStatic(res: ServerResponse, url: URL) {
    if (!cfg.staticDir) return send(res, 404, { ok: false, error: 'not found' })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.resolve(cfg.staticDir, rel || 'index.html')
    if (!file.startsWith(path.resolve(cfg.staticDir) + path.sep) && file !== path.resolve(cfg.staticDir)) return send(res, 404, { ok: false })
    const st = await stat(file).catch(() => null)
    const isFile = !!st?.isFile() && !file.endsWith('preview.html')
    if (!isFile || path.basename(file) === 'index.html') {
      // the app itself (and every client-side route) with the server-mode marker
      const raw = await readFile(path.join(cfg.staticDir, 'index.html'), 'utf8')
      const indexHtml = raw.replace(/<html[^>]*>/i, (m) => `${m}<meta name="taraz-server" content="${cfg.version}">`)
      const data = Buffer.from(indexHtml)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': CSP, 'content-length': data.length })
      return res.end(data)
    }
    const data = await readFile(file)
    const hashed = /\.[0-9a-f]{8,}\.(js|css)$/.test(file)
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...(path.extname(file) === '.html' ? { 'content-security-policy': CSP } : {}), 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'content-length': data.length })
    res.end(data)
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'same-origin')
    res.setHeader('x-frame-options', 'SAMEORIGIN')
    const url = new URL(req.url ?? '/', 'http://local')
    const p = url.pathname
    const tracked = p.startsWith('/api/')
    if (tracked && restoring) return send(res,503,{ok:false,error:'A company backup is being restored. Please wait and sign in again.'})
    if (tracked) activeRequests++
    try {
      if (p.startsWith('/api/')) {
        // cross-site form posts never reach a handler (the session cookie is also SameSite=Lax)
        const origin = req.headers.origin
        if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Requests from another source are not accepted.")
        const m = req.method
        if (m === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: cfg.version, google: !!jobs.googleEmail, v: core.version })
        if (m === 'GET' && p === '/api/session') {
          const a = await auth(req)
          return send(res, 200, { me: a ? publicUser(a.me) : null, server: a ? serverInfo(a.me) : {} })
        }
        if (m === 'POST' && p === '/api/auth/login') return await onLogin(req, res)
        if (m === 'POST' && p === '/api/auth/register') return await onRegister(req, res)
        if (m === 'POST' && p === '/api/backup/download') return await onBackup(req,res,'download')
        if (m === 'POST' && p === '/api/backup/inspect') return await onBackup(req,res,'inspect')
        if (m === 'POST' && p === '/api/backup/restore') return await onBackup(req,res,'restore')
        if (m === 'POST' && p === '/api/backup/recovery') return await onBackup(req,res,'recovery')
        if (m === 'POST' && p === '/api/auth/logout') {
          await dropSession(db, parseCookies(req.headers.cookie)[COOKIE])
          return send(res, 200, { ok: true }, { 'set-cookie': clearCookie(cfg.secureCookies) })
        }
        if (m === 'GET' && p === '/api/scores/report') {
          const { me } = await need(req)
          const q = url.searchParams, manager = has(me, 'points.manage')
          const uid = q.get('user'), from = q.get('from'), to = q.get('to')
          if ((!manager && uid && uid !== me.id) || (from && !validDate(from)) || (to && !validDate(to))) throw new HttpError(400, "The report filter is invalid or out of reach.")
          const rows = Object.values(core.state.scores ?? {}).filter((r: ScoreRecord) => r.kind === 'task' && (manager || r.userId === me.id)
            && (q.get('project')||!r.projectId||isActiveProjectId(core.state.projects,r.projectId))
            && (!uid || r.userId === uid) && (!q.get('team') || r.teamId === q.get('team')) && (!q.get('project') || r.projectId === q.get('project'))
            && (!from || !!r.actualFinish && r.actualFinish >= from) && (!to || !!r.actualFinish && r.actualFinish <= to))
          return send(res, 200, scoreReport(rows, q.get('period') === 'month' ? 'month' : 'week'))
        }
        if (m === 'GET' && p === '/api/state') return await onState(req, res, url)
        if (m === 'GET' && p === '/api/events') { await need(req); return onEvents(req, res) }
        if (m === 'POST' && p === '/api/action') return await onAction(req, res)
        if (m === 'POST' && p === '/api/me/password') return await onOwnPassword(req, res)
        let r = /^\/api\/users\/([^/]+)\/password$/.exec(p)
        if (m === 'POST' && r) return await onResetPassword(req, res, decodeURIComponent(r[1]))
        r = /^\/api\/files\/(fl-[A-Za-z0-9_-]+)$/.exec(p)
        if (m === 'GET' && r) return await onFile(req, res, r[1])
        r = /^\/api\/projects\/([^/]+)\/sync$/.exec(p)
        if (m === 'POST' && r) return await onSync(req, res, decodeURIComponent(r[1]))
        if (m === 'POST' && p === '/api/sync/all') return await onSync(req, res, null)
        if (m === 'POST' && p === '/api/writeback/flush') return await onFlush(req, res)
        throw new HttpError(404, "The path was not found.")
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed')
      return await onStatic(res, url)
    } catch (e) {
      if (res.headersSent) { res.end(); return }
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message })
      console.error('[http]', req.method, p, e)
      send(res, 500, { ok: false, error: "Internal server error; no changes were made." })
    } finally { if (tracked) activeRequests-- }
  }
}

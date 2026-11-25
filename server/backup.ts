import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { COLLECTIONS, SHAPES, entriesOf, fromEntries, type Collection, type Data } from '../src/lib/collections'
import { resolveRole } from '../src/lib/accessRoles'
import { reconcileScores } from './scores'
import { upgradeManualDocTypes } from './migrations'
import { reconcileDocumentReviews } from '../src/lib/documentReview'
import type { State } from '../src/lib/state'
import { tx, type Db, type Tx } from './db'

// Versioned, authenticated encrypted transfer; not a SQL dump or an executable archive.
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024
const MAGIC = Buffer.from('AVAND-BACKUP-1\n')
const HEADER = MAGIC.length + 16 + 12 + 16
export class BackupError extends Error {}
type Entity = { kind: Collection; id: string; data: unknown }
type Credential = { user_id: string; hash: string }
type StoredFile = { id: string; name: string; mime: string; size: number; data: string; owner: string | null; created_at: string }
type Payload = { format: 1; createdAt: string; collections: readonly Collection[]; entities: Entity[]; credentials: Credential[]; files: StoredFile[] }

export function backupPassphrase(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) throw new BackupError('Use a backup passphrase with 12–200 characters.')
  return value
}
function keyOf(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passphrase.normalize('NFC'), salt, 32, { N:32768, r:8, p:1, maxmem:64*1024*1024 }, (e, k) => e ? reject(e) : resolve(k)))
}
export async function sealBackup(payload: Payload, passphrase: string) {
  const plain = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plain.length + HEADER > MAX_BACKUP_BYTES) throw new BackupError('This backup exceeds the 128 MB transfer limit. Contact the server administrator for a database-level backup.')
  const salt = randomBytes(16), iv = randomBytes(12)
  const key = await keyOf(backupPassphrase(passphrase), salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(MAGIC)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted])
  } finally { key.fill(0); plain.fill(0) }
}

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 512 && !['__proto__','constructor','prototype'].includes(x) && !x.includes('\0')
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !x.includes('\0')
const date = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x))
const invalid = (why: string): never => { throw new BackupError(`Invalid or incompatible backup: ${why}.`) }
const hashValid = (x: unknown) => typeof x === 'string' && /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/.test(x)

/** Strict envelope, keys, identifiers and credential/file validation before any write. */
export function validateBackup(raw: unknown): Payload {
  if (!object(raw) || raw.format !== 1 || !date(raw.createdAt) || !Array.isArray(raw.collections) || new Set(raw.collections).size!==raw.collections.length || !COLLECTIONS.every(c => c==='projectCategories'||c==='scoreOverrides'||raw.collections instanceof Array && raw.collections.includes(c)) || raw.collections.some(c=>!COLLECTIONS.includes(c as Collection))) return invalid('unsupported format or collections')
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.credentials) || !Array.isArray(raw.files)) return invalid('missing data tables')
  const seen = new Set<string>(), by = new Map<Collection, [string, unknown][]>()
  for (const r of raw.entities) {
    if (!object(r) || !COLLECTIONS.includes(r.kind as Collection) || !id(r.id) || !Object.hasOwn(r, 'data') || r.data === null) return invalid('entity row')
    const kind = r.kind as Collection, key = `${kind}\0${r.id}`, shape = SHAPES[kind]
    if (seen.has(key)) return invalid('duplicate entity')
    seen.add(key)
    if (shape.type === 'array' && (!object(r.data) || shape.key(r.data) !== r.id)) return invalid('entity key mismatch')
    if (shape.type === 'grouped' && (!Array.isArray(r.data) || r.data.some(v => !object(v) || shape.key(v) !== r.id))) return invalid('allocation key mismatch')
    if (kind === 'users' && (!object(r.data) || !id(r.data.id) || Object.hasOwn(r.data,'password') || typeof r.data.username !== 'string' || !/^[a-z0-9._-]{3,24}$/.test(r.data.username) || typeof r.data.role !== 'string' || !['active','pending','disabled','rejected'].includes(String(r.data.status)))) return invalid('user record')
    if(kind==='projectCategories'&&(r.id!=='office'||!object(r.data)||!Array.isArray(r.data.names)||!r.data.names.includes('Other')||r.data.names.some(n=>typeof n!=='string'||!n.trim()||n.length>80)||new Set(r.data.names).size!==r.data.names.length))return invalid('project category configuration')
    if(kind==='scoreOverrides'&&(!object(r.data)||typeof r.data.value!=='number'||!Number.isFinite(r.data.value)||r.data.value<20||r.data.value>100||!text(r.data.reason,500)||!id(r.data.by)||!date(r.data.at)))return invalid('manual score adjustment')
    if (!by.has(kind)) by.set(kind, [])
    by.get(kind)!.push([r.id, r.data])
  }
  const users = (by.get('users') ?? []).map(([,u]) => u as Record<string, unknown>)
  if (new Set(users.map(u=>u.username)).size !== users.length) return invalid('duplicate username')
  const userIds = new Set(users.map(u=>u.id)), credentials = new Set<string>()
  for (const r of raw.credentials) {
    if (!object(r) || !id(r.user_id) || !userIds.has(r.user_id) || credentials.has(r.user_id) || !hashValid(r.hash)) return invalid('credential row')
    credentials.add(r.user_id)
  }
  if (!users.some(u => u.role === 'ceo' && u.status === 'active' && credentials.has(String(u.id)))) return invalid('no active CEO account with a password')
  const files = new Set<string>()
  for (const f of raw.files) {
    if (!object(f) || !id(f.id) || files.has(f.id) || !text(f.name,200) || !text(f.mime,100) || !date(f.created_at) || (f.owner !== null && !id(f.owner)) || !Number.isInteger(f.size) || Number(f.size) < 0 || Number(f.size) > 3*1024*1024 || typeof f.data !== 'string' || Buffer.from(f.data,'base64').length !== f.size || Buffer.from(f.data,'base64').toString('base64') !== f.data) return invalid('attachment row')
    files.add(f.id)
  }
  const data = Object.fromEntries(COLLECTIONS.map(c => [c, fromEntries(c, by.get(c) ?? [])])) as unknown as Data
  if (!Array.isArray(data.statusSets.office) || !data.statusSets.office.length || !Array.isArray(data.teams) || !data.teams.length) return invalid('required studio configuration')
  const reviewSources=new Set<string>()
  for (const [key,t] of Object.entries(data.tasks)) {
    if (!object(t) || t.id !== key || !id(t.projectId) || !text(t.name,10000) || (t.parentId !== null && !id(t.parentId))) return invalid('task identity')
    if(t.reviewSourceTaskId){const source=data.tasks[t.reviewSourceTaskId];if(t.kind!=='supervision'||!source||!(source.kind==='document'||source.kind==='manual'||source.kind==='doctype'&&source.source==='manual')||source.projectId!==t.projectId||reviewSources.has(t.reviewSourceTaskId))return invalid('document review linkage');reviewSources.add(t.reviewSourceTaskId)}
  }
  // Parent traversals throughout the UI assume acyclic relationships.
  const checked = new Set<string>()
  for (const task of Object.values(data.tasks)) {
    const chain = new Set<string>(); let cur = task
    while (cur && !checked.has(cur.id)) {
      if (chain.has(cur.id)) return invalid('cyclic task hierarchy')
      chain.add(cur.id); cur = cur.parentId ? data.tasks[cur.parentId] : undefined!
    }
    for (const key of chain) checked.add(key)
  }
  return raw as unknown as Payload
}

export async function openBackup(archive: Buffer, passphrase: string) {
  if (archive.length <= HEADER || archive.length > MAX_BACKUP_BYTES || !archive.subarray(0,MAGIC.length).equals(MAGIC)) throw new BackupError('Choose a valid Avand backup file (up to 128 MB).')
  const p = MAGIC.length, key = await keyOf(backupPassphrase(passphrase), archive.subarray(p,p+16))
  let plain: Buffer | undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm',key,archive.subarray(p+16,p+28))
    decipher.setAAD(MAGIC); decipher.setAuthTag(archive.subarray(p+28,HEADER))
    plain = Buffer.concat([decipher.update(archive.subarray(HEADER)),decipher.final()])
  } catch { throw new BackupError('Incorrect backup passphrase or damaged backup file.') }
  finally { key.fill(0) }
  try { return validateBackup(JSON.parse(plain.toString('utf8'))) }
  catch (e) { if (e instanceof BackupError) throw e; throw new BackupError('Invalid backup data.') }
  finally { plain.fill(0) }
}

export function backupSummary(payload: Payload, archive?: Buffer) {
  const count = (kind: Collection) => payload.entities.filter(r=>r.kind===kind).length
  return { createdAt:payload.createdAt, users:count('users'), projects:count('projects'), tasks:count('tasks'), files:payload.files.length, records:payload.entities.length, ...(archive ? { fingerprint:createHash('sha256').update(archive).digest('hex') } : {}) }
}
async function snapshot(c: Tx): Promise<Payload> {
  const size = await c.query<{ total: string }>(`SELECT (COALESCE((SELECT sum(octet_length(data::text)+octet_length(id)+octet_length(kind)+100) FROM entities),0) + COALESCE((SELECT sum(size*2+500) FROM files),0) + COALESCE((SELECT sum(octet_length(hash)+200) FROM credentials),0))::text AS total`)
  if (Number(size.rows[0]?.total)>MAX_BACKUP_BYTES) throw new BackupError('The database is too large for an in-app backup. Use a database-level backup instead.')
  const entities = (await c.query<Entity>('SELECT kind,id,data FROM entities ORDER BY ins')).rows
  const credentials = (await c.query<Credential>('SELECT user_id,hash FROM credentials ORDER BY user_id')).rows
  const files = (await c.query<Omit<StoredFile,'data'|'created_at'> & { data:Buffer; created_at:Date }>('SELECT id,name,mime,size,data,owner,created_at FROM files ORDER BY id')).rows.map(f=>({...f, data:f.data.toString('base64'), created_at:f.created_at.toISOString()}))
  return validateBackup({ format:1,createdAt:new Date().toISOString(),collections:COLLECTIONS,entities,credentials,files })
}
export async function exportBackup(db: Db, passphrase: string) {
  const payload = await tx(db, async c => { await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); return snapshot(c) })
  return sealBackup(payload,passphrase)
}

/** Destination replacement and encrypted rollback snapshot are one transaction. Sessions never migrate. */
export async function restoreBackup(db: Db, payload: Payload, passphrase: string, current: State, actorName: string): Promise<State> {
  const by = new Map<Collection,[string,unknown][]>()
  for (const row of payload.entities) { if (!by.has(row.kind)) by.set(row.kind,[]); by.get(row.kind)!.push([row.id,row.data]) }
  const data = upgradeManualDocTypes(Object.fromEntries(COLLECTIONS.map(c=>[c,fromEntries(c,by.get(c)??[])])) as unknown as Data)
  let next: State = { ...current,...data, users:data.users.map(u=>resolveRole(data.roleDefinitions,u)), session:null, denial:null, nav:{page:'home'}, openTaskId:null, profileUserId:null, profileTab:'profile' }
  next.syncRuns = next.syncRuns.map(r=>r.state==='running'?{...r,state:'failed',log:[...r.log,{level:'error',text:'Interrupted by backup restore.'}]}:r)
  next.audit = [{id:`backup-${randomBytes(12).toString('hex')}`, at:new Date().toISOString(), userId:'system', kind:'admin',text:`Company backup restored on this server by ${actorName}.`},...next.audit]
  next=reconcileDocumentReviews(next)
  next.scores = reconcileScores(next)
  await tx(db,async c=>{
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const recovery = await sealBackup(await snapshot(c),passphrase)
    await c.query('INSERT INTO backup_recovery (slot,data) VALUES (1,$1) ON CONFLICT (slot) DO UPDATE SET data=EXCLUDED.data,created_at=now()', [recovery])
    await c.query('DELETE FROM sessions')
    await c.query('DELETE FROM credentials')
    await c.query('DELETE FROM files')
    await c.query('DELETE FROM entities')
    // Recreate insertion order; newest-first collections are persisted oldest-first.
    for (const kind of COLLECTIONS) {
      const entries = entriesOf(kind,next[kind]); const shape = SHAPES[kind]
      if (shape.type==='array' && shape.order==='prepend') entries.reverse()
      for(let i=0;i<entries.length;i+=500) await c.query(`INSERT INTO entities (kind,id,data) SELECT $1,e.value->>'id',e.value->'data' FROM json_array_elements($2::json) WITH ORDINALITY AS e(value,n) ORDER BY e.n`,[kind,JSON.stringify(entries.slice(i,i+500).map(([id,data])=>({id,data})))])
    }
    for (const r of payload.credentials) await c.query('INSERT INTO credentials(user_id,hash) VALUES($1,$2)',[r.user_id,r.hash])
    for (const f of payload.files) await c.query('INSERT INTO files(id,name,mime,size,data,owner,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.id,f.name,f.mime,f.size,Buffer.from(f.data,'base64'),f.owner,f.created_at])
    await c.query("DELETE FROM meta WHERE key='lastScheduledSync'")
  })
  return next
}

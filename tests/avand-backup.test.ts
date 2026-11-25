import assert from 'node:assert/strict'
import { productionState } from '../server/bootstrap'
import { hashPassword, setPassword, verifyPassword } from '../server/auth'
import { backupSummary, openBackup, sealBackup, validateBackup } from '../server/backup'
import { diffData, loadData } from '../server/db'
import { COLLECTIONS } from '../src/lib/collections'
import { startServer } from '../server/main'
import { emptyStaffing } from '../src/lib/organization'
import type { Project, Task, User } from '../src/lib/types'

const sourcePassword='test-only-source-account', destinationPassword='test-only-destination-account', memberPassword='test-only-member-account'
const passphrase='test-only-source-backup-phrase', recoveryPhrase='test-only-destination-recovery-phrase'
const seed=productionState({ username:'source-ceo',password:sourcePassword,name:'Source CEO' }).state
const now=new Date().toISOString()
const fileBytes=Buffer.from('Test architectural document, UTF-8: نمونه')
const fileId='fl-qa-backup'
const entityRows=diffData(null,seed).flatMap(c=>c.upsert.map(([id,data])=>({kind:c.kind,id,data})))
const payload=validateBackup({format:1,createdAt:now,collections:COLLECTIONS,entities:entityRows,credentials:[{user_id:'u-ceo',hash:await hashPassword(sourcePassword)}],files:[{id:fileId,name:'report.txt',mime:'text/plain',size:fileBytes.length,data:fileBytes.toString('base64'),owner:'u-ceo',created_at:now}]})
const sealed=await sealBackup(payload,passphrase)
assert.equal(sealed.includes(Buffer.from('source-ceo')),false)
assert.deepEqual(await openBackup(sealed,passphrase),payload)
assert.notDeepEqual(await sealBackup(payload,passphrase),sealed,'random salt and IV')
await assert.rejects(openBackup(sealed,'wrong-backup-password'),/Incorrect backup passphrase/)
const tampered=Buffer.from(sealed);tampered[tampered.length-1]^=1
await assert.rejects(openBackup(tampered,passphrase),/damaged backup file/)
assert.throws(()=>validateBackup({...payload,credentials:[]}),/active CEO/)
assert.throws(()=>validateBackup({...payload,entities:[...payload.entities,payload.entities[0]]}),/duplicate entity/)
assert.throws(()=>validateBackup({...payload,files:[{...payload.files[0],size:1}]}),/attachment row/)
assert.equal(backupSummary(payload,sealed).files,1)
console.log('Backup encryption, authentication, schema validation, credentials, and binary integrity passed.')

// Optional real integration run against a purpose-created loopback-only test cluster. Never use the production DB.
const qa=process.env.AVAND_BACKUP_QA_DB
if(qa){
  const base=new URL(qa)
  assert.equal(base.hostname,'127.0.0.1');assert.equal(base.port,'55439')
  const makeEnv=(db:string,username:string,password:string)=>{const url=new URL(base);url.pathname='/'+db;return {DATABASE_URL:url.href,HOST:'127.0.0.1',TARAZ_ADMIN_USERNAME:username,TARAZ_ADMIN_PASSWORD:password,TARAZ_ADMIN_NAME:username,TARAZ_SYNC_SCHEDULE:'off'}}
  const src=await startServer({env:makeEnv('avand_backup_source','source-ceo',sourcePassword),port:0,log:()=>{}})
  const dst=await startServer({env:makeEnv('avand_backup_target','target-ceo',destinationPassword),port:0,log:()=>{}})
  const post=(port:number,path:string,body:unknown,cookie?:string)=>fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)})
  const login=async(port:number,username:string,password:string)=>{const res=await post(port,'/api/auth/login',{username,password});assert.equal(res.status,200,await res.clone().text());return res.headers.get('set-cookie')!.split(';')[0]}
  try{
    const project:Project={id:'QA-PROJECT',code:'QA-PROJECT',name:'Project نمونه',type:'Office',phase1TeamId:'p1a',sdTeamId:'p1b',phase2TeamId:'p2a',mdrUrl:'',mdrTab:'MDR',staffing:emptyStaffing()}
    const task:Task={id:'QA-TASK',projectId:project.id,parentId:null,kind:'manual',source:'manual',workScope:'sd',name:'Schematic Design',order:1,statusId:src.core.state.statusSets.office[0].id}
    const member:User={...src.core.state.users[0],id:'u-qa-member',username:'test-member',name:'Test member',role:'member',teamId:'p1b'}
    await src.core.exclusive(()=>src.core.commit({...src.core.state,users:[...src.core.state.users,member],projects:[project],tasks:{[task.id]:task},comments:[{id:'comment-qa',taskId:task.id,userId:member.id,at:now,text:'Test comment',mentions:[]}],attachments:[{id:'att-qa',taskId:task.id,name:'report.txt',mime:'text/plain',size:fileBytes.length,dataUrl:`/api/files/${fileId}`,uploadedBy:member.id,uploadedAt:now}],personalTasks:{private:{id:'private',ownerId:member.id,parentId:null,title:'Private test',statusId:'todo',priority:'normal',order:1,createdAt:now,updatedAt:now}}},async c=>{await setPassword(c,member.id,memberPassword);await c.query('INSERT INTO files(id,name,mime,size,data,owner) VALUES($1,$2,$3,$4,$5,$6)',[fileId,'report.txt','text/plain',fileBytes.length,fileBytes,member.id])}))
    const sc=await login(src.port,'source-ceo',sourcePassword), dc=await login(dst.port,'target-ceo',destinationPassword), mc=await login(src.port,'test-member',memberPassword)
    assert.equal((await post(src.port,'/api/backup/download',{password:memberPassword,passphrase},mc)).status,403)
    assert.equal((await post(src.port,'/api/backup/download',{password:sourcePassword,passphrase})).status,401)
    assert.equal((await post(src.port,'/api/backup/download',{password:'incorrect',passphrase},sc)).status,403)
    const download=await post(src.port,'/api/backup/download',{password:sourcePassword,passphrase},sc)
    assert.equal(download.status,200,await download.clone().text());assert.match(download.headers.get('content-disposition')!,/\.avandbackup/)
    const archive=Buffer.from(await download.arrayBuffer()).toString('base64')
    const inspect=await post(dst.port,'/api/backup/inspect',{password:destinationPassword,passphrase,archive},dc)
    assert.equal(inspect.status,200,await inspect.clone().text());const summary=await inspect.json();assert.equal(summary.projects,1);assert.equal(summary.tasks,1);assert.equal(summary.files,1)
    const body={password:destinationPassword,passphrase,recoveryPassphrase:recoveryPhrase,archive,fingerprint:summary.fingerprint,confirmation:'RESTORE',replaceAccepted:true}
    assert.equal((await post(dst.port,'/api/backup/restore',{...body,confirmation:'no'},dc)).status,400)
    assert.equal(dst.core.state.projects.length,0)
    // Force a failure near the end of the restore transaction. Prior rows and sessions must survive.
    await dst.db.query("ALTER TABLE files ADD CONSTRAINT qa_file_reject CHECK (id <> 'fl-qa-backup')")
    assert.equal((await post(dst.port,'/api/backup/restore',body,dc)).status,500)
    assert.equal((await loadData(dst.db)).users[0].username,'target-ceo')
    assert.equal((await fetch(`http://127.0.0.1:${dst.port}/api/state`,{headers:{cookie:dc}})).status,200)
    assert.equal((await dst.db.query('SELECT count(*)::int AS n FROM backup_recovery')).rows[0].n,0)
    await dst.db.query('ALTER TABLE files DROP CONSTRAINT qa_file_reject')
    const restored=await post(dst.port,'/api/backup/restore',body,dc)
    assert.equal(restored.status,200,await restored.clone().text());assert.match(restored.headers.get('set-cookie')!,/Max-Age=0/)
    assert.equal((await fetch(`http://127.0.0.1:${dst.port}/api/state`,{headers:{cookie:dc}})).status,401)
    assert.equal((await post(dst.port,'/api/auth/login',{username:'target-ceo',password:destinationPassword})).status,401)
    const rc=await login(dst.port,'source-ceo',sourcePassword);await login(dst.port,'test-member',memberPassword)
    const stored=await loadData(dst.db)
    assert.equal(stored.projects[0].name,project.name);assert.deepEqual(stored.tasks[task.id],task);assert.equal(stored.comments[0].text,'Test comment');assert.equal(stored.personalTasks.private.title,'Private test')
    const file=await fetch(`http://127.0.0.1:${dst.port}/api/files/${fileId}`,{headers:{cookie:rc}})
    assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),fileBytes)
    const recovery=await post(dst.port,'/api/backup/recovery',{password:sourcePassword},rc);assert.equal(recovery.status,200)
    const previous=await openBackup(Buffer.from(await recovery.arrayBuffer()),recoveryPhrase);assert.equal(backupSummary(previous).projects,0)
    assert.equal((previous.entities.find(r=>r.kind==='users')!.data as User).username,'target-ceo')
    assert.equal(await verifyPassword(destinationPassword,previous.credentials[0].hash),true)
    assert.equal(src.core.state.projects[0].id,project.id)
    console.log('Real PostgreSQL server-to-server transfer passed: auth denial, preview, confirmation, failed-write rollback, atomic restore, all sessions revoked, accounts, records, files, and encrypted recovery copy.')
  }finally{await Promise.all([src.close(),dst.close()])}
}

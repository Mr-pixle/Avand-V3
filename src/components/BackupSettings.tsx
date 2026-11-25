import { useState } from 'react'
import { Archive, Download, FileCheck2, LockKeyhole, ShieldAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Checkbox } from './ui/checkbox'
import { api } from '@/lib/remote'
import { useStore } from '@/lib/store'

const MAX_BYTES = 128*1024*1024
type Summary = { createdAt:string; users:number; projects:number; tasks:number; files:number; records:number; fingerprint:string }
const encodeFile = (file:File) => new Promise<string>((resolve,reject)=>{
  const reader=new FileReader(); reader.onerror=()=>reject(new Error('The backup file could not be read.'))
  reader.onload=()=>resolve(String(reader.result).split(',',2)[1]??''); reader.readAsDataURL(file)
})
async function download(path:string,body:unknown) {
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'})
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error??'The download failed.')}
  const blob=await response.blob(), url=URL.createObjectURL(blob)
  const link=document.createElement('a'); link.href=url; link.download=/filename="([^"\r\n]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??'Avand.avandbackup'
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),30_000)
}

export function BackupSettings() {
  const {me}=useStore()
  const [password,setPassword]=useState(''),[passphrase,setPassphrase]=useState(''),[repeat,setRepeat]=useState('')
  const [file,setFile]=useState<File|null>(null),[restorePhrase,setRestorePhrase]=useState(''),[summary,setSummary]=useState<Summary|null>(null)
  const [accepted,setAccepted]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('')
  const [recoveryPhrase,setRecoveryPhrase]=useState(''),[recoveryRepeat,setRecoveryRepeat]=useState('')
  if(me.role!=='ceo') return null
  const resetPreview=()=>{setSummary(null);setAccepted(false);setConfirmation('');setRecoveryPhrase('');setRecoveryRepeat('')}
  const run=async(label:string, action:()=>Promise<void>)=>{
    if(busy)return
    if(!password){setError('Enter your current account password.');return}
    setBusy(label);setError('')
    try {await action()} catch(e){setError(e instanceof Error?e.message:'The operation failed.')} finally{setBusy(null)}
  }
  const create=()=>run('Creating encrypted backup…',async()=>{
    if(passphrase.length<12||passphrase!==repeat)throw new Error('Enter a matching backup passphrase of at least 12 characters.')
    await download('/api/backup/download',{password,passphrase});setPassphrase('');setRepeat('');setPassword('');toast.success('Encrypted backup downloaded.')
  })
  const inspect=()=>run('Checking backup file…',async()=>{
    resetPreview(); if(!file||restorePhrase.length<12)throw new Error('Choose a backup file and enter its passphrase.')
    setSummary(await api<Summary>('/api/backup/inspect',{password,passphrase:restorePhrase,archive:await encodeFile(file)}))
  })
  const restore=()=>run('Restoring company data…',async()=>{
    if(!file||!summary||!accepted||confirmation!=='RESTORE')throw new Error('Inspect the file and confirm replacement first.')
    if(recoveryPhrase.length<12||recoveryPhrase!==recoveryRepeat||recoveryPhrase===restorePhrase)throw new Error('Enter a matching, separate recovery passphrase of at least 12 characters.')
    await api('/api/backup/restore',{password,passphrase:restorePhrase,recoveryPassphrase:recoveryPhrase,archive:await encodeFile(file),fingerprint:summary.fingerprint,confirmation,replaceAccepted:accepted})
    setPassword('');setRestorePhrase('');setFile(null);resetPreview();toast.success('Restore completed. Sign in with the restored company account.')
    window.location.hash='#home';window.location.reload()
  })
  return <section className="glass-card space-y-4 p-5" aria-label="Company Backup and Restore">
    <header className="flex items-start gap-3"><div className="rounded-xl border bg-background/50 p-2.5"><Archive className="size-5"/></div><div><h2 className="studio-heading">Backup & Restore</h2><p className="mt-1 text-sm text-muted-foreground">Transfer the complete company database between Avand installations. CEO access only.</p></div></header>
    <div className="rounded-xl border bg-background/40 p-3 text-xs text-muted-foreground"><LockKeyhole className="me-1 inline size-3.5"/>Backups are encrypted with your own passphrase and include users, projects, tasks, financial and personal records, settings, history and uploaded files. Keep the file and passphrase separately and use a trusted network or HTTPS. Server configuration and active login sessions are not included. Maximum file size: 128 MB.</div>
    <div className="max-w-sm"><Label htmlFor="backup-account-password">Current account password</Label><Input id="backup-account-password" className="mt-1" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={!!busy}/><p className="mt-1 text-xs text-muted-foreground">Required to authorize every operation.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <fieldset disabled={!!busy} className="space-y-3 rounded-xl border bg-background/30 p-4"><legend className="px-1 font-semibold"><Download className="me-1 inline size-4"/>Create backup</legend><p className="text-sm text-muted-foreground">Download a complete, portable snapshot of this company.</p>
        <div><Label htmlFor="backup-phrase">New backup passphrase</Label><Input id="backup-phrase" className="mt-1" type="password" autoComplete="new-password" value={passphrase} onChange={e=>setPassphrase(e.target.value)} minLength={12} maxLength={200} placeholder="At least 12 characters"/></div>
        <div><Label htmlFor="backup-repeat">Confirm passphrase</Label><Input id="backup-repeat" className="mt-1" type="password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} maxLength={200}/></div>
        <Button type="button" disabled={!!busy||!password||passphrase.length<12||passphrase!==repeat} onClick={create}><Download className="size-4"/>Download encrypted backup</Button>
      </fieldset>
      <fieldset disabled={!!busy} className="space-y-3 rounded-xl border bg-background/30 p-4"><legend className="px-1 font-semibold"><Upload className="me-1 inline size-4"/>Restore backup</legend><p className="text-sm text-muted-foreground">Select a backup from another Avand installation or an earlier snapshot.</p>
        <div><Label htmlFor="backup-file">Avand backup file</Label><Input id="backup-file" className="mt-1" type="file" accept=".avandbackup,application/octet-stream" onChange={e=>{resetPreview(); const chosen=e.target.files?.[0]??null;if(chosen&&chosen.size>MAX_BYTES){setError('Choose a backup file under 128 MB.');setFile(null);e.target.value='';return}setFile(chosen);setError('')}}/></div>
        <div><Label htmlFor="backup-restore-phrase">Backup passphrase</Label><Input id="backup-restore-phrase" className="mt-1" type="password" autoComplete="off" maxLength={200} value={restorePhrase} onChange={e=>{setRestorePhrase(e.target.value);resetPreview()}}/></div>
        <Button type="button" variant="outline" disabled={!!busy||!password||!file||restorePhrase.length<12} onClick={inspect}><FileCheck2 className="size-4"/>Validate and preview</Button>
        {summary&&<div className="space-y-3 border-t pt-3"><div className="text-sm font-semibold">Validated backup · {new Date(summary.createdAt).toLocaleString('en-GB')}</div><dl className="grid grid-cols-2 gap-2 text-sm">{(['users','projects','tasks','files','records'] as const).map(key=><div key={key} className="rounded-lg border p-2"><dt className="capitalize text-xs text-muted-foreground">{key}</dt><dd className="num font-semibold">{summary[key]}</dd></div>)}</dl>
          <p className="rounded-lg border border-destructive/40 bg-danger-soft/40 p-3 text-sm"><ShieldAlert className="me-1 inline size-4"/>Restore replaces the entire destination company. All users will be signed out; use the accounts and passwords from the restored backup. Download a separate backup of the destination first. Stop the old installation before moving the company; connected MDR integrations may resume on this server. An encrypted recovery copy is retained using the separate passphrase below.</p>
          <div><Label htmlFor="backup-recovery-phrase">New destination recovery passphrase</Label><Input id="backup-recovery-phrase" className="mt-1" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={recoveryPhrase} onChange={e=>setRecoveryPhrase(e.target.value)} placeholder="At least 12 characters"/></div>
          <div><Label htmlFor="backup-recovery-repeat">Confirm recovery passphrase</Label><Input id="backup-recovery-repeat" className="mt-1" type="password" autoComplete="new-password" maxLength={200} value={recoveryRepeat} onChange={e=>setRecoveryRepeat(e.target.value)}/></div>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} onCheckedChange={v=>setAccepted(v===true)}/><span>I understand that the entire current company database will be replaced.</span></label>
          <div><Label htmlFor="backup-confirm">Type RESTORE to confirm</Label><Input id="backup-confirm" className="mt-1" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></div>
          <Button type="button" variant="destructive" disabled={!!busy||!password||!accepted||confirmation!=='RESTORE'||recoveryPhrase.length<12||recoveryPhrase!==recoveryRepeat} onClick={restore}><Upload className="size-4"/>Replace company data</Button>
        </div>}
      </fieldset>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><h3 className="text-sm font-semibold">Pre-restore recovery copy</h3><p className="text-xs text-muted-foreground">Download the last destination snapshot, if available. Keep the separate recovery passphrase chosen during restore.</p></div><Button type="button" variant="outline" disabled={!!busy||!password} onClick={()=>run('Downloading recovery copy…',async()=>{await download('/api/backup/recovery',{password});setPassword('');toast.success('Recovery copy downloaded.')})}><Download className="size-4"/>Download recovery copy</Button></div>
    {busy&&<p role="status" className="text-sm text-muted-foreground">{busy} Do not close this page.</p>}
    {error&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
  </section>
}

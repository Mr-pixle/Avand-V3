import { has } from '@/lib/policy'
import { useState } from 'react'
import { IconPicker, ItemIcon } from '@/components/ItemIcon'
import { toast } from 'sonner'
import { PageHeader, Empty } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useStore } from '@/lib/store'
import { CATEGORIES, managesLibrary, type DocumentEntry, type ImportantLink } from '@/lib/workspace'
import { newWorkspaceId, useWorkspaceSave } from '@/lib/useWorkspaceSave'
import type { NewFile } from '@/lib/state'

const select = 'h-10 rounded-md border bg-background px-3 text-sm'
const date = (s: string) => new Date(s).toLocaleString('en-GB-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran' })
export function DocumentsPage() {
  const { state, me, userById } = useStore(), { save, busy } = useWorkspaceSave()
  const [q, setQ] = useState(''), [category, setCategory] = useState('all')
  const [edit, setEdit] = useState<{ id: string; title: string; icon?: string; category: DocumentEntry['category'] } | null>(null)
  const [folder, setFolder] = useState<{ category: keyof typeof CATEGORIES; icon: string } | null>(null)
  const [file, setFile] = useState<NewFile | undefined>(), [reading, setReading] = useState(false)
  const [remove, setRemove] = useState<string | null>(null)
  const manager = managesLibrary(me)
  const create = has(me, 'library.create'), change = has(me, 'library.edit'), drop = has(me, 'library.delete')
  const rows = Object.values(state.documents).filter(d => (category === 'all' || d.category === category) && `${d.title} ${d.file.name}`.toLowerCase().includes(q.toLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
  const readFile = async (f?: File) => {
    setFile(undefined); if (!f) return
    if (!f.size || f.size > 3 * 1024 * 1024) { toast.error("The file size should be between one bytes and 3 MB."); return }
    setReading(true)
    try { const dataUrl = await new Promise<string>((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f) }); setFile({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, dataUrl }) }
    catch { toast.error("No file reading was done.") } finally { setReading(false) }
  }
  return <div className="flex flex-col gap-5"><PageHeader title="Documents" eyebrow="Studio Documents" actions={create && <Button onClick={() => { setFile(undefined); setEdit({ id: newWorkspaceId(), title: '', category: 'checklists' }) }}>Upload File</Button>}>Shared studio documents available for staff to view and download.</PageHeader>
    <div className="flex flex-wrap gap-3"><Input aria-label="File Search" placeholder="Search File Name" value={q} onChange={e => setQ(e.target.value)} className="max-w-sm" /><select aria-label="Category Files" className={select} value={category} onChange={e => setCategory(e.target.value)}><option value="all">All Categories</option>{Object.entries(CATEGORIES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
    {!rows.length && <Empty title="No files were found in this category" />}
    {Object.entries(CATEGORIES).map(([key,label]) => { const files = rows.filter(d => d.category === key); return (category === 'all' || category === key) && (!q || files.length) ? <section key={key} className="glass-card p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><ItemIcon icon={state.folderIcons?.[key as keyof typeof CATEGORIES]} fallback="folder" />{label}</h2>{change && <Button variant="outline" size="sm" onClick={() => setFolder({ category: key as keyof typeof CATEGORIES, icon: state.folderIcons?.[key as keyof typeof CATEGORIES] ?? '' })}>Edit Icon</Button>}</div><div className="grid gap-3 md:grid-cols-2">{files.map(d => <article key={d.id} className="rounded-xl border p-4"><h3 className="flex items-center gap-2 break-words font-semibold"><ItemIcon icon={d.icon} />{d.title}</h3><p className="mt-2 break-all text-sm text-muted-foreground">{d.file.name} · {d.file.mime} · {Math.ceil(d.file.size / 1024)} KB</p><p className="my-2 text-xs text-muted-foreground">{userById[d.uploadedBy]?.name ?? 'User'} · {date(d.uploadedAt)}</p><div className="flex flex-wrap gap-2"><a className="rounded-md border px-3 py-2 text-sm" href={d.file.dataUrl} download={d.file.name}>Download</a>{manager && <>{change && <Button variant="outline" disabled={busy} onClick={() => { setFile(undefined); setEdit({ id:d.id,title:d.title,category:d.category,icon:d.icon }) }}>Edit/Replace</Button>}{drop && <Button variant="ghost" disabled={busy} onClick={() => setRemove(d.id)}>Delete</Button>}</>}</div></article>)}</div></section> : null })}
    <Dialog open={!!folder} onOpenChange={v => { if (!v && !busy) setFolder(null) }}>
      <DialogContent dir="ltr"><DialogHeader><DialogTitle>Icon {folder && CATEGORIES[folder.category]}</DialogTitle><DialogDescription>Select the folder icon for the organization library.</DialogDescription></DialogHeader>
        {folder && <form className="grid gap-3" onSubmit={async e => { e.preventDefault(); if (await save({ type: 'folderIconSave', ...folder })) setFolder(null) }}>
          <IconPicker value={folder.icon} onChange={icon => setFolder(current => current && { ...current, icon })} fallback="folder" />
          <Button disabled={busy}>Save icon</Button>
        </form>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!edit} onOpenChange={v => { if (!v && !busy) setEdit(null) }}><DialogContent dir="ltr"><DialogHeader><DialogTitle>Document Specification</DialogTitle><DialogDescription>PDF, Word, Excel and other documents; up to 3 MB. In editing, the new file selection replaces the previous version.</DialogDescription></DialogHeader>{edit && <form className="grid gap-3" onSubmit={async e => { e.preventDefault(); if (await save({ type:'docSave',...edit,...(file ? {files:[file]} : {}) })) setEdit(null) }}><label>Title<Input required maxLength={200} value={edit.title} onChange={e => setEdit({...edit,title:e.target.value})} /></label><label>Category<select className={`${select} w-full`} value={edit.category} onChange={e => setEdit({...edit,category:e.target.value as DocumentEntry['category']})}>{Object.entries(CATEGORIES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><IconPicker value={edit.icon} onChange={icon => setEdit(current => current && { ...current, icon })} fallback="file" /><label>File<Input type="file" onChange={e => void readFile(e.target.files?.[0])} /></label><Button disabled={busy || reading || (!state.documents[edit.id] && !file)}>{busy || reading ? "Saved..." : "Save Document"}</Button></form>}</DialogContent></Dialog>
    <Dialog open={!!remove} onOpenChange={v => { if (!v) setRemove(null) }}><DialogContent dir="ltr"><DialogHeader><DialogTitle>Delete Document</DialogTitle><DialogDescription>This document is removed from the repository and access of users.</DialogDescription></DialogHeader><Button variant="destructive" disabled={busy} onClick={async () => { if (remove && await save({type:'docDelete',id:remove},"The document was deleted")) setRemove(null) }}>Delete Document</Button></DialogContent></Dialog>
  </div>
}
export function LinksPage() {
  const { state, me } = useStore(), { save, busy } = useWorkspaceSave()
  const [edit, setEdit] = useState<Omit<ImportantLink,'updatedAt'> | null>(null), [q,setQ] = useState(''), [remove,setRemove] = useState<string|null>(null)
  const manager = managesLibrary(me)
  const create = has(me, 'library.create'), change = has(me, 'library.edit'), drop = has(me, 'library.delete')
  return <div className="flex flex-col gap-5"><PageHeader title="Links" eyebrow="Studio Resources" actions={create && <Button onClick={() => setEdit({id:newWorkspaceId(),title:'',kind:'website',address:'',description:'',icon:'globe'})}>New Link</Button>}>Frequently used websites, systems and email addresses.</PageHeader><Input aria-label="Search links" placeholder="Search links" value={q} onChange={e=>setQ(e.target.value)} />{(['website','email'] as const).map(kind => <section key={kind}><h2 className="mb-3 font-semibold">{kind === 'website' ? 'Websites and Systems' : 'Company Email Addresses'}</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.values(state.importantLinks).filter(l => l.kind === kind && `${l.title} ${l.address}`.toLowerCase().includes(q.toLowerCase())).map(l => <article key={l.id} className="glass-card p-4"><a className="inline-flex items-center gap-2 font-semibold text-azure-ink underline-offset-4 hover:underline" href={kind === 'email' ? `mailto:${l.address}` : l.address} target={kind === 'website' ? '_blank' : undefined} rel="noopener noreferrer"><ItemIcon icon={l.icon} fallback={kind === 'email' ? 'mail' : 'globe'} />{l.title}</a><p className="my-2 break-all text-sm" dir="ltr"><a href={kind === 'email' ? `mailto:${l.address}` : l.address} target={kind === 'website' ? '_blank' : undefined} rel="noopener noreferrer">{l.address}</a></p><p className="text-sm text-muted-foreground">{l.description}</p>{manager && <div className="mt-3 flex gap-2">{change && <Button variant="outline" onClick={()=>setEdit(l)}>Edit</Button>}{drop && <Button variant="ghost" onClick={()=>setRemove(l.id)}>Delete</Button>}</div>}</article>)}</div></section>)}
    <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null)}}><DialogContent dir="ltr"><DialogHeader><DialogTitle>Link Profile</DialogTitle><DialogDescription>Enter a web address with http or https, or a valid email address.</DialogDescription></DialogHeader>{edit && <form className="grid gap-3" onSubmit={async e=>{e.preventDefault();if(await save({type:'linkSave',link:edit}))setEdit(null)}}><label>Title<Input required maxLength={200} value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label>Type<select className={`${select} w-full`} value={edit.kind} onChange={e=>setEdit({...edit,kind:e.target.value as ImportantLink['kind']})}><option value="website">Website</option><option value="email">Email</option></select></label><label>Address<Input dir="ltr" required type={edit.kind==='email'?'email':'url'} maxLength={2000} value={edit.address} onChange={e=>setEdit({...edit,address:e.target.value})}/></label><label>Description<Input maxLength={2000} value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label><IconPicker value={edit.icon} onChange={icon => setEdit(current => current && { ...current, icon })} fallback={edit.kind === "email" ? "mail" : "globe"} /><Button disabled={busy}>Save Link</Button></form>}</DialogContent></Dialog>
    <Dialog open={!!remove} onOpenChange={v=>{if(!v)setRemove(null)}}><DialogContent dir="ltr"><DialogHeader><DialogTitle>Delete Link</DialogTitle><DialogDescription>The link is removed from the organization list.</DialogDescription></DialogHeader><Button variant="destructive" disabled={busy} onClick={async()=>{if(remove&&await save({type:'linkDelete',id:remove},"The link was deleted"))setRemove(null)}}>Delete Link</Button></DialogContent></Dialog>
  </div>
}

import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useFmt, useStore, getRemote } from '@/lib/store'
import { api } from '@/lib/remote'
import { useWorkspaceSave } from '@/lib/useWorkspaceSave'
import { englishDigits } from '@/lib/digits'
import type { BoardScene, Whiteboard } from '@/lib/whiteboards'

const emptyScene = (): BoardScene => ({ elements: [], files: {}, settings: { grid: false, snap: false } })

export default function Whiteboards({ projectId }: { projectId: string }) {
  const { state, can } = useStore()
  const { time, digits } = useFmt()
  const { save, busy } = useWorkspaceSave()
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const boards = Object.values(state.whiteboards).filter(b => b.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const current = boards.find(b => b.id === selected)
  const add = async (source?: Whiteboard) => {
    const id = 'wb-' + crypto.randomUUID()
    const title = source ? (source.title + '  (copy)').slice(0, 100) : 'Board ' + (boards.length + 1)
    if (await save({ type: 'whiteboardSave', board: { id, projectId, title, scene: source?.scene ?? emptyScene(), revision: 0 } })) setSelected(id)
  }
  if (current) return <section className="glass-card space-y-2 p-2" data-avand-whiteboard>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setSelected('')}>All Whiteboards</Button>
      <span className="text-xs text-muted-foreground">Last saved {time(current.updatedAt)}</span>
    </div>
    <BoardEditor key={current.id} board={current} editable={can.perm('whiteboard.edit')} theme={state.theme} />
  </section>

  return <section className="glass-card space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="me-auto font-semibold">Project Whiteboards</h2>
      <Input aria-label="Search whiteboards" placeholder="Search whiteboards" className="max-w-56" value={query} onChange={e => setQuery(e.target.value)} />
      {can.perm('whiteboard.create') && <Button disabled={busy} onClick={() => void add()}>New Whiteboard</Button>}
    </div>
    {boards.length === 0 && <p className="text-sm text-muted-foreground">No whiteboards in this project yet.</p>}
    {boards.filter(b => b.title.toLowerCase().includes(query.trim().toLowerCase())).map(b => <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <button className="me-auto text-start font-medium hover:underline" onClick={() => { setDeleteId(''); setSelected(b.id) }}>{digits(b.title)}</button>
      <span className="text-xs text-muted-foreground">{time(b.updatedAt)}</span>
      {can.perm('whiteboard.create') && <Button size="sm" variant="outline" disabled={busy} onClick={() => void add(b)}>Duplicate</Button>}
      {can.perm('whiteboard.delete') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteId(b.id)}>Delete</Button>}
      {deleteId === b.id && <><Button variant="destructive" size="sm" disabled={busy} onClick={async () => { if (await save({ type: 'whiteboardDelete', id: b.id, revision: b.revision })) { setDeleteId('') } }}>Confirm deletion</Button><Button variant="ghost" size="sm" onClick={() => { setDeleteId('') }}>Cancel</Button></>}
    </div>)}
  </section>
}

function BoardEditor({ board, editable, theme }: { board: Whiteboard; editable: boolean; theme: 'light' | 'dark' | 'system' }) {
  const [editor, setEditor] = useState<ExcalidrawImperativeAPI>()
  const [title, setTitle] = useState(board.title)
  const [grid, setGrid] = useState(board.scene.settings.grid)
  const [snap, setSnap] = useState(board.scene.settings.snap)
  const [status, setStatus] = useState('')
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const revision = useRef(board.revision)
  const saved = useRef(JSON.stringify({ title: board.title, scene: board.scene }))
  const draft = useRef({ title: board.title, scene: board.scene })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saving = useRef(false)
  const conflict = useRef(false)
  const saveNow = useRef<() => Promise<void>>(async () => {})
  const dark = theme === 'system' ? systemDark : theme === 'dark'
  const initial = useMemo<ExcalidrawInitialDataState>(() => ({
    elements: board.scene.elements as ExcalidrawElement[],
    files: board.scene.files as BinaryFiles,
    appState: { gridModeEnabled: board.scene.settings.grid, objectsSnapModeEnabled: board.scene.settings.snap },
    scrollToContent: true,
  }), [board.id]) // Keep the open editor's history when a server revision arrives.

  const queue = () => {
    clearTimeout(timer.current)
    if (editable && !conflict.current) timer.current = setTimeout(() => void saveNow.current(), 700)
  }
  saveNow.current = async () => {
    if (!editable || saving.current || conflict.current) return
    const { title, scene } = draft.current
    const payload = JSON.stringify({ title: title.trim(), scene })
    if (!title.trim() || payload === saved.current) return
    saving.current = true
    setStatus('Saving…')
    try {
      await api('/api/action', { action: { type: 'whiteboardSave', board: { id: board.id, projectId: board.projectId, revision: revision.current, title, scene } } })
      revision.current++
      saved.current = payload
      setStatus('Saved')
      await getRemote().load().catch(() => {})
      if (JSON.stringify({ ...draft.current, title: draft.current.title.trim() }) !== saved.current) queue()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save')
    } finally { saving.current = false }
  }
  useEffect(() => {
    if (board.revision > revision.current) {
      conflict.current = true
      clearTimeout(timer.current)
      setStatus('This whiteboard changed in another session. Export your current drawing before opening the latest version.')
    }
  }, [board.revision])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    const flush = () => { clearTimeout(timer.current); void saveNow.current() }
    const checkUnload = (event: BeforeUnloadEvent) => {
      if (JSON.stringify({ ...draft.current, title: draft.current.title.trim() }) !== saved.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', checkUnload)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('beforeunload', checkUnload)
      flush()
    }
  }, [])
  const onChange = (elements: readonly ExcalidrawElement[], app: AppState, files: BinaryFiles) => {
    if (!editable) return
    const scene = { elements: elements.filter(e => !e.isDeleted), files, settings: { grid: app.gridModeEnabled, snap: app.objectsSnapModeEnabled } }
    if (JSON.stringify(scene) === JSON.stringify(draft.current.scene)) return
    draft.current = { ...draft.current, scene }
    queue()
  }
  const addShape = (kind: 'sticky' | 'triangle' | 'polygon' | 'frame') => {
    if (!editor || !editable) return
    const app = editor.getAppState()
    const x = -app.scrollX + 100
    const y = -app.scrollY + 100
    const items = kind === 'frame' ? convertToExcalidrawElements([{ type: 'frame', x, y, width: 360, height: 230, children: [] }]) :
      kind === 'sticky' ? convertToExcalidrawElements([{ type: 'rectangle', x, y, width: 165, height: 120, backgroundColor: '#ffec99', fillStyle: 'solid', label: { text: 'Title / Note', fontSize: 18 } }]) :
      convertToExcalidrawElements([{ type: 'line', x, y, points: kind === 'triangle' ? [[0, 115], [68, 0], [136, 115], [0, 115]] : [[0, 48], [67, 0], [134, 48], [110, 120], [24, 120], [0, 48]] }])
    editor.updateScene({ elements: [...editor.getSceneElementsIncludingDeleted(), ...items] })
  }
  const exportPng = async () => {
    if (!editor) return
    try {
      const blob = await exportToBlob({ elements: editor.getSceneElements(), appState: editor.getAppState(), files: editor.getFiles(), mimeType: 'image/png' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob); link.download = (title.trim() || 'Avand') + '.png'; link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch { toast.error('Could not export the PNG.') }
  }
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Whiteboard Name" className="max-w-56" maxLength={100} disabled={!editable} value={title} onChange={e => { setTitle(e.target.value); draft.current.title = e.target.value; queue() }} />
      <Button size="sm" variant="outline" onClick={() => editor?.scrollToContent(undefined, { fitToViewport: true })}>Fit Content</Button>
      <Button size="sm" variant="outline" onClick={() => editor?.updateScene({ appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as AppState['zoom']['value'] } } })}>Center Canvas</Button>
      {editable && <>
        <Button size="sm" variant="outline" onClick={() => void saveNow.current()}>Save</Button>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} /> Grid</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Snap</label>
      </>}
      <Button size="sm" variant="outline" onClick={() => void exportPng()}>PNG</Button>
      <span role="status" className="text-xs text-muted-foreground">{englishDigits(status)}</span>
    </div>
    {editable && <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" onClick={() => addShape('sticky')}>Sticky Note</Button>
      <Button size="sm" variant="ghost" onClick={() => addShape('frame')}>Frame</Button>
      <Button size="sm" variant="ghost" onClick={() => addShape('triangle')}>Triangle</Button>
      <Button size="sm" variant="ghost" onClick={() => addShape('polygon')}>Polygon</Button>
      <Button size="sm" variant="ghost" onClick={() => { editor?.updateScene({ appState: { currentItemStrokeColor: '#e9a919', currentItemStrokeWidth: 4, currentItemOpacity: 40 } }); editor?.setActiveTool({ type: 'freedraw' }) }}>Highlighter</Button>
    </div>}
    {/* Excalidraw’s package patch keeps its locale from changing the host document. */}
    <CanvasBoundary><div dir="ltr" lang="en" className="avand-whiteboard h-[70vh] min-h-[470px] overflow-hidden rounded-lg border">
      <Excalidraw theme={dark ? 'dark' : 'light'} langCode="en" name={title} initialData={initial} viewModeEnabled={!editable} gridModeEnabled={grid} objectsSnapModeEnabled={snap} excalidrawAPI={setEditor} onChange={onChange} validateEmbeddable={false} UIOptions={{ canvasActions: { toggleTheme: false, loadScene: editable, saveToActiveFile: false } }}>
        <MainMenu>{editable && <MainMenu.DefaultItems.LoadScene />}<MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage /></MainMenu>
      </Excalidraw>
    </div></CanvasBoundary>
  </>
}

class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div role="alert" className="rounded-lg border p-4">
      <p>Could not load the canvas.</p>
      <Button size="sm" variant="outline" onClick={() => this.setState({ failed: false })}>Try again</Button>
    </div> : this.props.children
  }
}

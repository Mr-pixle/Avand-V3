import { projectTeams } from './domain'
import { projectPeople } from './organization'
import { has } from './policy'
import type { State } from './state'
import type { User } from './types'

export interface BoardScene {
  elements: unknown[]
  files: Record<string, unknown>
  settings: { grid: boolean; snap: boolean }
}
export interface Whiteboard {
  id: string
  projectId: string
  title: string
  revision: number
  updatedAt: string
  ownerId: string
  scene: BoardScene
}
export type WhiteboardAction =
  | { type: 'whiteboardSave'; board: Omit<Whiteboard, 'updatedAt' | 'ownerId'> }
  | { type: 'whiteboardDelete'; id: string; revision: number }

export function canViewBoard(state: Pick<State, 'projects'>, user: User | undefined, projectId: string) {
  const project = state.projects.find(p => p.id === projectId)
  return !!project && !project.deletedAt && !!user && has(user, 'project.view') && has(user, 'whiteboard.view') &&
    (has(user, 'plan.all') || projectPeople(project).includes(user.id) || projectTeams(project).includes(user.teamId))
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
const elementTypes = new Set(['rectangle','diamond','ellipse','arrow','line','freedraw','text','image','frame','magicframe'])

export function validScene(value: unknown): value is BoardScene {
  if (!object(value) || !Array.isArray(value.elements) || !object(value.files) || !object(value.settings)) return false
  if (typeof value.settings.grid !== 'boolean' || typeof value.settings.snap !== 'boolean' || value.elements.length > 5000 || Object.keys(value.files).length > 100) return false
  const ids = new Set()
  for (const e of value.elements) {
    if (!object(e) || typeof e.id !== 'string' || !idPattern.test(e.id) || ids.has(e.id) || !elementTypes.has(String(e.type))) return false
    if (![e.x, e.y, e.width, e.height, e.angle].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7)) return false
    if (e.link && (typeof e.link !== 'string' || !/^https?:\/\//i.test(e.link))) return false
    ids.add(e.id)
  }
  for (const [id, file] of Object.entries(value.files)) {
    if (!idPattern.test(id) || !object(file) || file.id !== id || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(file.dataURL)) return false
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(String(file.mimeType)) || !file.dataURL.startsWith('data:' + file.mimeType + ';')) return false
  }
  return JSON.stringify(value).length <= 12 * 1024 * 1024
}

export function whiteboardGuard(state: State, raw: unknown): string | null {
  const action = raw as WhiteboardAction
  const me = state.users.find(u => u.id === state.session)
  const id = action.type === 'whiteboardSave' ? action.board?.id : action.id
  if (typeof id !== 'string' || !/^wb-[a-z0-9-]{1,64}$/.test(id)) return "The board ID is invalid."
  const current = state.whiteboards[id]
  const projectId = action.type === 'whiteboardSave' ? action.board.projectId : current?.projectId
  if (!projectId || !canViewBoard(state, me, projectId) || (current && current.projectId !== projectId)) return "The board is not available to you."
  if (action.type === 'whiteboardDelete' && (!current || !has(me, 'whiteboard.delete'))) return "A board removal license is required."
  if (action.type === 'whiteboardSave' && !has(me, current ? 'whiteboard.edit' : 'whiteboard.create')) return "A board reserve license is required."
  const revision = action.type === 'whiteboardSave' ? action.board.revision : action.revision
  if (revision !== (current?.revision ?? 0)) return "A newer version is saved. Open the board again."
  if (action.type === 'whiteboardSave' && (typeof action.board.title !== 'string' || !action.board.title.trim() || action.board.title.length > 100 || !validScene(action.board.scene))) return "The title or content of the board is not valid. The ceiling size is 12 MB."
  return null
}

export function applyWhiteboard(state: State, action: WhiteboardAction): State {
  const whiteboards = { ...state.whiteboards }
  if (action.type === 'whiteboardDelete') delete whiteboards[action.id]
  else {
    const { id, title, projectId, revision, scene } = action.board
    whiteboards[id] = { id, title: title.trim(), projectId, scene, revision: revision + 1, updatedAt: new Date().toISOString(), ownerId: whiteboards[id]?.ownerId ?? state.session! }
  }
  return { ...state, whiteboards }
}

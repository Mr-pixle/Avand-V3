import { has, PERMISSION_MATRIX, ROLE_FA, ROLE_ORDER, type Perm } from './policy'
import type { State } from './state'
import type { Role, User } from './types'

export interface RoleDefinition {
  id: string
  name: string
  description: string
  permissions: Perm[]
}

export type RoleAction =
  | { type: 'roleSave'; role: RoleDefinition }
  | { type: 'roleDelete'; id: string }
  | { type: 'roleAssign'; userId: string; roleId: string }

export function defaultRole(role: Role): RoleDefinition {
  return { id: role, name: ROLE_FA[role], description: '', permissions: (Object.keys(PERMISSION_MATRIX) as Perm[]).filter(p => PERMISSION_MATRIX[p].includes(role)) }
}

export function roleLabel(definitions: State['roleDefinitions'], user: User) {
  return definitions[user.customRoleId ?? user.role]?.name ?? ROLE_FA[user.role]
}

export function resolveRole(definitions: State['roleDefinitions'], user: User): User {
  const role = user.role === 'sysadmin' ? 'control' : user.role
  const id = user.customRoleId ?? role
  const definition = Object.hasOwn(definitions, id) ? definitions[id] : undefined
  return { ...user, rolePermissions: definition?.permissions }
}

export function roleGuard(state: State, raw: unknown): string | null {
  const action = raw as RoleAction
  const me = state.users.find(user => user.id === state.session)
  if (!has(me, 'roles.manage')) return "Role management is in the hands of the CEO."
  const definitions = state.roleDefinitions
  const builtIn = (id: string) => (ROLE_ORDER as readonly string[]).includes(id)
  if (action.type === 'roleAssign') {
    const target = state.users.find(user => user.id === action.userId)
    if (!target || target.role === 'ceo' || action.roleId === 'ceo') return "The role of the CEO does not change from this section."
    return builtIn(action.roleId) || (typeof action.roleId === 'string' && Object.hasOwn(definitions, action.roleId)) ? null : "The role was not found."
  }
  if (action.type === 'roleDelete') {
    if (builtIn(action.id) || !Object.hasOwn(definitions, action.id)) return "Only the custom role can be removed."
    return state.users.some(user => user.customRoleId === action.id) ? "First, change the role of dependent users." : null
  }
  const r = action.role
  if (!r || typeof r.id !== 'string' || r.id === 'ceo' || (!builtIn(r.id) && !/^role-[a-z0-9-]{1,60}$/.test(r.id))) return "Role ID is invalid."
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || typeof r.description !== 'string' || r.description.length > 400) return "Check the name and description of the role."
  if (Object.values(definitions).some(role => role.id !== r.id && role.name.trim() === r.name.trim())) return "This name has already been registered for another role."
  if (!Array.isArray(r.permissions) || r.permissions.length > Object.keys(PERMISSION_MATRIX).length || new Set(r.permissions).size !== r.permissions.length || r.permissions.some(p => !Object.hasOwn(PERMISSION_MATRIX, p) || p === 'roles.manage')) return "The role list is invalid."
  return null
}

export function applyRoleAction(state: State, action: RoleAction): State {
  const roleDefinitions = { ...state.roleDefinitions }
  let users = state.users
  if (action.type === 'roleSave') {
    const { id, name, description, permissions } = action.role
    roleDefinitions[id] = { id, name: name.trim(), description: description.trim(), permissions }
  } else if (action.type === 'roleDelete') {
    delete roleDefinitions[action.id]
  } else {
    const custom = action.roleId.startsWith('role-')
    users = users.map(user => user.id === action.userId ? {
      ...user, role: custom ? 'member' : action.roleId as Role, customRoleId: custom ? action.roleId : undefined,
    } : user)
  }
  return { ...state, roleDefinitions, users: users.map(user => resolveRole(roleDefinitions, user)) }
}

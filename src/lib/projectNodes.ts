import type {Task} from './types'
import {taskScope} from './organization'
import {isWorkItem} from './domain'
export const PROJECT_NODE_LABELS={manual:'Task',phase:'Phase',stage:'Stage',doctype:'Doc Type',subtask:'Sub Task'} as const
export type ProjectNodeChoice=keyof typeof PROJECT_NODE_LABELS
export function acceptsProjectParent(kind:ProjectNodeChoice,parent:Task|undefined){
 if(kind==='phase')return !parent
 if(kind==='stage')return parent?.kind==='phase'
 if(kind==='doctype')return !parent||['phase','stage','group','doctype'].includes(parent.kind)||isWorkItem(parent)
 if(kind==='subtask')return !!parent&&isWorkItem(parent)
 return !parent||['phase','stage','group','doctype'].includes(parent.kind)
}
export function projectNodeProblem(tasks:Record<string,Task>,t:Task){
 if(!['manual','phase','stage','doctype'].includes(t.kind))return "The type of project structure is invalid."
 const parent=t.parentId?tasks[t.parentId]:undefined
 if(t.parentId&&(!parent||parent.projectId!==t.projectId||parent.removedFromMdr))return "The active parent must belong to this project."
 const choice=t.kind==='manual'&&parent&&isWorkItem(parent)?'subtask':t.kind as ProjectNodeChoice
 if(!acceptsProjectParent(choice,parent))return "The parent is not compatible with the selected level: the stage below the stage, the doctor type below the stage or group, and the subtask below the task or document."
 const scope=parent?taskScope(tasks,parent):undefined
 if(scope&&t.workScope&&scope!==t.workScope&&!(scope==='phase2'&&t.workScope==='revit'))return "The responsible phase must be coordinated with the parent branch."
 if(!isWorkItem(t)&&(t.assigneeUserId||t.assigneeTeamId||t.statusId))return "The state and progress of structural levels are calculated from sub-tasks."
 return null
}

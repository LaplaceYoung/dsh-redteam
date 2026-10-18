import React from 'react';
import type { RedTeamTask } from '../types.js';
import type { TaskWorkspace, TaskWorkspaceAction } from './contracts.js';
export declare function ModelsEditor({ task, workspace, busy, act }: {
    task: RedTeamTask;
    workspace: TaskWorkspace;
    busy: boolean;
    act: (action: TaskWorkspaceAction) => Promise<boolean>;
}): React.JSX.Element;

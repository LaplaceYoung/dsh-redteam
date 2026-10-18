import React from 'react';
import type { NewTaskInput, TaskCategory, TaskTemplate, TaskTemplateInput } from '../task-management/index.js';
import type { RedTeamTask } from '../types.js';
export declare function Field({ label, hint, children }: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}): React.JSX.Element;
export declare function CategorySelect({ categories, value, onChange, label }: {
    categories: TaskCategory[];
    value: string;
    onChange: (id: string) => void;
    label?: string;
}): React.JSX.Element;
export declare function NewTaskForm({ categories, templates, tasks, busy, onCreate, onCancel }: {
    categories: TaskCategory[];
    templates: TaskTemplate[];
    tasks: RedTeamTask[];
    busy: boolean;
    onCreate: (input: NewTaskInput) => Promise<boolean>;
    onCancel: () => void;
}): React.JSX.Element;
export declare function TemplateForm({ value, categories, busy, onSave, onCancel }: {
    value?: TaskTemplate;
    categories: TaskCategory[];
    busy: boolean;
    onSave: (input: TaskTemplateInput) => Promise<boolean>;
    onCancel: () => void;
}): React.JSX.Element;

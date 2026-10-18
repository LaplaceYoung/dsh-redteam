import React from 'react';
import type { Goal, Constraint, ScopeEntry } from '../types.js';
export declare function DeleteAction({ label, disabled, onDelete }: {
    label: string;
    disabled: boolean;
    onDelete: () => Promise<boolean>;
}): React.JSX.Element;
export declare function GoalsEditor({ goals, busy, onSave, onDelete }: {
    goals: Goal[];
    busy: boolean;
    onSave: (id: string | undefined, text: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<boolean>;
}): React.JSX.Element;
export declare function ConstraintsEditor({ constraints, scopes, busy, onSave, onDelete }: {
    constraints: Constraint[];
    scopes: ScopeEntry[];
    busy: boolean;
    onSave: (id: string | undefined, text: string, kind: 'allow' | 'deny') => Promise<boolean>;
    onDelete: (id: string) => Promise<boolean>;
}): React.JSX.Element;

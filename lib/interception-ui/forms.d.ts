import React from 'react';
import { type Rule, type Settings } from './api.js';
export declare function RuleForm({ value, onSaved, onCancel }: {
    value?: Rule;
    onSaved: () => void;
    onCancel: () => void;
}): React.JSX.Element;
export declare function JudgeSettings({ initial }: {
    initial: Settings;
}): React.JSX.Element;

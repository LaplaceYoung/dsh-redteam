import React from 'react';
export declare const conversationPath = "/api/redteam/conversation-workspace";
export declare const conversationUrl: (id: string, action?: string) => string;
export declare const jsonBody: (value: unknown) => RequestInit;
export declare const dateTime: (value: string) => string;
/** Async results belong to the mounted scope; switching scopes never updates its successor. */
export declare function useOperation(): {
    busy: boolean;
    error: string;
    notice: string;
    run: (work: () => Promise<void>, success?: string) => Promise<void>;
    setError: React.Dispatch<React.SetStateAction<string>>;
    setNotice: React.Dispatch<React.SetStateAction<string>>;
};
export declare function ConfirmDelete({ label, description, disabled, onConfirm }: {
    label: string;
    description: string;
    disabled?: boolean;
    onConfirm(): Promise<void>;
}): React.JSX.Element;

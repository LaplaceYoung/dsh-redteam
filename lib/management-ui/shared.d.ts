import React from 'react';
export type Query = Record<string, string | number | boolean | null | undefined>;
/** Use the same base path as BetterSidebar, including reverse proxies and desktop URLs. */
export declare function apiUrl(path: string, query?: Query): URL;
export declare function requestJson<T>(path: string | URL, init?: RequestInit): Promise<T>;
export declare const errorMessage: (failure: unknown) => string;
export declare function ManagementPage({ title, description, actions, toolbar, loading, error, notice, children }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    toolbar?: React.ReactNode;
    loading?: boolean;
    error?: string;
    notice?: string;
    children?: React.ReactNode;
}): React.ReactNode;
export declare function Notice({ tone, children }: {
    tone?: 'info' | 'success' | 'error';
    children?: React.ReactNode;
}): React.ReactNode;
export declare function Field({ label, hint, children }: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}): React.ReactNode;
export declare function JsonDetails({ value, summary, open }: {
    value: unknown;
    summary?: string;
    open?: boolean;
}): React.ReactNode;

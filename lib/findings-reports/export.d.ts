import { type TrafficBinding } from './types.js';
export interface FindingView {
    id: string;
    taskId?: string;
    taskDescription?: string;
    name?: string;
    vulnClass: string;
    severity: string;
    summary: string;
    status: string;
    createdAt: string;
    evidence?: unknown;
    report?: string;
    evidenceVersion?: number;
    reportEvidenceVersion?: number;
    trafficBindings?: TrafficBinding[];
}
export interface TaskReportInput {
    title: string;
    goal: string;
    generatedAt: Date;
    assetCounts: Record<string, number>;
    findings: FindingView[];
}
export type FindingExportFormat = 'md-single' | 'md-zip' | 'csv' | 'json';
export interface FindingExport {
    filename: string;
    contentType: string;
    data: Buffer;
    sha256: string;
}
/** Pure rendering from persisted findings; does not claim to perform model generation. */
export declare function renderTaskReport(input: TaskReportInput): string;
export declare function renderFindingsMarkdown(findings: FindingView[], generatedAt?: Date): string;
export declare function renderSingleFindingMarkdown(finding: FindingView, generatedAt?: Date, attachments?: boolean): string;
export declare function findingFilename(finding: FindingView): string;
export declare function renderFindingsCSV(findings: FindingView[]): Buffer;
export declare function exportFindings(findings: FindingView[], format: FindingExportFormat, generatedAt?: Date): FindingExport;

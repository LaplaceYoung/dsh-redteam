export function clientFixture() {
  const at = '2026-10-18T08:00:00.000Z';
  return {
    version: 1, notificationSettings: {}, assetInterceptRules: [], taskCategories: [], taskTemplates: [], taskAssetRules: [],
    tasks: [{ id: 'task-a', title: '界面验收样例 A', goal: '核验资产、关联证据和 Worker 活动', status: 'running', createdAt: at, updatedAt: at }, { id: 'task-b', title: '界面验收样例 B', goal: '核验任务隔离', status: 'draft', createdAt: at, updatedAt: at }],
    assets: [{ id: 'asset-a', taskId: 'task-a', kind: 'domain', value: 'local.example.test', source: 'user', metadata: { owner: 'fixture' }, createdAt: at }],
    nodes: [{ id: 'asset-a', taskId: 'task-a', kind: 'asset', label: 'local.example.test', data: { kind: 'domain' } }, { id: 'finding-a', taskId: 'task-a', kind: 'finding', label: '响应头配置记录', data: { severity: 'info' } }, { id: 'evidence-a', taskId: 'task-a', kind: 'evidence', label: '本地响应样例', data: { provider: 'worker' } }, { id: 'intent-a', taskId: 'task-a', kind: 'intent', label: '核对响应头与证据', data: { state: 'running' } }, { id: 'asset-b', taskId: 'task-b', kind: 'asset', label: 'other.example.test', data: { kind: 'domain' } }],
    edges: [{ id: 'edge-a', taskId: 'task-a', from: 'finding-a', to: 'asset-a', relation: 'affects' }, { id: 'edge-b', taskId: 'task-a', from: 'finding-a', to: 'evidence-a', relation: 'supported_by' }],
    intents: [{ id: 'intent-a', taskId: 'task-a', summary: '核对响应头与证据', state: 'running', worker: 'worker-a', execution: { childSessionId: 'child-a', parentSessionId: 'parent-a', provider: 'spawn' }, input: {}, createdAt: at, updatedAt: at }],
    findings: [{ id: 'finding-a', taskId: 'task-a', vulnClass: 'configuration', severity: 'info', summary: '响应头配置记录', evidenceIds: ['evidence-a'], assetIds: ['asset-a'], status: 'verified', createdAt: at }],
    evidence: [{ id: 'evidence-a', taskId: 'task-a', provider: 'worker', summary: '本地响应样例', raw: { headers: { 'content-type': 'application/json' }, body: 'fixture-response-body' }, createdAt: at }],
    traces: [{ id: 'trace-a', taskId: 'task-a', intentId: 'intent-a', worker: 'worker-a', kind: 'tool', summary: '记录响应头', data: { outcome: 'fixture-tool-result' }, createdAt: at }],
    approvals: [{ id: 'approval-a', taskId: 'task-a', action: '样例审批事件', status: 'pending', requestedAt: at }],
    traffic: Array.from({ length: 45 }, (_, index) => ({ id: `traffic-${index}`, taskId: index === 44 ? 'task-b' : 'task-a', host: 'local.example.test', method: 'GET', url: `http://local.example.test/path/${index}`, status: 200, request: { headers: { accept: 'application/json' } }, response: { body: `fixture-body-${index}` }, createdAt: at })),
    reports: [{ id: 'report-a', taskId: 'task-a', markdown: '# 界面验收报告\n\n本文仅使用测试数据。\n\n' + '完整报告内容。'.repeat(90) + '\n\nREPORT_END_MARKER', version: 2, updatedAt: at }],
    goals: [], constraints: [], scopes: [], interceptRules: [], archives: [], notificationChannels: [], notificationEvents: [], notificationDeliveries: [], companies: []
  };
}


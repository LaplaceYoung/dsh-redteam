import React from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar';
import type { GraphNode, RedTeamSnapshot } from './types.js';
import { filterTask, graphRecord, graphRelations, kindLabels, layoutGraph, matchesQuery, nodeKinds } from './client-data.js';
import { redteamStyles } from './client-styles.js';
import { readFindingNavigation, subscribeFindingNavigation } from './client-deeplink.js';
import { apiUrl } from './management-ui/shared.js';

const e = React.createElement;
const emptySnapshot: RedTeamSnapshot = { notificationSettings: {}, assetInterceptRules: [], taskCategories: [], taskTemplates: [], taskAssetRules: [], version: 0, tasks: [], assets: [], nodes: [], edges: [], intents: [], findings: [], evidence: [], traces: [], approvals: [], goals: [], constraints: [], scopes: [], traffic: [], interceptRules: [], archives: [], reports: [], notificationChannels: [], notificationEvents: [], notificationDeliveries: [], companies: [] };
let liveSnapshot = emptySnapshot;
let connection = { loaded: false, error: '' };
let selectedTask = '';
const snapshotListeners = new Set<() => void>();
const selectionListeners = new Set<() => void>();
const connectionListeners = new Set<() => void>();
export function setLiveSnapshot(snapshot: RedTeamSnapshot): void { liveSnapshot = snapshot; snapshotListeners.forEach(listener => listener()); }
const subscribeSnapshot = (listener: () => void) => { snapshotListeners.add(listener); return () => { snapshotListeners.delete(listener); }; };
const subscribeConnection = (listener: () => void) => { connectionListeners.add(listener); return () => { connectionListeners.delete(listener); }; };
const subscribeSelection = (listener: () => void) => { selectionListeners.add(listener); return () => { selectionListeners.delete(listener); }; };
const readSnapshot = () => liveSnapshot;
const readConnection = () => connection;
const readSelection = () => selectedTask;
function changeConnection(next: typeof connection) { connection = next; connectionListeners.forEach(listener => listener()); }
function selectTask(value: string) { selectedTask = value; selectionListeners.forEach(listener => listener()); }

// A mounted visible tab owns one subscription. Multiple tabs share one in-flight request.
let pollUsers = 0;
let pollAbort: AbortController | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
function startPolling(): () => void {
  pollUsers++;
  if (pollUsers === 1) {
    const controller = new AbortController();
    pollAbort = controller;
    const refresh = async () => {
      try {
        const response = await fetch(apiUrl('/api/redteam/snapshot'), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json() as RedTeamSnapshot;
        if (!controller.signal.aborted) { setLiveSnapshot(snapshot); changeConnection({ loaded: true, error: '' }); }
      } catch (error) {
        if (!controller.signal.aborted) changeConnection({ loaded: connection.loaded, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (!controller.signal.aborted) pollTimer = setTimeout(() => { void refresh(); }, 1500);
      }
    };
    void refresh();
  }
  return () => { if (--pollUsers === 0) { pollAbort?.abort(); clearTimeout(pollTimer); } };
}

function useWorkspace(props: TabComponentProps) {
  const snapshot = React.useSyncExternalStore(subscribeSnapshot, readSnapshot, readSnapshot);
  const status = React.useSyncExternalStore(subscribeConnection, readConnection, readConnection);
  const taskId = React.useSyncExternalStore(subscribeSelection, readSelection, readSelection);
  React.useEffect(() => props.visible === false ? undefined : startPolling(), [props.visible]);
  const initial = (props.tab.meta as { snapshot?: RedTeamSnapshot } | undefined)?.snapshot;
  const value = connection.loaded ? snapshot : initial ?? snapshot;
  return { snapshot: value, status, taskId: value.tasks.some(task => task.id === taskId) ? taskId : '' };
}

function badgeTone(tone?: string): 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger' {
  if (tone === 'critical' || tone === 'high' || tone === 'error' || tone === 'failed' || tone === 'timeout') return 'danger';
  if (tone === 'medium' || tone === 'warning' || tone === 'paused') return 'warning';
  if (tone === 'done' || tone === 'success') return 'success';
  if (tone === 'running' || tone === 'info') return 'info';
  return 'neutral';
}
/** Existing snapshot rows keep their lightweight renderer so the findings/traffic
 * surface remains independent of optional host artwork modules. */
function Badge({ children, tone }: { children?: React.ReactNode; tone?: string }) { return e('span', { className: 'rt-badge', 'data-tone': tone }, children); }
/** Graph badges use the same semantic tokens as DSH's native Tag primitive.
 * Keep this renderer host-artwork-free so the core sidebar remains available
 * in lightweight BetterSidebar fixtures and offline snapshots. */
function GraphBadge({ children, tone }: { children?: React.ReactNode; tone?: string }) { return e('span', { className: 'rt-badge', 'data-tone': badgeTone(tone) }, children); }
function Json({ value }: { value: unknown }) { return e('pre', { className: 'rt-pre' }, JSON.stringify(value, null, 2)); }
function Empty({ children }: { children: React.ReactNode }) { return e('div', { className: 'rt-empty' }, children); }
function Panel({ title, count, workspace, query, onQuery, children, controls }: { title: string; count: number; workspace: ReturnType<typeof useWorkspace>; query: string; onQuery: (value: string) => void; children: React.ReactNode; controls?: React.ReactNode }) {
  const { snapshot, status, taskId } = workspace;
  return e('section', { className: 'rt-panel', 'aria-label': title },
    e('style', null, redteamStyles),
    e('header', { className: 'rt-head' }, e('strong', null, title), e('span', { className: 'rt-muted rt-small' }, `${count} 项`)),
    status.error && e('div', { className: 'rt-error', role: 'status' }, `同步失败：${status.error}。保留上次数据，正在重试。`),
    e('div', { className: 'rt-controls' },
      e('select', { className: 'rt-select', 'aria-label': '筛选任务', value: taskId, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => selectTask(event.target.value) },
        e('option', { value: '' }, '全部任务'), snapshot.tasks.map(task => e('option', { key: task.id, value: task.id }, task.title))),
      e('input', { className: 'rt-input', type: 'search', 'aria-label': `搜索${title}`, placeholder: `搜索${title}…`, value: query, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onQuery(event.target.value) }), controls),
    e('div', { className: 'rt-scroll' }, !status.loaded && snapshot === emptySnapshot && !status.error ? e('div', { className: 'rt-empty', role: 'status' }, '正在加载任务数据…') : children));
}

export function AssetGraphTab(props: TabComponentProps): React.ReactNode {
  const workspace = useWorkspace(props);
  const { snapshot, taskId } = workspace;
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [selectedId, setSelectedId] = React.useState('');
  const [view, setView] = React.useState<'graph' | 'list'>('graph');
  const taskNodes = filterTask(snapshot.nodes, taskId);
  const nodes = taskNodes.filter(node => (!kind || node.kind === kind) && matchesQuery([node.label, node.kind, node.data, node.id], query));
  const node = taskNodes.find(item => item.id === selectedId);
  const nodeIds = new Set(nodes.map(item => item.id));
  const edges = snapshot.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const task = snapshot.tasks.find(item => item.id === taskId);
  React.useEffect(() => {
    // A task/type/search change can hide the current node. Keep the detail panel
    // honest instead of showing a record that is no longer in the result set.
    if (selectedId && !nodes.some(item => item.id === selectedId)) setSelectedId('');
  }, [selectedId, taskId, query, kind, snapshot.version]);
  return e(Panel, { title: '资产与探索图', count: nodes.length, workspace, query, onQuery: setQuery,
    controls: e(React.Fragment, null,
      e('select', { className: 'rt-select', 'aria-label': '节点类型', value: kind, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setKind(event.target.value) }, e('option', { value: '' }, '所有节点'), nodeKinds.map(item => e('option', { key: item, value: item }, kindLabels[item]))),
      e('button', { className: 'rt-button', 'aria-pressed': view === 'list', onClick: () => setView(view === 'graph' ? 'list' : 'graph') }, view === 'graph' ? '列表视图' : '图视图'),
      (query || kind || selectedId) && e('button', { className: 'rt-button', onClick: () => { setQuery(''); setKind(''); setSelectedId(''); } }, '清除筛选')),
    children: e(React.Fragment, null,
      task && e('div', { className: 'rt-card rt-card-body rt-scope-card' }, e('div', { className: 'rt-card-head' }, e('strong', null, task.title), e(GraphBadge, { tone: task.status }, task.status)), e('p', { className: 'rt-muted' }, task.goal)),
      e('div', { className: 'rt-graph-summary', role: 'status', 'aria-live': 'polite' }, e('span', null, `${nodes.length} / ${taskNodes.length} 个节点`), e('span', { 'aria-hidden': 'true' }, '·'), e('span', null, `${edges.length} 条关系`), selectedId && e('span', { className: 'rt-muted' }, `· 已选择 ${node?.label ?? '节点'}`)),
      nodes.length === 0 ? e(Empty, null, query || kind ? '没有匹配的节点，请调整搜索或类型。' : '任务记录产生资产、意图、事实、发现或证据后会显示在这里。') : view === 'graph'
        ? e(GraphView, { nodes, edges, selectedId, onSelect: setSelectedId })
        : e('div', { className: 'rt-card', role: 'list', 'aria-label': '资产节点列表' }, nodes.map(item => e('button', { key: item.id, className: 'rt-row', 'aria-pressed': item.id === selectedId, onClick: () => setSelectedId(item.id) }, e(GraphBadge, null, kindLabels[item.kind]), ' ', item.label))),
      node ? e(NodeDetail, { node, snapshot, onSelect: (id: string) => { setSelectedId(id); setKind(''); setQuery(''); }, onSubagentJump: props.onSubagentJump }) : nodes.length > 0 && e('p', { className: 'rt-muted' }, '选择节点，查看完整记录和关联关系。')) });
}

function GraphView({ nodes, edges, selectedId, onSelect }: { nodes: GraphNode[]; edges: RedTeamSnapshot['edges']; selectedId: string; onSelect: (id: string) => void }) {
  const { positions, columns, width, height } = layoutGraph(nodes);
  const markerId = React.useId().replace(/:/g, '');
  const selectedIndex = nodes.findIndex(node => node.id === selectedId);
  const selectRelative = (delta: number) => {
    if (!nodes.length) return;
    const index = selectedIndex < 0 ? (delta > 0 ? 0 : nodes.length - 1) : (selectedIndex + delta + nodes.length) % nodes.length;
    onSelect(nodes[index].id);
  };
  return e('div', { className: 'rt-graph', tabIndex: 0, role: 'group', 'aria-label': '可滚动资产图', onKeyDown: (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); selectRelative(1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); selectRelative(-1); }
    else if (event.key === 'Home') { event.preventDefault(); if (nodes[0]) onSelect(nodes[0].id); }
    else if (event.key === 'End') { event.preventDefault(); if (nodes.at(-1)) onSelect(nodes.at(-1)!.id); }
  } }, e('div', { className: 'rt-graph-legend', 'aria-label': '图例' }, columns.map(kind => e('span', { key: kind }, e(GraphBadge, null, kindLabels[kind])))), e('svg', { width, height, role: 'group', 'aria-label': '资产与探索节点' },
    e('defs', null, e('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, e('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--dsw-alias-border-l3,#bbb)' }))),
    columns.map((kind, index) => e('text', { key: kind, x: 18 + index * 200, y: 24, fill: 'var(--dsw-alias-label-secondary,#737373)', fontSize: 11 }, `${kindLabels[kind]} · ${nodes.filter(node => node.kind === kind).length}`)),
    edges.map(edge => {
      const from = positions.get(edge.from)!; const to = positions.get(edge.to)!;
      const leftToRight = from.x < to.x;
      const x1 = from.x + (leftToRight ? 170 : 0); const x2 = to.x + (leftToRight ? 0 : 170);
      const sameColumn = from.x === to.x;
      const d = sameColumn ? `M ${from.x + 170} ${from.y + 23} C ${from.x + 194} ${from.y + 23}, ${to.x + 194} ${to.y + 23}, ${to.x + 170} ${to.y + 23}` : `M ${x1} ${from.y + 23} C ${(x1 + x2) / 2} ${from.y + 23}, ${(x1 + x2) / 2} ${to.y + 23}, ${x2} ${to.y + 23}`;
      const labelX = (x1 + x2) / 2; const labelY = (from.y + to.y) / 2 + (from.y === to.y ? -7 : 0);
      return e(React.Fragment, { key: edge.id }, e('path', { d, className: 'rt-edge', 'data-active': edge.from === selectedId || edge.to === selectedId, markerEnd: `url(#${markerId})` }, e('title', null, edge.relation)), e('text', { x: labelX, y: labelY, className: 'rt-edge-label', 'aria-hidden': 'true' }, edge.relation));
    }),
    nodes.map(node => {
      const position = positions.get(node.id)!;
      return e('g', { key: node.id, transform: `translate(${position.x},${position.y})`, className: 'rt-node', role: 'button', tabIndex: 0, 'aria-label': `${kindLabels[node.kind]}：${node.label}`, 'aria-pressed': node.id === selectedId,
        onClick: () => onSelect(node.id), onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } } },
        e('title', null, node.label), e('rect', { width: 170, height: 46, rx: 6 }),
        e('text', { x: 9, y: 19, fontSize: 11 }, node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label),
        e('text', { x: 9, y: 35, className: 'rt-node-kind' }, String(node.data.state ?? node.data.status ?? node.data.kind ?? kindLabels[node.kind])));
    })));
}

function NodeDetail({ node, snapshot, onSelect, onSubagentJump }: { node: GraphNode; snapshot: RedTeamSnapshot; onSelect: (id: string) => void; onSubagentJump?: (id: string) => void }) {
  const relations = graphRelations(snapshot, node);
  const intent = node.kind === 'intent' ? snapshot.intents.find(item => item.id === node.id) : undefined;
  return e('section', { className: 'rt-detail', 'aria-label': '节点详情' },
    e(GraphBadge, null, kindLabels[node.kind]), e('h3', null, node.label),
    e('dl', { className: 'rt-kv' }, e('dt', null, '节点 ID'), e('dd', null, node.id), e('dt', null, '任务'), e('dd', null, snapshot.tasks.find(task => task.id === node.taskId)?.title ?? node.taskId)),
    intent?.execution && onSubagentJump && e(Button, { size: 'sm', variant: 'outline', onClick: () => onSubagentJump(intent.execution!.childSessionId) }, '打开 Worker 会话'),
    e('div', { className: 'rt-label' }, `关联关系 · ${relations.length}`),
    relations.length === 0 ? e('div', { className: 'rt-muted' }, '暂无关联关系') : relations.map(({ edge, direction, node: target, targetId }) => e(Button, { key: edge.id, size: 'sm', variant: 'ghost', className: 'rt-row', disabled: !target, onClick: () => onSelect(targetId) }, `${direction === 'out' ? '→' : '←'} ${edge.relation} · ${target?.label ?? `${targetId}（节点未提供）`}`)),
    e('details', { open: true }, e('summary', { className: 'rt-label' }, '完整记录'), e(Json, { value: graphRecord(snapshot, node) })));
}

type Row = RedTeamSnapshot['findings'][number] | RedTeamSnapshot['traffic'][number] | RedTeamSnapshot['reports'][number] | RedTeamSnapshot['traces'][number] | RedTeamSnapshot['approvals'][number];
function rowTime(row: Row) { return 'updatedAt' in row ? row.updatedAt : 'createdAt' in row ? row.createdAt : row.requestedAt; }
function rowSummary(row: Row) { return 'summary' in row ? row.summary : 'url' in row ? `${row.method} ${row.url}` : 'markdown' in row ? `报告 · 版本 ${row.version}` : row.action; }
function rowTone(row: Row) { return 'severity' in row ? row.severity : 'kind' in row ? row.kind : 'status' in row ? String(row.status ?? '') : 'report'; }
const pageSize = 40;

export function SnapshotTab(props: TabComponentProps): React.ReactNode {
  const workspace = useWorkspace(props);
  const { snapshot, taskId } = workspace;
  const kind = props.tab.type.split(':').pop();
  const title = kind === 'findings' ? '发现' : kind === 'traffic' ? '流量' : kind === 'report' ? '报告' : '任务活动';
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [page, setPage] = React.useState(0);
  const navigation = React.useSyncExternalStore(subscribeFindingNavigation,readFindingNavigation,readFindingNavigation);
  const targetId = kind === 'findings' ? navigation.findingId : '';
  const target = snapshot.findings.find(finding=>finding.id===targetId);
  const [expandedId,setExpandedId] = React.useState('');
  const landing = React.useRef('');
  const targetElement = React.useRef<HTMLDetailsElement>(null);
  const all: Row[] = kind === 'findings' ? snapshot.findings : kind === 'traffic' ? snapshot.traffic : kind === 'report' ? snapshot.reports : [...snapshot.traces, ...snapshot.approvals];
  const taskRows = filterTask(all, taskId);
  const rows = taskRows.filter(row => (!category || rowTone(row) === category) && matchesQuery([rowSummary(row), row, snapshot.tasks.find(task => task.id === row.taskId)?.title], query)).sort((a, b) => rowTime(b).localeCompare(rowTime(a)) || a.id.localeCompare(b.id));
  const categories = [...new Set(taskRows.map(rowTone))].filter(Boolean).sort();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  React.useEffect(() => setPage(0), [taskId, query, category, kind]);
  React.useEffect(() => { setQuery(''); setCategory(''); }, [kind]);
  React.useEffect(()=>{
    if(!targetId||!target)return;
    if(landing.current===`${navigation.revision}:${targetId}`)return;
    selectTask(target.taskId);setQuery('');setCategory('');
  },[targetId,target?.taskId,navigation.revision]);
  React.useEffect(()=>{
    if(!target||!targetId||taskId!==target.taskId||query||category)return;
    const key=`${navigation.revision}:${targetId}`;if(landing.current===key)return;
    const index=rows.findIndex(row=>row.id===targetId);if(index<0)return;
    setPage(Math.floor(index/pageSize));setExpandedId(targetId);landing.current=key;
  },[targetId,target?.taskId,taskId,query,category,navigation.revision,rows]);
  React.useEffect(()=>{
    if(props.visible===false||!expandedId||!targetElement.current)return;
    targetElement.current.scrollIntoView({block:'nearest'});targetElement.current.focus({preventScroll:true});
  },[expandedId,currentPage,props.visible,navigation.revision]);
  return e(Panel, { title, count: rows.length, workspace, query, onQuery: setQuery,
    controls: categories.length > 1 || category ? e('select', { className: 'rt-select', 'aria-label': '筛选类别', value: category, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value) }, e('option', { value: '' }, '所有类别'), [...new Set([...categories, ...(category ? [category] : [])])].map(value => e('option', { key: value, value }, value))) : undefined,
    children: e(React.Fragment, null,
      targetId && !target && workspace.status.loaded && e('div',{className:'rt-error',role:'status'},`未找到通知中的发现 ${targetId}。记录可能已删除或归档，请检查任务数据。`),
      rows.length === 0 ? e(Empty, null, query || category ? '没有匹配的记录，请调整筛选条件。' : '当前任务暂无记录。') : rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => e('details', { key: row.id, className: 'rt-card', open:row.id===expandedId ? true : undefined, ref:row.id===expandedId ? targetElement : undefined, tabIndex:row.id===expandedId ? -1 : undefined, 'data-finding-id':kind==='findings'?row.id:undefined },
        e('summary', null, e(Badge, { tone: rowTone(row) }, rowTone(row)), ' ', rowSummary(row), e('div', { className: 'rt-muted rt-small', style: { marginTop: 4 } }, `${snapshot.tasks.find(task => task.id === row.taskId)?.title ?? row.taskId ?? '未关联任务'} · ${new Date(rowTime(row)).toLocaleString()}`)),
        e('div', { className: 'rt-card-body' }, e(RowDetail, { row, snapshot, onSubagentJump: props.onSubagentJump })))),
      rows.length > pageSize && e('div', { className: 'rt-pagination' }, e('button', { className: 'rt-button', disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, '上一页'), e('span', { className: 'rt-muted' }, `${currentPage + 1} / ${Math.ceil(rows.length / pageSize)} 页`), e('button', { className: 'rt-button', disabled: (currentPage + 1) * pageSize >= rows.length, onClick: () => setPage(currentPage + 1) }, '下一页')))
  });
}

function RowDetail({ row, snapshot, onSubagentJump }: { row: Row; snapshot: RedTeamSnapshot; onSubagentJump?: (id: string) => void }) {
  if ('vulnClass' in row) return e(React.Fragment, null,
    e('dl', { className: 'rt-kv' }, e('dt', null, '漏洞类别'), e('dd', null, row.vulnClass), e('dt', null, '状态'), e('dd', null, row.status)),
    e('div', { className: 'rt-label' }, '关联资产'), row.assetIds.length === 0 ? e('div', { className: 'rt-muted' }, '暂无关联资产') : row.assetIds.map(id => e('div', { key: id }, snapshot.assets.find(asset => asset.id === id)?.value ?? id)),
    e('div', { className: 'rt-label' }, '证据'), row.evidenceIds.length === 0 ? e('div', { className: 'rt-muted' }, '暂无关联证据') : row.evidenceIds.map(id => { const evidence = snapshot.evidence.find(item => item.id === id); return e('details', { key: id }, e('summary', null, evidence?.summary ?? id), e(Json, { value: evidence ?? { id, missing: true } })); }));
  if ('url' in row) return e(React.Fragment, null, e('div', null, row.url), e('div', { className: 'rt-label' }, '请求'), e(Json, { value: row.request ?? '未捕获请求内容' }), e('div', { className: 'rt-label' }, '响应'), e(Json, { value: row.response ?? '未捕获响应内容' }));
  if ('markdown' in row) return e(React.Fragment, null, e('button', { className: 'rt-button', onClick: () => downloadReport(row) }, '下载 Markdown'), e('div', { className: 'rt-divider' }), e('pre', { className: 'rt-report' }, row.markdown));
  if ('worker' in row) { const intent = snapshot.intents.find(item => item.id === row.intentId); return e(React.Fragment, null,
    e('div', null, `Worker：${row.worker}`), intent && e('div', null, `意图：${intent.summary}`),
    intent?.execution && onSubagentJump && e(Button, { size: 'sm', variant: 'outline', onClick: () => onSubagentJump(intent.execution!.childSessionId) }, '打开 Worker 会话'),
    row.data && e(Json, { value: row.data })); }
  return e(Json, { value: row });
}
function downloadReport(report: RedTeamSnapshot['reports'][number]) {
  const url = URL.createObjectURL(new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `redteam-report-${report.id.replace(/[^a-z0-9_-]/gi, '_')}-v${report.version}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}



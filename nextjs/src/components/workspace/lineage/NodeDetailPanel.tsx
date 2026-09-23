'use client';

import React from 'react';
import Link from 'next/link';
import { X, Code2, ArrowUpRight, Database, Columns, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { LineageNode, LineageEdge } from '@/core/lineage';

interface NodeDetailPanelProps {
    node: LineageNode | null;
    allEdges: LineageEdge[];
    allNodes: LineageNode[];
    onClose: () => void;
    onSelectNode: (nodeId: string) => void;
}

export function NodeDetailPanel({
    node,
    allEdges,
    allNodes,
    onClose,
    onSelectNode,
}: NodeDetailPanelProps) {
    if (!node) return null;

    const upstreamEdges = allEdges.filter((e) => e.to === node.id);
    const downstreamEdges = allEdges.filter((e) => e.from === node.id);

    const upstreamNodes = upstreamEdges
        .map((e) => allNodes.find((n) => n.id === e.from))
        .filter(Boolean) as LineageNode[];

    const downstreamNodes = downstreamEdges
        .map((e) => allNodes.find((n) => n.id === e.to))
        .filter(Boolean) as LineageNode[];

    const encodedPath = encodeURIComponent(node.path || node.name);

    return (
        <aside className="w-80 border-l border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex flex-col h-full overflow-y-auto text-xs shrink-0 p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {node.type}
                        </Badge>
                        {node.materialization && (
                            <Badge variant="secondary" className="text-[10px] font-mono">
                                {node.materialization}
                            </Badge>
                        )}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 break-all">{node.name}</h3>
                </div>
                <Button size="sm" variant="ghost" onClick={onClose} className="h-6 w-6 p-0 text-slate-400">
                    <X className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* Actions */}
            {node.type === 'model' && (
                <Link href={`/workspace/models/${encodedPath}`}>
                    <Button size="sm" className="w-full gap-1.5 text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white">
                        <Code2 className="h-3.5 w-3.5" />
                        <span>Open Model Editor</span>
                        <ArrowUpRight className="h-3.5 w-3.5 ml-auto" />
                    </Button>
                </Link>
            )}

            {/* Metadata info */}
            <div className="space-y-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                <div className="flex items-center justify-between text-slate-500">
                    <span>Schema</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{node.schema || 'public'}</span>
                </div>
                {node.path && (
                    <div className="flex items-center justify-between text-slate-500">
                        <span>Path</span>
                        <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
                            {node.path}
                        </span>
                    </div>
                )}
            </div>

            {/* Upstream Parents */}
            <div className="space-y-2">
                <p className="font-semibold text-[11px] uppercase tracking-wider text-slate-400">
                    Upstream Parents ({upstreamNodes.length})
                </p>
                {upstreamNodes.length === 0 ? (
                    <p className="text-slate-400 italic text-[11px]">No upstream dependencies</p>
                ) : (
                    <div className="space-y-1">
                        {upstreamNodes.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => onSelectNode(p.id)}
                                className="w-full text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between transition-colors"
                            >
                                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{p.name}</span>
                                <Badge variant="outline" className="text-[9px] capitalize">{p.type}</Badge>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Downstream Consumers */}
            <div className="space-y-2">
                <p className="font-semibold text-[11px] uppercase tracking-wider text-slate-400">
                    Downstream Consumers ({downstreamNodes.length})
                </p>
                {downstreamNodes.length === 0 ? (
                    <p className="text-slate-400 italic text-[11px]">No downstream models</p>
                ) : (
                    <div className="space-y-1">
                        {downstreamNodes.map((c) => (
                            <button
                                key={c.id}
                                onClick={() => onSelectNode(c.id)}
                                className="w-full text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between transition-colors"
                            >
                                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{c.name}</span>
                                <Badge variant="outline" className="text-[9px] capitalize">{c.type}</Badge>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Columns */}
            {node.columns && node.columns.length > 0 && (
                <div className="space-y-2">
                    <p className="font-semibold text-[11px] uppercase tracking-wider text-slate-400">
                        Columns ({node.columns.length})
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {node.columns.map((col) => (
                            <div
                                key={col.name}
                                className="flex items-center justify-between p-1.5 rounded-md bg-slate-50 dark:bg-slate-800/40 text-[11px]"
                            >
                                <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{col.name}</span>
                                {col.data_type && (
                                    <span className="font-mono text-[10px] text-slate-400">{col.data_type}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </aside>
    );
}

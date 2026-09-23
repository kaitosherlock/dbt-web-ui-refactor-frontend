'use client';

import React from 'react';
import { Layers, Clock, AlertCircle } from 'lucide-react';
import type { RunNode } from '@/core/runs';
import { NodeStatusBadge } from './NodeStatusBadge';
import { formatDuration } from '@/core/utils';

interface RunTimelineProps {
    nodes: RunNode[];
}

export function RunTimeline({ nodes }: RunTimelineProps) {
    if (nodes.length === 0) {
        return (
            <div className="p-8 text-center text-xs text-slate-400">
                No model execution breakdown available for this run.
            </div>
        );
    }

    return (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 font-semibold text-xs text-slate-700 dark:text-slate-300">
                Execution Steps ({nodes.length})
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {nodes.map((node, i) => (
                    <div key={node.id} className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <div className="flex items-center gap-3">
                            <span className="font-mono text-slate-400 text-[11px] w-6 text-right">
                                {i + 1}.
                            </span>
                            <div className="space-y-0.5">
                                <p className="font-semibold font-mono text-slate-900 dark:text-slate-100">
                                    {node.name}
                                </p>
                                {node.error_message && (
                                    <p className="text-red-500 text-[11px] flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3 shrink-0" />
                                        <span>{node.error_message}</span>
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {node.execution_time !== undefined && (
                                <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                                    <Clock className="h-3 w-3" />
                                    {formatDuration(node.execution_time)}
                                </span>
                            )}
                            <NodeStatusBadge status={node.status} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

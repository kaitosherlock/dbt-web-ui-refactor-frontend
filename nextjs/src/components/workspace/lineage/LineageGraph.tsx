'use client';

import React, { useState, useMemo, useRef } from 'react';
import { Database, Code2, Sparkles, Layers, ArrowUpRight } from 'lucide-react';
import { cn } from '@/core/utils';
import { Badge } from '@/components/ui/badge';
import type { LineageNode, LineageEdge, TraceDirection } from '@/core/lineage';
import { useLineageGraphFilter } from '@/core/lineage';
import { LineageControls } from './LineageControls';
import { NodeDetailPanel } from './NodeDetailPanel';

interface LineageGraphProps {
    nodes: LineageNode[];
    edges: LineageEdge[];
    isLoading?: boolean;
    onSelectModel?: (modelId: string) => void;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const COL_GAP = 140;
const ROW_GAP = 28;

export function LineageGraph({ nodes, edges, isLoading }: LineageGraphProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [direction, setDirection] = useState<TraceDirection>('all');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);

    const { visibleNodes, visibleEdges, upstreamIds, downstreamIds } = useLineageGraphFilter(
        nodes,
        edges,
        selectedNodeId,
        direction,
        searchQuery
    );

    // Topological Column Assignment (sources = 0, models = layer based on incoming dependencies)
    const layout = useMemo(() => {
        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();

        visibleNodes.forEach((n) => {
            inDegree.set(n.id, 0);
            adj.set(n.id, []);
        });

        visibleEdges.forEach((e) => {
            if (adj.has(e.from) && inDegree.has(e.to)) {
                adj.get(e.from)!.push(e.to);
                inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
            }
        });

        const columns = new Map<string, number>();
        const queue: string[] = [];

        visibleNodes.forEach((n) => {
            if (n.type === 'source' || (inDegree.get(n.id) || 0) === 0) {
                columns.set(n.id, 0);
                queue.push(n.id);
            }
        });

        while (queue.length > 0) {
            const curr = queue.shift()!;
            const col = columns.get(curr) || 0;
            const neighbors = adj.get(curr) || [];

            for (const nbr of neighbors) {
                const existing = columns.get(nbr) || 0;
                if (col + 1 > existing) {
                    columns.set(nbr, col + 1);
                    queue.push(nbr);
                }
            }
        }

        // Group nodes by column
        const colMap = new Map<number, LineageNode[]>();
        visibleNodes.forEach((n) => {
            const c = columns.get(n.id) || 0;
            if (!colMap.has(c)) colMap.set(c, []);
            colMap.get(c)!.push(n);
        });

        // Compute coordinate positions
        const positions = new Map<string, { x: number; y: number }>();
        colMap.forEach((colNodes, c) => {
            colNodes.forEach((node, r) => {
                positions.set(node.id, {
                    x: 60 + c * (NODE_WIDTH + COL_GAP),
                    y: 60 + r * (NODE_HEIGHT + ROW_GAP),
                });
            });
        });

        const maxCol = Math.max(...Array.from(colMap.keys()), 0);
        const maxRow = Math.max(...Array.from(colMap.values()).map((v) => v.length), 0);

        const canvasWidth = Math.max(1200, (maxCol + 1) * (NODE_WIDTH + COL_GAP) + 120);
        const canvasHeight = Math.max(800, maxRow * (NODE_HEIGHT + ROW_GAP) + 120);

        return { positions, canvasWidth, canvasHeight };
    }, [visibleNodes, visibleEdges]);

    const selectedNode = useMemo(() => {
        return nodes.find((n) => n.id === selectedNodeId) || null;
    }, [nodes, selectedNodeId]);

    const getNodeColor = (type: LineageNode['type']) => {
        switch (type) {
            case 'source':
                return 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400';
            case 'exposure':
                return 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400';
            default:
                return 'bg-[#0078D4]/10 border-[#0078D4]/30 text-[#0078D4] dark:text-blue-400';
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50/50 dark:bg-slate-950">
            {/* Top Toolbar */}
            <LineageControls
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                direction={direction}
                onDirectionChange={setDirection}
                onZoomIn={() => setZoom((z) => Math.min(1.8, z + 0.15))}
                onZoomOut={() => setZoom((z) => Math.max(0.4, z - 0.15))}
                onResetZoom={() => setZoom(1)}
            />

            {/* Canvas + Detail Panel */}
            <div className="flex-1 flex overflow-hidden relative">
                <div className="flex-1 overflow-auto p-6 relative">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full text-slate-400 text-xs animate-pulse">
                            Loading full project lineage DAG...
                        </div>
                    ) : (
                        <div
                            style={{
                                width: layout.canvasWidth,
                                height: layout.canvasHeight,
                                transform: `scale(${zoom})`,
                                transformOrigin: 'top left',
                            }}
                            className="relative transition-transform duration-100"
                        >
                            {/* SVG Connection Edges */}
                            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                                {visibleEdges.map((edge) => {
                                    const fromPos = layout.positions.get(edge.from);
                                    const toPos = layout.positions.get(edge.to);
                                    if (!fromPos || !toPos) return null;

                                    const startX = fromPos.x + NODE_WIDTH;
                                    const startY = fromPos.y + NODE_HEIGHT / 2;
                                    const endX = toPos.x;
                                    const endY = toPos.y + NODE_HEIGHT / 2;

                                    const isHighlighted =
                                        selectedNodeId === edge.from ||
                                        selectedNodeId === edge.to ||
                                        hoveredNodeId === edge.from ||
                                        hoveredNodeId === edge.to;

                                    const dx = (endX - startX) / 2;
                                    const d = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

                                    return (
                                        <path
                                            key={edge.id || `${edge.from}-${edge.to}`}
                                            d={d}
                                            fill="none"
                                            stroke={isHighlighted ? '#0078D4' : 'currentColor'}
                                            strokeWidth={isHighlighted ? 2.5 : 1.2}
                                            strokeOpacity={isHighlighted ? 1 : 0.25}
                                            className="text-slate-400 dark:text-slate-600 transition-all duration-200"
                                        />
                                    );
                                })}
                            </svg>

                            {/* Nodes */}
                            {visibleNodes.map((node) => {
                                const pos = layout.positions.get(node.id);
                                if (!pos) return null;

                                const isSelected = selectedNodeId === node.id;
                                const isUpstream = upstreamIds?.has(node.id);
                                const isDownstream = downstreamIds?.has(node.id);

                                return (
                                    <div
                                        key={node.id}
                                        style={{
                                            position: 'absolute',
                                            left: pos.x,
                                            top: pos.y,
                                            width: NODE_WIDTH,
                                            height: NODE_HEIGHT,
                                        }}
                                        onClick={() => setSelectedNodeId(node.id)}
                                        onMouseEnter={() => setHoveredNodeId(node.id)}
                                        onMouseLeave={() => setHoveredNodeId(null)}
                                        className={cn(
                                            'rounded-xl border p-3 cursor-pointer select-none transition-all duration-150 z-10 flex flex-col justify-between shadow-xs',
                                            isSelected
                                                ? 'ring-2 ring-[#0078D4] border-[#0078D4] bg-white dark:bg-slate-900 shadow-md'
                                                : isUpstream || isDownstream
                                                ? 'border-[#0078D4]/60 bg-blue-50/50 dark:bg-blue-950/20'
                                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs'
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div
                                                    className={cn(
                                                        'h-6 w-6 rounded-md flex items-center justify-center shrink-0 border',
                                                        getNodeColor(node.type)
                                                    )}
                                                >
                                                    {node.type === 'source' ? (
                                                        <Database className="h-3.5 w-3.5" />
                                                    ) : (
                                                        <Code2 className="h-3.5 w-3.5" />
                                                    )}
                                                </div>
                                                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                                                    {node.name}
                                                </span>
                                            </div>

                                            <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">
                                                {node.type}
                                            </Badge>
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                                            <span>{node.schema || 'analytics'}</span>
                                            <span>{node.columns?.length || 0} cols</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Right Drawer: Node Details */}
                {selectedNode && (
                    <NodeDetailPanel
                        node={selectedNode}
                        allNodes={nodes}
                        allEdges={edges}
                        onClose={() => setSelectedNodeId(null)}
                        onSelectNode={(id) => setSelectedNodeId(id)}
                    />
                )}
            </div>
        </div>
    );
}

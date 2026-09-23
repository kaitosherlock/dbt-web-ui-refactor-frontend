'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { lineageApi } from './api';
import type { LineageGraphData, LineageNode, LineageEdge, TraceDirection } from './types';

export function useLineage(projectId?: string, modelPath?: string) {
    const [data, setData] = useState<LineageGraphData>({ nodes: [], edges: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const result = modelPath
                ? await lineageApi.getModelLineage(projectId, modelPath)
                : await lineageApi.getFullLineage(projectId);
            setData(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch lineage');
        } finally {
            setIsLoading(false);
        }
    }, [projectId, modelPath]);

    useEffect(() => {
        load();
    }, [load]);

    return {
        nodes: data.nodes,
        edges: data.edges,
        columnLineage: data.columnLineage,
        isLoading,
        error,
        refresh: load,
    };
}

/**
 * Filter graph nodes and edges according to upstream/downstream tracing and search text
 */
export function useLineageGraphFilter(
    nodes: LineageNode[],
    edges: LineageEdge[],
    selectedNodeId: string | null,
    direction: TraceDirection = 'all',
    searchQuery = ''
) {
    return useMemo(() => {
        if (!selectedNodeId) {
            const filteredNodes = nodes.filter((n) =>
                searchQuery ? n.name.toLowerCase().includes(searchQuery.toLowerCase()) : true
            );
            const nodeIds = new Set(filteredNodes.map((n) => n.id));
            const filteredEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
            return { visibleNodes: filteredNodes, visibleEdges: filteredEdges };
        }

        const upstreamIds = new Set<string>();
        const downstreamIds = new Set<string>();

        // Breadth-first search for upstream
        const qUp = [selectedNodeId];
        while (qUp.length > 0) {
            const curr = qUp.shift()!;
            for (const edge of edges) {
                if (edge.to === curr && !upstreamIds.has(edge.from)) {
                    upstreamIds.add(edge.from);
                    qUp.push(edge.from);
                }
            }
        }

        // Breadth-first search for downstream
        const qDown = [selectedNodeId];
        while (qDown.length > 0) {
            const curr = qDown.shift()!;
            for (const edge of edges) {
                if (edge.from === curr && !downstreamIds.has(edge.to)) {
                    downstreamIds.add(edge.to);
                    qDown.push(edge.to);
                }
            }
        }

        const visibleNodeIds = new Set<string>([selectedNodeId]);
        if (direction === 'all' || direction === 'upstream') {
            upstreamIds.forEach((id) => visibleNodeIds.add(id));
        }
        if (direction === 'all' || direction === 'downstream') {
            downstreamIds.forEach((id) => visibleNodeIds.add(id));
        }

        const visibleNodes = nodes
            .filter((n) => visibleNodeIds.has(n.id))
            .filter((n) => (searchQuery ? n.name.toLowerCase().includes(searchQuery.toLowerCase()) : true));

        const activeIdSet = new Set(visibleNodes.map((n) => n.id));
        const visibleEdges = edges.filter((e) => activeIdSet.has(e.from) && activeIdSet.has(e.to));

        return { visibleNodes, visibleEdges, upstreamIds, downstreamIds };
    }, [nodes, edges, selectedNodeId, direction, searchQuery]);
}

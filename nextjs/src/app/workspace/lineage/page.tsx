'use client';

import React from 'react';
import { WorkspaceHeader } from '@/components/workspace/layout';
import { LineageGraph } from '@/components/workspace/lineage';
import { useLineage } from '@/core/lineage';

export default function FullLineagePage() {
    const { nodes, edges, isLoading, refresh } = useLineage('default');

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <WorkspaceHeader
                title="Full Project Lineage DAG"
                description="Visual dependency graph linking raw sources, transformation models, and downstream exposures."
            />

            <div className="flex-1 overflow-hidden">
                <LineageGraph
                    nodes={
                        nodes.length > 0
                            ? nodes
                            : [
                                  { id: 'source.raw_customers', name: 'raw_customers', type: 'source', schema: 'raw' },
                                  { id: 'source.raw_orders', name: 'raw_orders', type: 'source', schema: 'raw' },
                                  { id: 'model.stg_customers', name: 'stg_customers', type: 'model', schema: 'staging' },
                                  { id: 'model.stg_orders', name: 'stg_orders', type: 'model', schema: 'staging' },
                                  { id: 'model.customers', name: 'customers', type: 'model', schema: 'analytics' },
                                  { id: 'model.orders', name: 'orders', type: 'model', schema: 'analytics' },
                                  { id: 'exp.exec_dashboard', name: 'Executive Dashboard', type: 'exposure' },
                              ]
                    }
                    edges={
                        edges.length > 0
                            ? edges
                            : [
                                  { from: 'source.raw_customers', to: 'model.stg_customers' },
                                  { from: 'source.raw_orders', to: 'model.stg_orders' },
                                  { from: 'model.stg_customers', to: 'model.customers' },
                                  { from: 'model.stg_orders', to: 'model.orders' },
                                  { from: 'model.customers', to: 'exp.exec_dashboard' },
                                  { from: 'model.orders', to: 'exp.exec_dashboard' },
                              ]
                    }
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { Table2, Code2, Network, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { CatalogTable } from '@/core/catalog';
import { ColumnStatsTable } from './ColumnStatsTable';

interface TableDetailsProps {
    table: CatalogTable | null;
}

export function TableDetails({ table }: TableDetailsProps) {
    if (!table) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 text-xs">
                <Table2 className="h-10 w-10 mb-3 opacity-30" />
                <p className="font-semibold text-slate-600 dark:text-slate-300">Select a table or view</p>
                <p className="text-[11px] text-slate-400 mt-1">Browse schema definitions and column types.</p>
            </div>
        );
    }

    const encodedModelId = encodeURIComponent(`models/${table.name}.sql`);

    return (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Table Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs uppercase font-mono">
                            {table.type}
                        </Badge>
                        <span className="font-mono text-xs text-slate-500">{table.schema}</span>
                    </div>
                    <h2 className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">{table.name}</h2>
                    <p className="text-xs text-slate-500 max-w-2xl">
                        {table.description || `Database table materialized in ${table.schema}.${table.name}`}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Link href={`/workspace/lineage`}>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                            <Network className="h-3.5 w-3.5" />
                            <span>View Lineage</span>
                        </Button>
                    </Link>

                    {table.type !== 'source' && (
                        <Link href={`/workspace/models/${encodedModelId}`}>
                            <Button size="sm" className="h-8 text-xs gap-1.5 bg-[#0078D4] hover:bg-[#106EBE] text-white">
                                <Code2 className="h-3.5 w-3.5" />
                                <span>Edit Model</span>
                                <ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Column metadata table */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Columns ({table.columns.length})
                    </h3>
                </div>

                <ColumnStatsTable columns={table.columns} />
            </div>
        </div>
    );
}

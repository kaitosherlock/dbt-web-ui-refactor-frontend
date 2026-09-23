'use client';

import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { CatalogColumn } from '@/core/catalog';

interface ColumnStatsTableProps {
    columns: CatalogColumn[];
}

export function ColumnStatsTable({ columns }: ColumnStatsTableProps) {
    if (columns.length === 0) {
        return (
            <div className="p-8 text-center text-xs text-slate-400">
                No column metadata discovered yet for this table.
            </div>
        );
    }

    return (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            <Table>
                <TableHeader>
                    <TableRow className="bg-slate-50/75 dark:bg-slate-800/50">
                        <TableHead className="w-[200px] text-xs font-semibold">Column Name</TableHead>
                        <TableHead className="w-[140px] text-xs font-semibold">Data Type</TableHead>
                        <TableHead className="w-[100px] text-xs font-semibold">Nullable</TableHead>
                        <TableHead className="text-xs font-semibold">Description</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {columns.map((col) => (
                        <TableRow key={col.name} className="text-xs font-mono">
                            <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                                {col.name}
                            </TableCell>
                            <TableCell>
                                <Badge variant="secondary" className="text-[10px] font-mono">
                                    {col.data_type || 'VARCHAR'}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-slate-500 font-sans">
                                {col.nullable ? 'Yes' : 'No'}
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400 font-sans text-xs">
                                {col.description || '—'}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

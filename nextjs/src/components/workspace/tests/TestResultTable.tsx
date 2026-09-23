'use client';

import React, { useState } from 'react';
import { Search, CheckCircle2, XCircle, AlertTriangle, Play, Loader2 } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DataTest, TestSummary } from '@/core/tests';
import { TestStatusBadge } from './TestStatusBadge';

interface TestResultTableProps {
    tests: DataTest[];
    summary: TestSummary;
    onRunTests?: () => Promise<boolean>;
    isTesting?: boolean;
}

export function TestResultTable({ tests, summary, onRunTests, isTesting }: TestResultTableProps) {
    const [search, setSearch] = useState('');

    const filtered = tests.filter(
        (t) =>
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            t.model_name.toLowerCase().includes(search.toLowerCase()) ||
            (t.column_name && t.column_name.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="space-y-4">
            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Total Tests</span>
                    <p className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                        {summary.total}
                    </p>
                </div>

                <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/10 shadow-xs">
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Passed
                    </span>
                    <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                        {summary.passed}
                    </p>
                </div>

                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 dark:bg-red-950/10 shadow-xs">
                    <span className="text-[11px] text-red-600 dark:text-red-400 font-medium uppercase tracking-wider flex items-center gap-1">
                        <XCircle className="h-3 w-3" />
                        Failed
                    </span>
                    <p className="text-2xl font-bold font-mono text-red-600 dark:text-red-400 mt-1">
                        {summary.failed}
                    </p>
                </div>

                <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/10 shadow-xs">
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Warnings
                    </span>
                    <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
                        {summary.warned}
                    </p>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3">
                <div className="relative w-72">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                        placeholder="Filter by test or model name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 pl-8 text-xs bg-white dark:bg-slate-900"
                    />
                </div>

                {onRunTests && (
                    <Button
                        size="sm"
                        onClick={onRunTests}
                        disabled={isTesting}
                        className="h-8 gap-1.5 text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white"
                    >
                        {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                        <span>Execute Tests</span>
                    </Button>
                )}
            </div>

            {/* Test Results Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50/75 dark:bg-slate-800/50">
                            <TableHead className="w-[120px] text-xs font-semibold">Status</TableHead>
                            <TableHead className="text-xs font-semibold">Test Name</TableHead>
                            <TableHead className="w-[160px] text-xs font-semibold">Model</TableHead>
                            <TableHead className="w-[140px] text-xs font-semibold">Column</TableHead>
                            <TableHead className="w-[120px] text-xs font-semibold">Type</TableHead>
                            <TableHead className="w-[100px] text-xs font-semibold text-right">Duration</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center p-8 text-slate-400 text-xs">
                                    No tests match the current filter.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((t) => (
                                <TableRow key={t.id} className="text-xs font-mono">
                                    <TableCell>
                                        <TestStatusBadge status={t.status} />
                                    </TableCell>
                                    <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                                        {t.name}
                                    </TableCell>
                                    <TableCell className="text-[#0078D4] font-medium">
                                        {t.model_name}
                                    </TableCell>
                                    <TableCell className="text-slate-500">
                                        {t.column_name || '—'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                            {t.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right text-slate-400">
                                        {t.execution_time ? `${t.execution_time.toFixed(2)}s` : '—'}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

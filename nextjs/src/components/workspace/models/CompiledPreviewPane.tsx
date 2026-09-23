'use client';

import React, { useState } from 'react';
import { Copy, Check, Clock, AlertCircle, FileCode2, Table2, Layers } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { CompileResult, PreviewResult, ExplainResult } from '@/core/models';

interface CompiledPreviewPaneProps {
    compileResult?: CompileResult | null;
    previewResult?: PreviewResult | null;
    explainResult?: ExplainResult | null;
}

export function CompiledPreviewPane({
    compileResult,
    previewResult,
    explainResult,
}: CompiledPreviewPaneProps) {
    const [activeTab, setActiveTab] = useState('preview');
    const [copied, setCopied] = useState(false);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col h-full border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full space-y-0">
                {/* Header with Tabs */}
                <div className="h-11 px-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
                    <TabsList className="bg-transparent border-none p-0 h-auto gap-1">
                        <TabsTrigger value="preview" className="h-7 text-xs gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                            <Table2 className="h-3.5 w-3.5" />
                            <span>Preview</span>
                            {previewResult && (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
                                    {previewResult.row_count} rows
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="compiled" className="h-7 text-xs gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                            <FileCode2 className="h-3.5 w-3.5" />
                            <span>Compiled SQL</span>
                        </TabsTrigger>
                        <TabsTrigger value="explain" className="h-7 text-xs gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                            <Layers className="h-3.5 w-3.5" />
                            <span>Query Plan</span>
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex items-center gap-2">
                        {previewResult?.execution_time !== undefined && (
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {previewResult.execution_time.toFixed(2)}s
                            </span>
                        )}
                        {activeTab === 'compiled' && compileResult?.compiled_sql && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCopy(compileResult.compiled_sql)}
                                className="h-7 px-2 text-xs"
                            >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
                            </Button>
                        )}
                    </div>
                </div>

                {/* Tab: Preview Results */}
                <TabsContent value="preview" className="flex-1 mt-0 p-0 overflow-auto">
                    {previewResult?.error ? (
                        <div className="p-4 m-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <pre className="whitespace-pre-wrap font-mono">{previewResult.error}</pre>
                        </div>
                    ) : previewResult && previewResult.data.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs font-mono">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                                        {previewResult.columns.map((col) => (
                                            <th key={col} className="p-2.5 font-medium whitespace-nowrap">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewResult.data.map((row, i) => (
                                        <tr
                                            key={i}
                                            className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                        >
                                            {previewResult.columns.map((col) => (
                                                <td key={col} className="p-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                                                    {String(row[col] ?? 'NULL')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs text-center p-6">
                            <Table2 className="h-8 w-8 mb-2 opacity-30" />
                            <p className="font-medium text-slate-600 dark:text-slate-400">No preview results yet</p>
                            <p className="text-[11px] text-slate-400 mt-1">
                                Click "Preview (dbt show)" to execute this model against DuckDB and inspect the data.
                            </p>
                        </div>
                    )}
                </TabsContent>

                {/* Tab: Compiled SQL */}
                <TabsContent value="compiled" className="flex-1 mt-0 p-0 overflow-auto bg-slate-950 text-slate-200">
                    {compileResult?.compiled_sql ? (
                        <pre className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                            {compileResult.compiled_sql}
                        </pre>
                    ) : compileResult?.error ? (
                        <div className="p-4 m-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            <pre className="whitespace-pre-wrap font-mono">{compileResult.error}</pre>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs text-center p-6">
                            <FileCode2 className="h-8 w-8 mb-2 opacity-30" />
                            <p className="font-medium text-slate-400">No compiled SQL</p>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Click "Compile" to render Jinja expressions (ref, source, macros) into standard SQL.
                            </p>
                        </div>
                    )}
                </TabsContent>

                {/* Tab: Explain Plan */}
                <TabsContent value="explain" className="flex-1 mt-0 p-0 overflow-auto bg-slate-950 text-slate-200">
                    {explainResult?.plan ? (
                        <pre className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed text-emerald-400">
                            {explainResult.plan}
                        </pre>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs text-center p-6">
                            <Layers className="h-8 w-8 mb-2 opacity-30" />
                            <p className="font-medium text-slate-400">No execution plan available</p>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Run EXPLAIN to inspect query cost and join execution tree.
                            </p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Database, Play, RefreshCw, Clock, CheckCircle2 } from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace/layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useSource, sourcesApi } from '@/core/sources';
import { formatDate } from '@/core/utils';

export default function SourceDetailPage() {
    const params = useParams();
    const sourceId = params.source_id as string;
    const { source, isLoading, refresh } = useSource(sourceId);

    const handleSync = async () => {
        if (!source) return;
        await sourcesApi.triggerIngest(source.id);
        refresh();
    };

    const activeSource = source || {
        id: sourceId,
        name: sourceId,
        source_name: sourceId,
        schema_name: 'raw_data',
        source_kind: 'sql_database' as const,
        cursor_field: 'updated_at',
        tables: [{ name: 'table_1' }, { name: 'table_2' }],
        last_loaded_at: new Date().toISOString(),
        freshness_status: 'pass' as const,
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <WorkspaceHeader
                title={`Source: ${activeSource.name}`}
                description={`schema: ${activeSource.schema_name}`}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/workspace/sources">
                            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs">
                                <ArrowLeft className="h-3.5 w-3.5" />
                                <span>Sources</span>
                            </Button>
                        </Link>
                        <Button
                            size="sm"
                            onClick={handleSync}
                            className="h-8 gap-1.5 text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white"
                        >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Trigger Ingestion</span>
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Configuration summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardHeader className="p-4 pb-2">
                            <CardTitle className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                                Ingestion Type
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-1 font-mono text-sm font-semibold capitalize">
                            {activeSource.source_kind.replace('_', ' ')}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="p-4 pb-2">
                            <CardTitle className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                                Incremental Cursor Field
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-1 font-mono text-sm font-semibold">
                            {activeSource.cursor_field || 'None (Full Replace)'}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="p-4 pb-2">
                            <CardTitle className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                                Last Sync Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-1 flex items-center gap-2">
                            <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Fresh
                            </Badge>
                            <span className="text-xs text-slate-400 font-mono">
                                {formatDate(activeSource.last_loaded_at)}
                            </span>
                        </CardContent>
                    </Card>
                </div>

                {/* Ingested Tables */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Ingested Tables ({activeSource.tables.length})
                    </h3>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                        {activeSource.tables.map((t) => (
                            <div key={t.name} className="p-3.5 flex items-center justify-between text-xs font-mono">
                                <div className="flex items-center gap-2.5">
                                    <Database className="h-4 w-4 text-amber-500" />
                                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                                        {activeSource.schema_name}.{t.name}
                                    </span>
                                </div>
                                <span className="text-slate-400 font-sans text-[11px]">Ready for dbt source()</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

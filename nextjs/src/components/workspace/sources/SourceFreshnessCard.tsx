'use client';

import React from 'react';
import Link from 'next/link';
import { Database, Clock, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/core/utils';
import type { DataSource } from '@/core/sources';

interface SourceFreshnessCardProps {
    source: DataSource;
    onCheckFreshness?: (sourceId: string) => void;
    onTriggerIngest?: (sourceId: string) => void;
}

export function SourceFreshnessCard({
    source,
    onCheckFreshness,
    onTriggerIngest,
}: SourceFreshnessCardProps) {
    const getFreshnessBadge = () => {
        switch (source.freshness_status) {
            case 'pass':
                return (
                    <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Fresh
                    </Badge>
                );
            case 'warn':
                return (
                    <Badge variant="warning" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Stale (Warn)
                    </Badge>
                );
            case 'error':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" /> Stale (Error)
                    </Badge>
                );
            default:
                return <Badge variant="outline">Not checked</Badge>;
        }
    };

    return (
        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-150">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <Database className="h-4 w-4" />
                        </div>
                        <div>
                            <Link href={`/workspace/sources/${source.id}`}>
                                <CardTitle className="text-sm font-semibold hover:text-[#0078D4] cursor-pointer flex items-center gap-1">
                                    {source.source_name || source.name}
                                    <ArrowUpRight className="h-3 w-3 opacity-0 hover:opacity-100" />
                                </CardTitle>
                            </Link>
                            <p className="text-[11px] text-slate-400 font-mono">
                                schema: {source.schema_name} • kind: {source.source_kind}
                            </p>
                        </div>
                    </div>

                    {getFreshnessBadge()}
                </div>
            </CardHeader>

            <CardContent className="p-4 pt-2 text-xs space-y-3">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last loaded:
                    </span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                        {formatDate(source.last_loaded_at || source.created_at)}
                    </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500 font-mono">
                        {source.tables.length} tables ingested
                    </span>

                    <div className="flex items-center gap-1.5">
                        {onCheckFreshness && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onCheckFreshness(source.id)}
                                className="h-7 text-xs px-2 gap-1"
                            >
                                <RefreshCw className="h-3 w-3" />
                                Freshness
                            </Button>
                        )}
                        {onTriggerIngest && (
                            <Button
                                size="sm"
                                onClick={() => onTriggerIngest(source.id)}
                                className="h-7 text-xs px-2.5 bg-[#0078D4] hover:bg-[#106EBE] text-white"
                            >
                                Sync Now
                            </Button>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

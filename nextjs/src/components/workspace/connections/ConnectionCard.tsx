'use client';

import React from 'react';
import { Link2, CheckCircle2, XCircle, Loader2, RefreshCw, Server } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WarehouseConnection } from '@/core/connections';
import { useConnectionTest } from '@/core/connections';

interface ConnectionCardProps {
    connection: WarehouseConnection;
    onEdit?: (connection: WarehouseConnection) => void;
}

export function ConnectionCard({ connection, onEdit }: ConnectionCardProps) {
    const { test, testingId, result } = useConnectionTest();
    const isTesting = testingId === connection.id;

    return (
        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-150">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center shrink-0">
                            <Server className="h-4 w-4" />
                        </div>
                        <div>
                            <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {connection.name}
                            </CardTitle>
                            <Badge variant="outline" className="text-[10px] font-mono capitalize mt-0.5">
                                {connection.type}
                            </Badge>
                        </div>
                    </div>

                    {result ? (
                        result.success ? (
                            <Badge variant="success" className="gap-1 text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> Connected
                            </Badge>
                        ) : (
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                                <XCircle className="h-3 w-3" /> Failed
                            </Badge>
                        )
                    ) : connection.is_tested ? (
                        <Badge variant="success" className="gap-1 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" /> Ready
                        </Badge>
                    ) : (
                        <Badge variant="secondary" className="text-[10px]">
                            Untested
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent className="p-4 pt-2 text-xs space-y-3">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-sans">Database:</span>
                        <span className="text-slate-800 dark:text-slate-200">{connection.database || 'default'}</span>
                    </div>
                    {connection.host && (
                        <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-sans">Host:</span>
                            <span className="truncate max-w-[160px] text-slate-800 dark:text-slate-200">{connection.host}</span>
                        </div>
                    )}
                </div>

                {result && !result.success && (
                    <p className="text-red-500 text-[11px] leading-tight break-all font-mono">
                        {result.message}
                    </p>
                )}

                <div className="flex items-center justify-between pt-1">
                    {onEdit && (
                        <Button size="sm" variant="ghost" onClick={() => onEdit(connection)} className="h-7 text-xs px-2">
                            Configure
                        </Button>
                    )}

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => test(connection.id)}
                        disabled={isTesting}
                        className="h-7 text-xs px-2.5 gap-1.5 ml-auto"
                    >
                        {isTesting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <RefreshCw className="h-3 w-3" />
                        )}
                        <span>Test Connection</span>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

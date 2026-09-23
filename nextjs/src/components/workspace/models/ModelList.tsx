'use client';

import React from 'react';
import Link from 'next/link';
import { Code2, ArrowUpRight, Columns, Layers } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DbtModel } from '@/core/models';

interface ModelCardProps {
    model: DbtModel;
}

export function ModelCard({ model }: ModelCardProps) {
    const encodedId = encodeURIComponent(model.path || model.name);

    return (
        <Card className="hover:border-[#0078D4]/40 hover:shadow-md transition-all duration-200 group">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-md bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center shrink-0">
                            <Code2 className="h-4 w-4" />
                        </div>
                        <Link href={`/workspace/models/${encodedId}`}>
                            <CardTitle className="text-sm font-semibold group-hover:text-[#0078D4] transition-colors cursor-pointer flex items-center gap-1">
                                {model.name}
                                <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardTitle>
                        </Link>
                    </div>

                    <Badge variant="outline" className="text-[10px] font-mono capitalize">
                        {model.materialization || 'table'}
                    </Badge>
                </div>

                <CardDescription className="text-xs line-clamp-2 mt-1">
                    {model.description || `dbt model defined at ${model.path}`}
                </CardDescription>
            </CardHeader>

            <CardContent className="p-4 pt-2 text-xs flex items-center justify-between text-slate-500 border-t border-slate-100 dark:border-slate-800/60 mt-3">
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                        <Columns className="h-3 w-3" />
                        {model.columns?.length || 0} cols
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                        <Layers className="h-3 w-3" />
                        {model.schema || 'analytics'}
                    </span>
                </div>

                <Link
                    href={`/workspace/models/${encodedId}`}
                    className="text-[11px] font-semibold text-[#0078D4] hover:underline"
                >
                    Edit SQL →
                </Link>
            </CardContent>
        </Card>
    );
}

interface ModelListProps {
    models: DbtModel[];
    isLoading?: boolean;
}

export function ModelList({ models, isLoading }: ModelListProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                        key={i}
                        className="h-36 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 animate-pulse"
                    />
                ))}
            </div>
        );
    }

    if (models.length === 0) {
        return (
            <div className="p-12 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                <Code2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-semibold text-slate-700 dark:text-slate-300">No models found</p>
                <p className="text-xs mt-1">Create your first dbt SQL model under the models/ directory.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {models.map((model) => (
                <ModelCard key={model.id || model.name} model={model} />
            ))}
        </div>
    );
}

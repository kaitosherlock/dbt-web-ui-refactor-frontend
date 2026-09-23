'use client';

import React from 'react';
import Link from 'next/link';
import { Database, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DataSource } from '@/core/sources';
import { SourceFreshnessCard } from './SourceFreshnessCard';

interface SourceListTableProps {
    sources: DataSource[];
    isLoading?: boolean;
    onTriggerIngest?: (sourceId: string) => void;
    onCheckFreshness?: (sourceId: string) => void;
}

export function SourceListTable({
    sources,
    isLoading,
    onTriggerIngest,
    onCheckFreshness,
}: SourceListTableProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="h-44 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 animate-pulse"
                    />
                ))}
            </div>
        );
    }

    if (sources.length === 0) {
        return (
            <div className="p-12 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-semibold text-slate-700 dark:text-slate-300">No data sources configured</p>
                <p className="text-xs mt-1">Configure an ingest source (Postgres, REST API, or Filesystem) to load raw data.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map((source) => (
                <SourceFreshnessCard
                    key={source.id}
                    source={source}
                    onTriggerIngest={onTriggerIngest}
                    onCheckFreshness={onCheckFreshness}
                />
            ))}
        </div>
    );
}

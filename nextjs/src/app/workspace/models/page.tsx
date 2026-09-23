'use client';

import React, { useState } from 'react';
import { Plus, Search, Code2 } from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace/layout';
import { ModelList } from '@/components/workspace/models';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useModelList } from '@/core/models';

export default function ModelsOverviewPage() {
    const { models, isLoading, refresh } = useModelList('default');
    const [search, setSearch] = useState('');
    const [filterMat, setFilterMat] = useState<string>('all');

    const filteredModels = models.filter((m) => {
        const matchesSearch =
            m.name.toLowerCase().includes(search.toLowerCase()) ||
            m.description?.toLowerCase().includes(search.toLowerCase());
        const matchesMat = filterMat === 'all' || m.materialization === filterMat;
        return matchesSearch && matchesMat;
    });

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <WorkspaceHeader
                title="dbt Models"
                description="SQL transformation models, compile previews, and materialization specifications."
                actions={
                    <Button size="sm" className="h-8 gap-1.5 text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white">
                        <Plus className="h-3.5 w-3.5" />
                        <span>New Model</span>
                    </Button>
                }
            />

            {/* Filter toolbar */}
            <div className="px-6 py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/40 dark:bg-slate-900/40 flex items-center justify-between gap-4">
                <div className="relative w-72">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                        placeholder="Search models..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 pl-8 text-xs bg-white dark:bg-slate-900"
                    />
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                    {['all', 'table', 'view', 'incremental'].map((mat) => (
                        <button
                            key={mat}
                            onClick={() => setFilterMat(mat)}
                            className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                                filterMat === mat
                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                        >
                            {mat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Grid */}
            <div className="flex-1 overflow-y-auto p-6">
                <ModelList models={filteredModels} isLoading={isLoading} />
            </div>
        </div>
    );
}

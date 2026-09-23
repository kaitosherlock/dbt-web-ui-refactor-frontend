'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Code2, Network, Sparkles, Play, RefreshCw } from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace/layout';
import { ModelEditor, CompiledPreviewPane } from '@/components/workspace/models';
import { LineageGraph } from '@/components/workspace/lineage';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useModel, useCompilePreview } from '@/core/models';
import { useLineage } from '@/core/lineage';

export default function ModelDetailPage() {
    const params = useParams();
    const rawId = params.model_id as string;
    const modelPath = decodeURIComponent(rawId);
    const modelName = modelPath.split('/').pop()?.replace(/\.sql$/, '') || modelPath;

    const { model, isLoading, saveSql } = useModel('default', modelPath);
    const {
        compile,
        preview,
        isCompiling,
        isPreviewing,
        compileResult,
        previewResult,
    } = useCompilePreview('default');

    const { nodes, edges, isLoading: isLineageLoading } = useLineage('default', modelPath);

    const [activeTab, setActiveTab] = useState('editor');

    const handleCompile = (sql: string) => {
        compile(modelPath);
    };

    const handlePreview = (sql: string) => {
        preview(modelPath);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <WorkspaceHeader
                title={`Model: ${modelName}`}
                description={`models/${modelName}.sql`}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/workspace/models">
                            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs">
                                <ArrowLeft className="h-3.5 w-3.5" />
                                <span>Models</span>
                            </Button>
                        </Link>

                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/60">
                            <button
                                onClick={() => setActiveTab('editor')}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors ${
                                    activeTab === 'editor'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                <Code2 className="h-3.5 w-3.5" />
                                <span>SQL Editor</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('lineage')}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors ${
                                    activeTab === 'lineage'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                <Network className="h-3.5 w-3.5" />
                                <span>Model Lineage</span>
                            </button>
                        </div>
                    </div>
                }
            />

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'editor' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 h-full gap-4 p-4">
                        {/* Left: Code Editor */}
                        <div className="h-full min-h-[300px]">
                            <ModelEditor
                                modelPath={modelPath}
                                initialSql={
                                    model?.raw_sql ||
                                    `-- ${modelName}.sql\nwith source_data as (\n    select * from {{ ref('stg_customers') }}\n)\nselect\n    id as customer_id,\n    first_name,\n    last_name\nfrom source_data\n`
                                }
                                onSave={saveSql}
                                onCompile={handleCompile}
                                onPreview={handlePreview}
                                isCompiling={isCompiling}
                                isPreviewing={isPreviewing}
                            />
                        </div>

                        {/* Right: Compiled SQL & Query Preview */}
                        <div className="h-full min-h-[300px]">
                            <CompiledPreviewPane
                                compileResult={compileResult}
                                previewResult={previewResult}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="h-full">
                        <LineageGraph
                            nodes={
                                nodes.length > 0
                                    ? nodes
                                    : [
                                          {
                                              id: `model.${modelName}`,
                                              name: modelName,
                                              type: 'model',
                                              schema: 'analytics',
                                              columns: [{ name: 'customer_id' }, { name: 'first_name' }],
                                          },
                                      ]
                            }
                            edges={edges}
                            isLoading={isLineageLoading}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace/layout';
import { SourceListTable } from '@/components/workspace/sources';
import { Button } from '@/components/ui/button';
import { useSources, sourcesApi } from '@/core/sources';

export default function SourcesOverviewPage() {
    const { sources, isLoading, refresh } = useSources('default');

    const handleTriggerIngest = async (sourceId: string) => {
        await sourcesApi.triggerIngest(sourceId);
        refresh();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <WorkspaceHeader
                title="Data Sources"
                description="Raw data ingested via dlt from SQL databases, REST APIs, or files into DuckLake."
                actions={
                    <Button size="sm" className="h-8 gap-1.5 text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white">
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Source</span>
                    </Button>
                }
            />

            <div className="flex-1 overflow-y-auto p-6">
                <SourceListTable
                    sources={
                        sources.length > 0
                            ? sources
                            : [
                                  {
                                      id: 'src_postgres_crm',
                                      name: 'crm_postgres',
                                      source_name: 'crm_postgres',
                                      schema_name: 'crm_raw',
                                      source_kind: 'sql_database',
                                      tables: [{ name: 'accounts' }, { name: 'contacts' }, { name: 'deals' }],
                                      cursor_field: 'updated_at',
                                      freshness_status: 'pass',
                                      last_loaded_at: new Date().toISOString(),
                                  },
                                  {
                                      id: 'src_stripe_billing',
                                      name: 'stripe_api',
                                      source_name: 'stripe_api',
                                      schema_name: 'stripe_raw',
                                      source_kind: 'rest_api',
                                      tables: [{ name: 'charges' }, { name: 'invoices' }],
                                      cursor_field: 'created',
                                      freshness_status: 'pass',
                                      last_loaded_at: new Date().toISOString(),
                                  },
                              ]
                    }
                    isLoading={isLoading}
                    onTriggerIngest={handleTriggerIngest}
                />
            </div>
        </div>
    );
}

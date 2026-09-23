'use client';

import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Table2, Database, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/core/utils';
import type { CatalogTable } from '@/core/catalog';

interface SchemaTreeProps {
    tables: CatalogTable[];
    selectedTableId?: string | null;
    onSelectTable: (tableId: string) => void;
}

export function SchemaTree({ tables, selectedTableId, onSelectTable }: SchemaTreeProps) {
    const [search, setSearch] = useState('');
    const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});

    const filteredTables = useMemo(() => {
        if (!search.trim()) return tables;
        const q = search.toLowerCase();
        return tables.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                t.schema.toLowerCase().includes(q) ||
                t.columns.some((c) => c.name.toLowerCase().includes(q))
        );
    }, [tables, search]);

    // Group tables by schema
    const schemaGroups = useMemo(() => {
        const groups: Record<string, CatalogTable[]> = {};
        for (const t of filteredTables) {
            const schema = t.schema || 'default';
            if (!groups[schema]) groups[schema] = [];
            groups[schema].push(t);
        }
        return groups;
    }, [filteredTables]);

    const toggleSchema = (schema: string) => {
        setCollapsedSchemas((prev) => ({
            ...prev,
            [schema]: !prev[schema],
        }));
    };

    return (
        <aside className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full shrink-0">
            {/* Search */}
            <div className="p-3 border-b border-slate-200/80 dark:border-slate-800/80">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                        placeholder="Search tables or columns..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 pl-8 text-xs bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    />
                </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3 text-xs">
                {Object.keys(schemaGroups).length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-xs">No tables matched</div>
                ) : (
                    Object.entries(schemaGroups).map(([schema, schemaTables]) => {
                        const isCollapsed = collapsedSchemas[schema];

                        return (
                            <div key={schema} className="space-y-1">
                                <button
                                    onClick={() => toggleSchema(schema)}
                                    className="w-full flex items-center justify-between px-2 py-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 font-semibold text-[11px] uppercase tracking-wider transition-colors"
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        {isCollapsed ? (
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        )}
                                        <span className="truncate">{schema}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400">{schemaTables.length}</span>
                                </button>

                                {!isCollapsed && (
                                    <div className="space-y-0.5 pl-2">
                                        {schemaTables.map((t) => {
                                            const isSelected = selectedTableId === t.id;

                                            return (
                                                <button
                                                    key={t.id}
                                                    onClick={() => onSelectTable(t.id)}
                                                    className={cn(
                                                        'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md font-mono text-xs transition-colors text-left',
                                                        isSelected
                                                            ? 'bg-[#0078D4]/10 text-[#0078D4] dark:bg-[#0078D4]/20 dark:text-blue-400 font-semibold'
                                                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        {t.type === 'source' ? (
                                                            <Database className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                                        ) : t.type === 'view' ? (
                                                            <Eye className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                                        ) : (
                                                            <Table2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                        )}
                                                        <span className="truncate">{t.name}</span>
                                                    </div>

                                                    <span className="text-[10px] text-slate-400 font-sans">
                                                        {t.columns.length}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}

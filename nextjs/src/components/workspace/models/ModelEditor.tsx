'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Play, Save, AlignLeft, Sparkles, HelpCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { modelsApi } from '@/core/models';

interface ModelEditorProps {
    modelPath: string;
    initialSql: string;
    onSave?: (sql: string) => Promise<boolean>;
    onCompile?: (sql: string) => void;
    onPreview?: (sql: string) => void;
    onExplain?: (sql: string) => void;
    isCompiling?: boolean;
    isPreviewing?: boolean;
}

export function ModelEditor({
    modelPath,
    initialSql,
    onSave,
    onCompile,
    onPreview,
    onExplain,
    isCompiling,
    isPreviewing,
}: ModelEditorProps) {
    const [sql, setSql] = useState(initialSql);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        setSql(initialSql);
    }, [initialSql]);

    const handleSave = async () => {
        if (!onSave) return;
        setIsSaving(true);
        try {
            const ok = await onSave(sql);
            if (ok) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 2000);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleFormat = async () => {
        const formatted = await modelsApi.formatSql(sql);
        setSql(formatted);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSave();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            onPreview?.(sql);
        }
    };

    return (
        <div className="flex flex-col h-full border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
            {/* Editor Toolbar */}
            <div className="h-11 px-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">
                        {modelPath}
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleFormat}
                        className="h-7 px-2 text-xs text-slate-600 dark:text-slate-400 gap-1"
                        title="Format SQL (Shift+Alt+F)"
                    >
                        <AlignLeft className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Format</span>
                    </Button>

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="h-7 px-2.5 text-xs gap-1"
                    >
                        {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : saveSuccess ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                            <Save className="h-3.5 w-3.5" />
                        )}
                        <span>{saveSuccess ? 'Saved' : 'Save'}</span>
                    </Button>

                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onCompile?.(sql)}
                        disabled={isCompiling}
                        className="h-7 px-2.5 text-xs gap-1"
                    >
                        {isCompiling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        <span>Compile</span>
                    </Button>

                    <Button
                        size="sm"
                        onClick={() => onPreview?.(sql)}
                        disabled={isPreviewing}
                        className="h-7 px-2.5 text-xs gap-1 bg-[#0078D4] text-white hover:bg-[#106EBE]"
                    >
                        {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                        <span>Preview (dbt show)</span>
                    </Button>
                </div>
            </div>

            {/* SQL Editor Area */}
            <div className="flex-1 relative font-mono text-sm bg-slate-950 text-slate-100 p-4 overflow-auto">
                <textarea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    className="w-full h-full bg-transparent resize-none focus:outline-none font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-600"
                    placeholder="-- Write dbt SQL model with Jinja (e.g. ref('raw_customers'))..."
                />
            </div>

            {/* Bottom Status bar */}
            <div className="h-6 px-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[11px] text-slate-500 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <span>SQL (dbt Jinja)</span>
                    <span>Lines: {sql.split('\n').length}</span>
                </div>
                <div>
                    <span>Ctrl+S to save • Ctrl+Enter to preview</span>
                </div>
            </div>
        </div>
    );
}

'use client';

import React from 'react';
import { Play, Sparkles, Terminal, Bell, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/core/auth';

interface WorkspaceHeaderProps {
    title?: string;
    description?: string;
    actions?: React.ReactNode;
    onTriggerRun?: () => void;
}

export function WorkspaceHeader({ title, description, actions, onTriggerRun }: WorkspaceHeaderProps) {
    const { user } = useAuth();

    return (
        <header className="h-14 px-6 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md flex items-center justify-between shrink-0">
            <div>
                {title && (
                    <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        {title}
                    </h1>
                )}
                {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
            </div>

            <div className="flex items-center gap-3">
                {actions}

                {onTriggerRun && (
                    <Button size="sm" onClick={onTriggerRun} className="h-8 gap-1.5 text-xs font-semibold">
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Run dbt</span>
                    </Button>
                )}

                <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />

                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="h-7 w-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-medium">
                        {user?.name ? user.name[0].toUpperCase() : <User className="h-3.5 w-3.5" />}
                    </div>
                    <span className="hidden sm:inline-block font-medium truncate max-w-[120px]">
                        {user?.name || user?.email || 'Developer'}
                    </span>
                </div>
            </div>
        </header>
    );
}

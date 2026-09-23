'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, FolderGit2, Plus, Check } from 'lucide-react';
import { adminApi, type AdminProject } from '@/core/admin';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ProjectSwitcherProps {
    currentProjectId?: string;
    onSelectProject?: (projectId: string) => void;
}

export function ProjectSwitcher({ currentProjectId, onSelectProject }: ProjectSwitcherProps) {
    const [projects, setProjects] = useState<AdminProject[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        adminApi
            .listProjects()
            .then((data) => {
                if (mounted) setProjects(data);
            })
            .catch(() => {
                // Fallback default project
                if (mounted) {
                    setProjects([
                        {
                            id: 'default',
                            name: 'default_dbt_project',
                            git_branch: 'main',
                        },
                    ]);
                }
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, []);

    const activeProject =
        projects.find((p) => p.id === currentProjectId) ||
        projects[0] || {
            id: currentProjectId || 'default',
            name: 'dbt Project',
            git_branch: 'main',
        };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2.5 px-3 py-2 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-full border border-slate-200/80 dark:border-slate-800 focus:outline-none">
                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-[#0078D4]/10 text-[#0078D4] dark:bg-[#0078D4]/20 font-semibold text-xs shrink-0">
                    <FolderGit2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                        {activeProject.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {activeProject.git_branch || 'main'}
                    </p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start">
                <DropdownMenuLabel>Projects</DropdownMenuLabel>
                {projects.map((p) => (
                    <DropdownMenuItem
                        key={p.id}
                        onClick={() => onSelectProject?.(p.id)}
                        className="flex items-center justify-between text-xs"
                    >
                        <span className="truncate">{p.name}</span>
                        {p.id === activeProject.id && <Check className="h-3.5 w-3.5 text-[#0078D4]" />}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-xs text-[#0078D4] gap-2 cursor-pointer">
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create new project</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

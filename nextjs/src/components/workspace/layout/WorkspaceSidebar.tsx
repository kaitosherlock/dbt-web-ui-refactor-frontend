'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Code2,
    Network,
    ArrowDownToLine,
    Activity,
    CheckCircle2,
    Boxes,
    BookOpen,
    Link2,
    Clock,
    FolderGit2,
    Users,
    BarChart3,
    Sparkles,
} from 'lucide-react';
import { cn } from '@/core/utils';
import { ProjectSwitcher } from './ProjectSwitcher';

interface NavItem {
    label: string;
    href: string;
    icon: React.ElementType;
    badge?: string;
}

const PRIMARY_NAV: NavItem[] = [
    { label: 'Models', href: '/workspace/models', icon: Code2 },
    { label: 'Lineage DAG', href: '/workspace/lineage', icon: Network },
    { label: 'Sources', href: '/workspace/sources', icon: ArrowDownToLine },
    { label: 'Runs', href: '/workspace/runs', icon: Activity },
    { label: 'Tests', href: '/workspace/tests', icon: CheckCircle2 },
];

const METADATA_NAV: NavItem[] = [
    { label: 'Catalog', href: '/workspace/catalog', icon: Boxes },
    { label: 'Docs', href: '/workspace/docs', icon: BookOpen },
    { label: 'Connections', href: '/workspace/connections', icon: Link2 },
    { label: 'Schedules', href: '/workspace/schedules', icon: Clock },
];

const ADMIN_NAV: NavItem[] = [
    { label: 'Projects', href: '/workspace/admin/projects', icon: FolderGit2 },
    { label: 'Users', href: '/workspace/admin/users', icon: Users },
    { label: 'Usage', href: '/workspace/admin/usage', icon: BarChart3 },
];

interface WorkspaceSidebarProps {
    currentProjectId?: string;
    onSelectProject?: (projectId: string) => void;
}

export function WorkspaceSidebar({ currentProjectId, onSelectProject }: WorkspaceSidebarProps) {
    const pathname = usePathname();

    const isLinkActive = (href: string) => {
        if (href === '/workspace/models') {
            return pathname === href || pathname.startsWith('/workspace/models/');
        }
        if (href === '/workspace/sources') {
            return pathname === href || pathname.startsWith('/workspace/sources/');
        }
        if (href === '/workspace/runs') {
            return pathname === href || pathname.startsWith('/workspace/runs/');
        }
        if (href === '/workspace/catalog') {
            return pathname === href || pathname.startsWith('/workspace/catalog/');
        }
        return pathname === href;
    };

    return (
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex flex-col h-screen shrink-0">
            {/* Header Brand */}
            <div className="h-14 px-4 flex items-center gap-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
                <div className="h-8 w-8 rounded-lg bg-[#FF6B4A] flex items-center justify-center text-white font-bold text-sm shadow-xs">
                    <Sparkles className="h-4 w-4" />
                </div>
                <div className="leading-tight">
                    <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-white">
                        dbt Platform
                    </span>
                    <span className="block text-[10px] text-slate-400 font-mono">v0.1.0 • DuckDB</span>
                </div>
            </div>

            {/* Project Switcher */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800/60">
                <ProjectSwitcher currentProjectId={currentProjectId} onSelectProject={onSelectProject} />
            </div>

            {/* Nav Groups */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-6 text-xs">
                {/* Core Transformation */}
                <div>
                    <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Transformation
                    </p>
                    <nav className="space-y-0.5">
                        {PRIMARY_NAV.map((item) => {
                            const active = isLinkActive(item.href);
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md font-medium transition-colors',
                                        active
                                            ? 'bg-[#0078D4]/10 text-[#0078D4] dark:bg-[#0078D4]/20 dark:text-blue-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                                    )}
                                >
                                    <Icon className={cn('h-4 w-4', active ? 'text-[#0078D4]' : 'text-slate-400')} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                {/* Metadata & Governance */}
                <div>
                    <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Governance
                    </p>
                    <nav className="space-y-0.5">
                        {METADATA_NAV.map((item) => {
                            const active = isLinkActive(item.href);
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md font-medium transition-colors',
                                        active
                                            ? 'bg-[#0078D4]/10 text-[#0078D4] dark:bg-[#0078D4]/20 dark:text-blue-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                                    )}
                                >
                                    <Icon className={cn('h-4 w-4', active ? 'text-[#0078D4]' : 'text-slate-400')} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                {/* Administration */}
                <div>
                    <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Admin
                    </p>
                    <nav className="space-y-0.5">
                        {ADMIN_NAV.map((item) => {
                            const active = isLinkActive(item.href);
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md font-medium transition-colors',
                                        active
                                            ? 'bg-[#0078D4]/10 text-[#0078D4] dark:bg-[#0078D4]/20 dark:text-blue-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                                    )}
                                >
                                    <Icon className={cn('h-4 w-4', active ? 'text-[#0078D4]' : 'text-slate-400')} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>
            </div>

            {/* Bottom Status */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Runner Ready
                </span>
                <span className="font-mono text-[10px] text-slate-400">Port 8080</span>
            </div>
        </aside>
    );
}

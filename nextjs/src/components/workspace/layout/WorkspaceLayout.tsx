'use client';

import React, { useState } from 'react';
import { WorkspaceSidebar } from './WorkspaceSidebar';

interface WorkspaceLayoutProps {
    children: React.ReactNode;
}

export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
    const [currentProjectId, setCurrentProjectId] = useState<string>('default');

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans antialiased text-slate-900 dark:text-slate-100">
            <WorkspaceSidebar currentProjectId={currentProjectId} onSelectProject={setCurrentProjectId} />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">{children}</main>
        </div>
    );
}

export default WorkspaceLayout;

import React from 'react';
import { WorkspaceLayout } from '@/components/workspace/layout';

export default function AppWorkspaceLayout({ children }: { children: React.ReactNode }) {
    return <WorkspaceLayout>{children}</WorkspaceLayout>;
}

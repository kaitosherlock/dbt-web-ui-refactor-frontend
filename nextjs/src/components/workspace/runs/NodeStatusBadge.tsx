'use client';

import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { RunStatus } from '@/core/runs';

interface NodeStatusBadgeProps {
    status: RunStatus | 'skipped';
    className?: string;
}

export function NodeStatusBadge({ status, className }: NodeStatusBadgeProps) {
    switch (status) {
        case 'success':
            return (
                <Badge variant="success" className={className}>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Success
                </Badge>
            );
        case 'running':
            return (
                <Badge variant="info" className={className}>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Running
                </Badge>
            );
        case 'error':
            return (
                <Badge variant="destructive" className={className}>
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                </Badge>
            );
        case 'cancelled':
            return (
                <Badge variant="warning" className={className}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Cancelled
                </Badge>
            );
        case 'skipped':
            return (
                <Badge variant="secondary" className={className}>
                    Skipped
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className={className}>
                    <Clock className="h-3 w-3 mr-1" />
                    Pending
                </Badge>
            );
    }
}

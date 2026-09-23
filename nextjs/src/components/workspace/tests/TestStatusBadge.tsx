'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TestStatus } from '@/core/tests';

interface TestStatusBadgeProps {
    status: TestStatus;
    className?: string;
}

export function TestStatusBadge({ status, className }: TestStatusBadgeProps) {
    switch (status) {
        case 'pass':
            return (
                <Badge variant="success" className={className}>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    PASS
                </Badge>
            );
        case 'fail':
            return (
                <Badge variant="destructive" className={className}>
                    <XCircle className="h-3 w-3 mr-1" />
                    FAIL
                </Badge>
            );
        case 'warn':
            return (
                <Badge variant="warning" className={className}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    WARN
                </Badge>
            );
        default:
            return (
                <Badge variant="destructive" className={className}>
                    <AlertCircle className="h-3 w-3 mr-1" />
                    ERROR
                </Badge>
            );
    }
}

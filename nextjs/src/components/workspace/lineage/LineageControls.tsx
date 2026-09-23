'use client';

import React from 'react';
import { Search, ZoomIn, ZoomOut, Maximize2, ArrowLeftRight, ArrowLeft, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TraceDirection } from '@/core/lineage';

interface LineageControlsProps {
    searchQuery: string;
    onSearchChange: (q: string) => void;
    direction: TraceDirection;
    onDirectionChange: (d: TraceDirection) => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onResetZoom?: () => void;
}

export function LineageControls({
    searchQuery,
    onSearchChange,
    direction,
    onDirectionChange,
    onZoomIn,
    onZoomOut,
    onResetZoom,
}: LineageControlsProps) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xs">
            {/* Search */}
            <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                    placeholder="Search node name..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="h-8 pl-8 text-xs bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                />
            </div>

            {/* Trace Direction Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/60">
                <Button
                    size="sm"
                    variant={direction === 'all' ? 'default' : 'ghost'}
                    onClick={() => onDirectionChange('all')}
                    className="h-7 px-2.5 text-xs gap-1"
                >
                    <ArrowLeftRight className="h-3 w-3" />
                    <span>All</span>
                </Button>
                <Button
                    size="sm"
                    variant={direction === 'upstream' ? 'default' : 'ghost'}
                    onClick={() => onDirectionChange('upstream')}
                    className="h-7 px-2.5 text-xs gap-1"
                >
                    <ArrowLeft className="h-3 w-3" />
                    <span>Upstream</span>
                </Button>
                <Button
                    size="sm"
                    variant={direction === 'downstream' ? 'default' : 'ghost'}
                    onClick={() => onDirectionChange('downstream')}
                    className="h-7 px-2.5 text-xs gap-1"
                >
                    <ArrowRight className="h-3 w-3" />
                    <span>Downstream</span>
                </Button>
            </div>

            {/* Zoom / View controls */}
            <div className="flex items-center gap-1">
                {onZoomIn && (
                    <Button size="sm" variant="outline" onClick={onZoomIn} className="h-7 w-7 p-0">
                        <ZoomIn className="h-3.5 w-3.5" />
                    </Button>
                )}
                {onZoomOut && (
                    <Button size="sm" variant="outline" onClick={onZoomOut} className="h-7 w-7 p-0">
                        <ZoomOut className="h-3.5 w-3.5" />
                    </Button>
                )}
                {onResetZoom && (
                    <Button size="sm" variant="outline" onClick={onResetZoom} className="h-7 px-2 text-xs gap-1">
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Fit</span>
                    </Button>
                )}
            </div>
        </div>
    );
}

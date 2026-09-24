'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface PanelErrorBoundaryProps {
    panelName: string;
    resetKey?: string | number;
    children: ReactNode;
}

interface PanelErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export default class PanelErrorBoundary extends Component<
    PanelErrorBoundaryProps,
    PanelErrorBoundaryState
> {
    constructor(props: PanelErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`[PanelErrorBoundary:${this.props.panelName}]`, error, errorInfo);
    }

    componentDidUpdate(prevProps: PanelErrorBoundaryProps) {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full flex items-center justify-center p-6 bg-white">
                    <div className="max-w-md text-center">
                        <AlertCircle className="w-8 h-8 text-[#D32F2F] mx-auto mb-3" />
                        <h3 className="text-sm font-semibold text-[#242424] mb-1">
                            Failed to render {this.props.panelName}
                        </h3>
                        <p className="text-xs text-[#616161] font-mono break-words mb-4 bg-[#FAF9F8] p-2.5 rounded border border-[#E6E6E6]">
                            {this.state.error?.message || 'An unexpected error occurred'}
                        </p>
                        <button
                            type="button"
                            onClick={this.handleRetry}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#F3F2F1] hover:bg-[#E6E6E6] rounded text-[#242424] border border-[#E6E6E6] transition-colors"
                        >
                            <RefreshCw className="w-3 h-3" />
                            Retry
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

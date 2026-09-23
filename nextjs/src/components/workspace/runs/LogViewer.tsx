'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Copy, Check, ArrowDown, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface LogViewerProps {
    logs: string[];
    isRunning?: boolean;
    onClear?: () => void;
}

export function LogViewer({ logs, isRunning, onClear }: LogViewerProps) {
    const [search, setSearch] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [copied, setCopied] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);

    const filteredLogs = search
        ? logs.filter((line) => line.toLowerCase().includes(search.toLowerCase()))
        : logs;

    const handleCopy = () => {
        navigator.clipboard.writeText(logs.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getLineStyle = (line: string) => {
        if (/error|fail|exception/i.test(line)) {
            return 'text-red-400 font-semibold';
        }
        if (/warn/i.test(line)) {
            return 'text-amber-400';
        }
        if (/success|ok|pass|completed/i.test(line)) {
            return 'text-emerald-400';
        }
        return 'text-slate-300';
    };

    return (
        <div className="flex flex-col h-full border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-950 font-mono text-xs shadow-md">
            {/* Toolbar */}
            <div className="h-10 px-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-300">Live Execution Logs</span>
                    {isRunning && (
                        <span className="flex items-center gap-1 text-[10px] text-[#0078D4] animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#0078D4]" />
                            Streaming
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-44">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                        <Input
                            placeholder="Filter logs..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-6 pl-7 text-[11px] bg-slate-950 border-slate-800 text-slate-200"
                        />
                    </div>

                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAutoScroll((v) => !v)}
                        className={`h-6 px-2 text-[10px] ${autoScroll ? 'text-[#0078D4]' : 'text-slate-500'}`}
                    >
                        <ArrowDown className="h-3 w-3 mr-1" />
                        Auto-scroll
                    </Button>

                    <Button size="sm" variant="ghost" onClick={handleCopy} className="h-6 px-2 text-[10px] text-slate-400">
                        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </Button>

                    {onClear && (
                        <Button size="sm" variant="ghost" onClick={onClear} className="h-6 px-2 text-[10px] text-slate-400">
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Logs Output */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 leading-relaxed">
                {filteredLogs.length === 0 ? (
                    <div className="text-slate-600 italic">No output received yet...</div>
                ) : (
                    filteredLogs.map((line, idx) => (
                        <div key={idx} className={`whitespace-pre-wrap ${getLineStyle(line)}`}>
                            {line}
                        </div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

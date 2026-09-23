'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { WarehouseConnection, ConnectionType } from '@/core/connections';

interface WarehouseFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: Partial<WarehouseConnection> & { password?: string }) => Promise<void>;
    initialData?: WarehouseConnection | null;
}

const SUPPORTED_TYPES: Array<{ value: ConnectionType; label: string }> = [
    { value: 'ducklake', label: 'DuckLake (Default Lakehouse)' },
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'snowflake', label: 'Snowflake' },
    { value: 'bigquery', label: 'Google BigQuery' },
    { value: 'duckdb', label: 'DuckDB Local' },
    { value: 'dremio', label: 'Dremio' },
];

export function WarehouseForm({ open, onOpenChange, onSubmit, initialData }: WarehouseFormProps) {
    const [name, setName] = useState(initialData?.name || '');
    const [type, setType] = useState<ConnectionType>(initialData?.type || 'postgres');
    const [host, setHost] = useState(initialData?.host || '');
    const [port, setPort] = useState(initialData?.port ? String(initialData.port) : '5432');
    const [database, setDatabase] = useState(initialData?.database || '');
    const [schema, setSchema] = useState(initialData?.schema || 'public');
    const [username, setUsername] = useState(initialData?.username || '');
    const [password, setPassword] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSubmit({
                name,
                type,
                host,
                port: port ? parseInt(port, 10) : undefined,
                database,
                schema,
                username,
                password: password || undefined,
            });
            onOpenChange(false);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>
                            {initialData ? 'Configure Connection' : 'Add Warehouse Connection'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3 text-xs">
                        <div>
                            <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                Connection Name
                            </label>
                            <Input
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Production Analytics Warehouse"
                            />
                        </div>

                        <div>
                            <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                Warehouse Type
                            </label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as ConnectionType)}
                                className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none"
                            >
                                {SUPPORTED_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Host / Endpoint
                                </label>
                                <Input
                                    value={host}
                                    onChange={(e) => setHost(e.target.value)}
                                    placeholder="db.example.com"
                                />
                            </div>
                            <div>
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Port
                                </label>
                                <Input
                                    value={port}
                                    onChange={(e) => setPort(e.target.value)}
                                    placeholder="5432"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Database
                                </label>
                                <Input
                                    value={database}
                                    onChange={(e) => setDatabase(e.target.value)}
                                    placeholder="analytics"
                                />
                            </div>
                            <div>
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Schema
                                </label>
                                <Input
                                    value={schema}
                                    onChange={(e) => setSchema(e.target.value)}
                                    placeholder="public"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Username
                                </label>
                                <Input
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="dbt_user"
                                />
                            </div>
                            <div>
                                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                                    Password
                                </label>
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSaving || !name}
                            className="text-xs bg-[#0078D4] hover:bg-[#106EBE] text-white"
                        >
                            {isSaving ? 'Saving...' : 'Save Connection'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

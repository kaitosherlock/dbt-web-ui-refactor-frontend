'use client';

import { useState, useCallback } from 'react';

export interface NotificationItem {
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message?: string;
    timestamp: string;
}

let subscribers: Array<(notifications: NotificationItem[]) => void> = [];
let currentNotifications: NotificationItem[] = [];

export const notificationService = {
    show(item: Omit<NotificationItem, 'id' | 'timestamp'>) {
        const newItem: NotificationItem = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            ...item,
        };
        currentNotifications = [newItem, ...currentNotifications].slice(0, 50);
        subscribers.forEach((cb) => cb([...currentNotifications]));
        return newItem.id;
    },

    dismiss(id: string) {
        currentNotifications = currentNotifications.filter((n) => n.id !== id);
        subscribers.forEach((cb) => cb([...currentNotifications]));
    },

    clear() {
        currentNotifications = [];
        subscribers.forEach((cb) => cb([]));
    },
};

export function useNotifications() {
    const [notifications, setNotifications] = useState<NotificationItem[]>(currentNotifications);

    const dismiss = useCallback((id: string) => {
        notificationService.dismiss(id);
    }, []);

    const notify = useCallback((item: Omit<NotificationItem, 'id' | 'timestamp'>) => {
        return notificationService.show(item);
    }, []);

    return {
        notifications,
        notify,
        dismiss,
    };
}

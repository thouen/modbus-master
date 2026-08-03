'use client';

import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ConnectionStatus, LogEntry } from '@/types/modbus';

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
  connectionStatus: ConnectionStatus;
  connectionTime?: number;
}

const TYPE_COLORS: Record<string, string> = {
  connect: 'text-emerald-400',
  disconnect: 'text-zinc-400',
  read: 'text-blue-400',
  write: 'text-amber-400',
  error: 'text-red-400',
};

const TYPE_ICONS: Record<string, string> = {
  connect: '→',
  disconnect: '×',
  read: '↓',
  write: '↑',
  error: '!',
};

export function LogPanel({ logs, onClear, connectionStatus, connectionTime }: LogPanelProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

  const formatConnectionTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  // Generate translated log message
  const getLogMessage = (log: LogEntry): string => {
    // If the log already has a message, try to translate it based on type
    if (log.type === 'connect' && log.success) {
      // Extract host:port from message if possible
      const match = log.message.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
      // Extract protocol
      const protocolMatch = log.message.match(/via (Modbus \w+(?: over \w+)?)/);
      // Extract unit ID
      const unitIdMatch = log.message.match(/Unit ID: (\d+)/);
      if (match) {
        const protocol = protocolMatch ? protocolMatch[1].toLowerCase().replace(/ /g, '_').replace('modbus_', '') : 'tcp';
        const unitId = unitIdMatch ? unitIdMatch[1] : '1';
        return t('log.msg.connectedFull', { host: match[1], port: match[2], protocol: t(`log.msg.protocol.${protocol}`), unitId });
      }
      return t('log.msg.connected', { host: '---', port: '---' });
    }
    if (log.type === 'disconnect') {
      // Extract host:port from message if possible
      const match = log.message.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
      if (match) {
        return t('log.msg.disconnectedFull', { host: match[1], port: match[2] });
      }
      return t('log.msg.disconnected');
    }
    if (log.type === 'read') {
      if (log.success) {
        const count = log.values?.length ?? log.quantity ?? 0;
        const fc = log.functionCode ? `FC${log.functionCode.toString().padStart(2, '0')}` : '';
        const address = log.address !== undefined ? `0x${log.address.toString(16).toUpperCase().padStart(4, '0')}` : '';
        return t('log.msg.readSuccess', { fc, address, count });
      }
      return t('log.msg.readFailed');
    }
    if (log.type === 'write') {
      if (log.success) {
        const count = log.values?.length ?? log.quantity ?? 0;
        const fc = log.functionCode ? `FC${log.functionCode.toString().padStart(2, '0')}` : '';
        const address = log.address !== undefined ? `0x${log.address.toString(16).toUpperCase().padStart(4, '0')}` : '';
        return t('log.msg.writeSuccess', { fc, address, count });
      }
      return t('log.msg.writeFailed');
    }
    if (log.type === 'error') {
      // For errors, show the original message but with translated prefix if possible
      if (log.message?.includes('Not connected')) {
        return t('log.msg.notConnected');
      }
      if (log.message?.includes('Connection failed')) {
        const errorMatch = log.message.match(/Connection failed: (.+)/);
        const error = errorMatch ? errorMatch[1] : log.message;
        return t('log.msg.connectionFailed', { error });
      }
      return log.message || t('log.msg.readFailed');
    }
    return log.message || '';
  };

  return (
    <div className="industrial-panel h-full p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <h2 className="industrial-header">{t('log.title')}</h2>
          <span className="text-sm font-mono text-foreground/60">({logs.length})</span>
        </div>
        <Button
          onClick={onClear}
          variant="ghost"
          size="sm"
          className="text-sm font-mono text-foreground/60 hover:text-foreground h-7"
        >
          {t('log.clear')}
        </Button>
      </div>

      {/* Connection Status */}
      {connectionStatus?.connected && connectionStatus.config && (
        <div className="mb-3 px-3 py-2 bg-primary/10 border border-primary/30 rounded-sm">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
            <span className="font-mono text-primary">
              {connectionStatus.config.host}:{connectionStatus.config.port}
            </span>
            <span className="text-foreground/60 text-xs">
              UID: {connectionStatus.config.unitId}
            </span>
            {connectionTime && (
              <span className="text-foreground/50 text-xs ml-auto">
                {t('log.connectedSince')}: {formatConnectionTime(connectionTime)}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="overflow-auto max-h-[695px] border border-border rounded-sm bg-background/50"
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-foreground/50">
            <p className="text-sm font-mono">{t('log.noLogs')}</p>
          </div>
        ) : (
          <div className="font-mono text-sm">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`flex items-start gap-2 px-3 py-2 border-b border-border/30 hover:bg-secondary/20 transition-colors ${
                  !log.success ? 'bg-red-950/20' : ''
                }`}
              >
                <span className="text-foreground/60 shrink-0 w-[72px]">
                  {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className={`shrink-0 w-4 text-center font-bold ${TYPE_COLORS[log.type] || 'text-foreground/50'}`}>
                  {TYPE_ICONS[log.type] || '-'}
                </span>
                {log.functionCode && (
                  <span className="shrink-0 text-primary/80 w-[100px]" title={`FC${log.functionCode}`}>
                    FC{String(log.functionCode).padStart(2, '0')}
                  </span>
                )}
                <span className={`${log.success ? 'text-foreground/90' : 'text-red-400'} flex-1`}>
                  {getLogMessage(log)}
                </span>
                {log.functionCode && log.address !== undefined && (
                  <span className="shrink-0 text-foreground/50 text-xs">
                    0x{log.address.toString(16).toUpperCase().padStart(4, '0')}
                    {log.quantity ? ` ×${log.quantity}` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

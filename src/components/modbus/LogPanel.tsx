'use client';

import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { LogEntry } from '@/types/modbus';

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
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

const FC_NAMES: Record<number, string> = {
  1: 'READ_COILS',
  2: 'READ_DISCRETE',
  3: 'READ_HOLDING',
  4: 'READ_INPUT',
  5: 'WRITE_COIL',
  6: 'WRITE_REG',
  15: 'WRITE_MULTI_COIL',
  16: 'WRITE_MULTI_REG',
};

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

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

      <div
        ref={scrollRef}
        className="overflow-auto max-h-[300px] border border-border rounded-sm bg-background/50"
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
                  <span className="shrink-0 text-primary/80 w-[120px]">
                    {FC_NAMES[log.functionCode] || `FC${log.functionCode}`}
                  </span>
                )}
                <span className={`${log.success ? 'text-foreground/90' : 'text-red-400'} flex-1`}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

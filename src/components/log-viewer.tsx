'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState } from '@/hooks/use-app-state';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function LogViewer() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Determine active connection: selected > active tab's connection > first connection
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const effectiveConnectionId = selectedConnectionId
    ?? activeTab?.connectionId
    ?? state.connections[0]?.id
    ?? null;

  const logs = useMemo(
    () => effectiveConnectionId ? (state.logs[effectiveConnectionId] ?? []) : [],
    [effectiveConnectionId, state.logs]
  );

  // Build tab name lookup for display
  const tabNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tab of state.tabs) {
      map[tab.id] = tab.name;
    }
    return map;
  }, [state.tabs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = () => {
    if (effectiveConnectionId) {
      dispatch({ type: 'CLEAR_LOGS', payload: effectiveConnectionId });
    }
  };

  const handleExport = () => {
    const conn = state.connections.find(c => c.id === effectiveConnectionId);
    const connName = conn?.name ?? 'unknown';
    const text = logs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const dir = log.direction === 'tx' ? 'TX' : 'RX';
      const tabInfo = log.tabId ? `[${tabNameMap[log.tabId] ?? '?'}] ` : '';
      return `[${time}] [${dir}] ${tabInfo}${log.message}${log.rawData ? ` | ${log.rawData}` : ''}`;
    }).join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modbus-log-${connName}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground">{t('logTitle')}</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Switch
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
              className="scale-75"
            />
            <span className="text-[10px] text-muted-foreground">{t('autoScroll')}</span>
          </div>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleClear}>
            {t('clearLog')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleExport}>
            {t('exportLog')}
          </Button>
        </div>
      </div>
      {/* Connection selector */}
      {state.connections.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border/50">
          <Select
            value={effectiveConnectionId ?? ''}
            onValueChange={v => setSelectedConnectionId(v === '__auto__' ? null : v)}
          >
            <SelectTrigger className="h-6 text-[10px] bg-background border-border">
              <SelectValue placeholder="Select connection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">
                Auto ({activeTab ? state.connections.find(c => c.id === activeTab.connectionId)?.name ?? '-' : '-'})
              </SelectItem>
              {state.connections.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="font-mono text-[11px] p-1">
          {logs.length === 0 && (
            <p className="text-muted-foreground text-center py-4">{t('noData')}</p>
          )}
          {logs.map(log => (
            <div
              key={log.id}
              className={`flex items-start gap-2 px-2 py-0.5 border-b border-border/20 ${
                log.type === 'error' ? 'bg-red-500/5' :
                log.direction === 'tx' ? 'bg-blue-500/[0.03]' : 'bg-green-500/[0.03]'
              }`}
            >
              <span className="text-muted-foreground shrink-0 w-[70px]">
                {formatTime(log.timestamp)}
              </span>
              <span className={`shrink-0 w-5 font-bold ${
                log.direction === 'tx' ? 'text-blue-400' : 'text-green-400'
              }`}>
                {log.direction === 'tx' ? 'TX' : 'RX'}
              </span>
              {/* Show which tab triggered this log */}
              {log.tabId && (
                <span className="shrink-0 text-purple-400/70 text-[9px] w-[50px] truncate" title={tabNameMap[log.tabId]}>
                  {tabNameMap[log.tabId] ?? '?'}
                </span>
              )}
              <span className={`shrink-0 w-8 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'info' ? 'text-amber-400' : 'text-foreground'
              }`}>
                {log.type === 'error' ? 'ERR' : log.type === 'info' ? 'INF' : 'DAT'}
              </span>
              <span className="text-foreground flex-1 truncate">{log.message}</span>
              {log.rawData && (
                <span className="text-cyan-400/70 text-[10px] max-w-[180px] truncate shrink-0">
                  {log.rawData}
                </span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

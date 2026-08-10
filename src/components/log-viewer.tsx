'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prevLogsLengthRef = useRef(0);

  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const effectiveConnectionId = selectedConnectionId
    ?? activeTab?.connectionId
    ?? state.connections[0]?.id
    ?? null;

  const logs = useMemo(
    () => effectiveConnectionId ? (state.logs[effectiveConnectionId] ?? []) : [],
    [effectiveConnectionId, state.logs]
  );

  const tabNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tab of state.tabs) {
      map[tab.id] = tab.name;
    }
    return map;
  }, [state.tabs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (!autoScroll) return;

    // Find the scroll viewport element
    if (!scrollContainerRef.current) {
      scrollContainerRef.current = document.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    }
    const viewport = scrollContainerRef.current;
    if (!viewport) return;

    // Only auto-scroll when new logs are added (length increased)
    if (logs.length > prevLogsLengthRef.current) {
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs.length, autoScroll]);

  // Also scroll on first load
  useEffect(() => {
    if (!autoScroll || logs.length === 0) return;
    const viewport = scrollContainerRef.current ?? document.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    if (viewport) {
      scrollContainerRef.current = viewport;
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    }
  }, [autoScroll, logs.length]);

  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

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
      const dir = log.direction === 'tx' ? 'TX' : log.direction === 'rx' ? 'RX' : 'SYS';
      const tabInfo = log.tabId ? `[${tabNameMap[log.tabId] ?? '?'}] ` : '';
      const typeStr = log.type === 'error' ? 'ERR' : log.type === 'info' ? 'INF' : 'DAT';
      return `[${time}] [${dir}] [${typeStr}] ${tabInfo}${log.message}${log.rawData ? ` | ${log.rawData}` : ''}`;
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
    }) + '.' + d.getMilliseconds().toString().padStart(3, '0');
  };

  const formatHexDump = (rawData: string): string => {
    if (!rawData) return '';
    const bytes = rawData.split(' ').filter(Boolean);
    if (bytes.length <= 8) return rawData;
    const groups: string[] = [];
    for (let i = 0; i < bytes.length; i += 8) {
      groups.push(bytes.slice(i, i + 8).join(' '));
    }
    return groups.join('  │  ');
  };

  const parseLogMessage = (message: string) => {
    // Try to extract ModBus frame details from the message
    // e.g. "FC03 Read holding registers: Addr=0, Qty=10"
    const fcMatch = message.match(/FC(\d{2})/);
    const addrMatch = message.match(/Addr=(\d+)/i);
    const qtyMatch = message.match(/Qty=(\d+)/i);
    return { fc: fcMatch?.[1], addr: addrMatch?.[1], qty: qtyMatch?.[1] };
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-[#0f1319] shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground/90">{t('logTitle')}</h3>
          {effectiveConnectionId && (
            <span className="text-[11px] text-muted-foreground/70">
              {state.connections.find(c => c.id === effectiveConnectionId)?.name ?? '-'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60">{t('autoScroll')}</span>
            <Switch
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
              className="scale-75 origin-right"
            />
          </div>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground" onClick={handleClear}>
            {t('clearLog')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground" onClick={handleExport}>
            {t('exportLog')}
          </Button>
        </div>
      </div>

      {/* Connection selector */}
      {state.connections.length > 1 && (
        <div className="px-3 py-1 border-b border-border/30 bg-[#0f1319]/50">
          <Select
            value={effectiveConnectionId ?? ''}
            onValueChange={v => setSelectedConnectionId(v === '__auto__' ? null : v)}
          >
            <SelectTrigger className="h-6 text-[11px] bg-background/50 border-border/50 w-[200px]">
              <SelectValue placeholder="Select connection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">
                Auto ({activeTab ? state.connections.find(c => c.id === activeTab.connectionId)?.name ?? '-' : '-'})
              </SelectItem>
              {state.connections.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({state.logs[c.id]?.length ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Log entries */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground/50">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-xs">{t('noData')}</p>
            </div>
          ) : (
            <div>
              {logs.map(log => {
                const isExpanded = expandedLogs.has(log.id);
                const isSys = log.direction === 'sys';
                const isTx = log.direction === 'tx';
                const isError = log.type === 'error';
                const isInfo = log.type === 'info';
                const isData = !isError && !isInfo;
                const parsed = parseLogMessage(log.message);

                let rowClass = 'flex flex-col transition-colors hover:bg-white/[0.03] cursor-pointer';
                if (isError) rowClass += ' bg-red-500/[0.04]';
                else if (isSys) rowClass += ' bg-amber-500/[0.03]';
                else if (isTx) rowClass += ' bg-blue-500/[0.02]';

                return (
                  <div
                    key={log.id}
                    className={rowClass}
                    onClick={() => toggleExpand(log.id)}
                  >
                    {/* Summary line */}
                    <div className="flex items-start gap-2 px-3 py-1.5 min-h-0">
                      {/* Expand/collapse indicator */}
                      <span className="shrink-0 text-muted-foreground/30 text-[10px] leading-5 pt-0.5 w-3 text-center select-none transition-transform">
                        {isExpanded ? '▼' : '▶'}
                      </span>

                      {/* Timestamp */}
                      <span className="text-muted-foreground/40 shrink-0 w-[80px] text-[11px] leading-5 pt-0.5 select-none">
                        {formatTime(log.timestamp)}
                      </span>

                      {/* Direction badge */}
                      <span className={'shrink-0 w-[30px] text-center text-[10px] font-bold leading-5 rounded-sm select-none ' + (
                        isSys ? 'bg-amber-500/15 text-amber-400' :
                        isTx ? 'bg-blue-500/15 text-blue-400' :
                        'bg-green-500/15 text-green-400'
                      )}>
                        {isSys ? 'SYS' : isTx ? 'TX' : 'RX'}
                      </span>

                      {/* Tab name */}
                      {log.tabId && (
                        <span className="shrink-0 text-purple-400/60 text-[10px] leading-5 w-[48px] truncate select-none" title={tabNameMap[log.tabId]}>
                          {tabNameMap[log.tabId] ?? '?'}
                        </span>
                      )}

                      {/* Type badge */}
                      <span className={'shrink-0 w-[28px] text-center text-[10px] leading-5 rounded-sm select-none ' + (
                        isError ? 'bg-red-500/15 text-red-400' :
                        isInfo ? 'bg-amber-500/15 text-amber-400' :
                        'text-foreground/40'
                      )}>
                        {isError ? 'ERR' : isInfo ? 'INF' : 'DAT'}
                      </span>

                      {/* Message - main content */}
                      <span className="text-foreground/85 text-[12px] leading-5 flex-1 min-w-0 break-all">
                        {log.message}
                      </span>

                      {/* Raw data preview (compact) */}
                      {log.rawData && !isExpanded && (
                        <span className="text-cyan-400/80 text-[11px] leading-5 max-w-[200px] shrink-0 font-mono select-all truncate" title={log.rawData}>
                          {formatHexDump(log.rawData)}
                        </span>
                      )}
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-3 pb-2 pt-0.5 ml-3 border-l-2 border-border/30 ml-[22px]">
                        {/* ModBus frame details */}
                        {parsed.fc && (
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground/70 mb-1">
                            <span>Function: <span className="text-foreground/80 font-mono">FC{parsed.fc}</span></span>
                            {parsed.addr && <span>Address: <span className="text-foreground/80 font-mono">{parsed.addr}</span></span>}
                            {parsed.qty && <span>Quantity: <span className="text-foreground/80 font-mono">{parsed.qty}</span></span>}
                          </div>
                        )}

                        {/* Full raw data */}
                        {log.rawData && (
                          <div className="space-y-0.5">
                            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{t('rawData')}</div>
                            <div className="bg-black/30 rounded p-2 font-mono text-[11px] leading-relaxed select-all">
                              {/* Address header */}
                              <div className="text-muted-foreground/40 text-[10px] mb-0.5">
                                offset  │ 00 01 02 03 04 05 06 07
                              </div>
                              {/* Hex dump with line numbers */}
                              {(() => {
                                const bytes = log.rawData!.split(' ').filter(Boolean);
                                const lines: { offset: string; hex: string; ascii: string }[] = [];
                                const lineLen = 8;
                                for (let i = 0; i < bytes.length; i += lineLen) {
                                  const chunk = bytes.slice(i, i + lineLen);
                                  const offset = i.toString(16).padStart(4, '0');
                                  const hex = chunk.map(b => b.padStart(2, '0')).join(' ');
                                  const ascii = chunk.map(b => {
                                    const code = parseInt(b, 16);
                                    return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.';
                                  }).join('');
                                  lines.push({ offset, hex: hex.padEnd(lineLen * 3 - 1), ascii });
                                }
                                return lines.map(l => (
                                  <div key={l.offset} className="text-cyan-300/90">
                                    <span className="text-muted-foreground/40">{l.offset}</span>
                                    {'  │  '}
                                    <span className="text-cyan-300/90">{l.hex}</span>
                                    {'  '}
                                    <span className="text-muted-foreground/50">{l.ascii}</span>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
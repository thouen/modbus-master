'use client';

import { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState, type Action } from '@/hooks/use-app-state';
import type { RegisterTab, RegisterData, FunctionCode, DataDisplayFormat, ByteOrder32, ByteOrder64, LogEntry } from '@/lib/modbus-types';
import { generateId, formatRegisterValue, getRegistersPerValue, buildRTUFrame, toHexString } from '@/lib/modbus-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

export function RegisterTabManager() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const [showConfig, setShowConfig] = useState(false);

  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);

  const handleAddTab = () => {
    const connectionId = state.connections.length > 0 ? state.connections[0].id : '';
    const newTab: RegisterTab = {
      id: generateId(),
      name: `Tab ${state.tabs.length + 1}`,
      connectionId,
      startAddress: 0,
      registerCount: 10,
      functionCode: '03',
      pollInterval: 1000,
      displayFormat: 'hex',
      byteOrder32: 'ABCD',
      byteOrder64: 'ABCDEFGH',
      isPolling: false,
    };
    dispatch({ type: 'ADD_TAB', payload: newTab });
  };

  const handleDeleteTab = (tabId: string) => {
    dispatch({ type: 'DELETE_TAB', payload: tabId });
  };

  const handleTabChange = (tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-border bg-muted/20">
        <ScrollArea className="flex-1">
          <div className="flex items-center gap-1">
            {state.tabs.map(tab => (
              <button
                key={tab.id}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-t-md transition-colors border-b-2 ${
                  tab.id === state.activeTabId
                    ? 'bg-background border-blue-500 text-foreground'
                    : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
                onClick={() => handleTabChange(tab.id)}
              >
                <span className="max-w-[80px] truncate">{tab.name}</span>
                {tab.isPolling && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
                <span
                  className="ml-1 text-muted-foreground hover:text-red-400 cursor-pointer"
                  onClick={e => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                >
                  x
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-xs shrink-0"
          onClick={handleAddTab}
        >
          +
        </Button>
        {activeTab && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => setShowConfig(!showConfig)}
          >
            CFG
          </Button>
        )}
      </div>

      {/* Config panel */}
      {showConfig && activeTab && (
        <TabConfigPanel tab={activeTab} />
      )}

      {/* Data display area */}
      {activeTab ? (
        <DataDisplayArea tab={activeTab} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          {t('noData')}
        </div>
      )}
    </div>
  );
}

function TabConfigPanel({ tab }: { tab: RegisterTab }) {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();

  const updateTab = (updates: Partial<RegisterTab>) => {
    dispatch({ type: 'UPDATE_TAB', payload: { ...tab, ...updates } });
  };

  return (
    <div className="p-3 border-b border-border bg-muted/10 space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('tabName')}</label>
          <Input
            className="h-7 text-xs bg-background border-border"
            value={tab.name}
            onChange={e => updateTab({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('connection')}</label>
          <Select value={tab.connectionId} onValueChange={v => updateTab({ connectionId: v })}>
            <SelectTrigger className="h-7 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.connections.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('startAddress')}</label>
          <Input
            type="number"
            className="h-7 text-xs bg-background border-border"
            value={tab.startAddress}
            min={0}
            max={65535}
            onChange={e => updateTab({ startAddress: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('registerCount')}</label>
          <Input
            type="number"
            className="h-7 text-xs bg-background border-border"
            value={tab.registerCount}
            min={1}
            max={125}
            onChange={e => updateTab({ registerCount: Math.min(125, Number(e.target.value)) })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('functionCode')}</label>
          <Select value={tab.functionCode} onValueChange={v => updateTab({ functionCode: v as FunctionCode })}>
            <SelectTrigger className="h-7 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="01">{t('fc01')}</SelectItem>
              <SelectItem value="02">{t('fc02')}</SelectItem>
              <SelectItem value="03">{t('fc03')}</SelectItem>
              <SelectItem value="04">{t('fc04')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('displayFormat')}</label>
          <Select value={tab.displayFormat} onValueChange={v => updateTab({ displayFormat: v as DataDisplayFormat })}>
            <SelectTrigger className="h-7 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="led">{t('formatLed')}</SelectItem>
              <SelectItem value="short">{t('formatShort')}</SelectItem>
              <SelectItem value="ushort">{t('formatUShort')}</SelectItem>
              <SelectItem value="hex">{t('formatHex')}</SelectItem>
              <SelectItem value="binary">{t('formatBinary')}</SelectItem>
              <SelectItem value="long">{t('formatLong')}</SelectItem>
              <SelectItem value="ulong">{t('formatULong')}</SelectItem>
              <SelectItem value="float">{t('formatFloat')}</SelectItem>
              <SelectItem value="double">{t('formatDouble')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(tab.displayFormat === 'long' || tab.displayFormat === 'ulong' || tab.displayFormat === 'float') && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">{t('byteOrder')} (32-bit)</label>
            <Select value={tab.byteOrder32} onValueChange={v => updateTab({ byteOrder32: v as ByteOrder32 })}>
              <SelectTrigger className="h-7 text-xs bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABCD">ABCD ({t('bigEndian')})</SelectItem>
                <SelectItem value="DCBA">DCBA ({t('littleEndian')})</SelectItem>
                <SelectItem value="BADC">BADC ({t('bigEndianSwap')})</SelectItem>
                <SelectItem value="CDAB">CDAB ({t('littleEndianSwap')})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {tab.displayFormat === 'double' && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">{t('byteOrder')} (64-bit)</label>
            <Select value={tab.byteOrder64} onValueChange={v => updateTab({ byteOrder64: v as ByteOrder64 })}>
              <SelectTrigger className="h-7 text-xs bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABCDEFGH">ABCDEFGH ({t('bigEndian')})</SelectItem>
                <SelectItem value="HGFEDCBA">HGFEDCBA ({t('littleEndian')})</SelectItem>
                <SelectItem value="BADCFEHG">BADCFEHG ({t('bigEndianSwap')})</SelectItem>
                <SelectItem value="GHEFCDAB">GHEFCDAB ({t('littleEndianSwap')})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('pollInterval')}</label>
          <Input
            type="number"
            className="h-7 text-xs bg-background border-border"
            value={tab.pollInterval}
            min={100}
            step={100}
            onChange={e => updateTab({ pollInterval: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={tab.isPolling ? 'destructive' : 'default'}
          className="h-7 text-xs"
          onClick={() => updateTab({ isPolling: !tab.isPolling })}
        >
          {tab.isPolling ? t('stopPolling') : t('startPolling')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => {
            // Trigger single read
            simulateRead(tab, dispatch);
          }}
        >
          {t('readOnce')}
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">{t('maxRegisters')}</span>
      </div>
    </div>
  );
}

function simulateRead(tab: RegisterTab, dispatch: React.Dispatch<Action>) {
  // Simulate reading registers with random data
  const data: RegisterData[] = [];
  for (let i = 0; i < tab.registerCount; i++) {
    data.push({
      address: tab.startAddress + i,
      rawValue: Math.floor(Math.random() * 0xffff),
    });
  }

  dispatch({
    type: 'SET_REGISTER_DATA',
    payload: { tabId: tab.id, data },
  });

  // Add log entries
  const connection = { slaveId: 1, protocol: 'tcp' as const, mode: 'rtu' as const };
  const txFrame = tab.functionCode === '03' || tab.functionCode === '04'
    ? buildRTUFrame(connection.slaveId, parseInt(tab.functionCode), tab.startAddress, tab.registerCount)
    : new Uint8Array();

  const txLog: LogEntry = {
    id: generateId(),
    timestamp: Date.now(),
    tabId: tab.id,
    direction: 'tx',
    type: 'data',
    message: `FC${tab.functionCode} Addr:${tab.startAddress} Qty:${tab.registerCount}`,
    rawData: toHexString(txFrame),
  };

  dispatch({
    type: 'ADD_LOG',
    payload: { tabId: tab.id, log: txLog },
  });

  // Simulate response
  setTimeout(() => {
    const responseData = data.map(d => d.rawValue);
    const rxBytes: number[] = [connection.slaveId, parseInt(tab.functionCode), tab.registerCount * 2];
    for (const val of responseData) {
      rxBytes.push((val >> 8) & 0xff, val & 0xff);
    }

    const rxLog: LogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      tabId: tab.id,
      direction: 'rx',
      type: 'data',
      message: `Response ${tab.registerCount} registers`,
      rawData: toHexString(rxBytes),
    };

    dispatch({
      type: 'ADD_LOG',
      payload: { tabId: tab.id, log: rxLog },
    });
  }, 50);
}

function DataDisplayArea({ tab }: { tab: RegisterTab }) {
  const { t } = useI18n();
  const { state } = useAppState();
  const data = state.registerData[tab.id] ?? [];
  const regsPerValue = getRegistersPerValue(tab.displayFormat);

  if (data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
        {t('noData')}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-2">
        {tab.displayFormat === 'led' ? (
          <LedDisplay data={data} />
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-1 px-2 w-16">{t('address')}</th>
                <th className="text-left py-1 px-2 w-20">{t('raw')}</th>
                <th className="text-left py-1 px-2">{t('value')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((reg, idx) => {
                // For 32/64-bit formats, only show value on first register of group
                const isGroupStart = idx % regsPerValue === 0;
                const displayValue = isGroupStart
                  ? formatRegisterValue(data, idx, tab.displayFormat, tab.byteOrder32, tab.byteOrder64)
                  : '';

                return (
                  <tr key={reg.address} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="py-0.5 px-2 text-cyan-400">
                      {reg.address.toString().padStart(5, '0')}
                    </td>
                    <td className="py-0.5 px-2 text-amber-400">
                      {reg.rawValue.toString(16).toUpperCase().padStart(4, '0')}
                    </td>
                    <td className="py-0.5 px-2 text-green-400">
                      {displayValue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ScrollArea>
  );
}

function LedDisplay({ data }: { data: RegisterData[] }) {
  return (
    <div className="flex flex-wrap gap-3 p-2">
      {data.map(reg => (
        <div key={reg.address} className="flex flex-col items-center gap-1">
          <span className="text-[9px] text-muted-foreground font-mono">
            {reg.address.toString().padStart(5, '0')}
          </span>
          <div className="grid grid-cols-4 gap-0.5">
            {Array.from({ length: 16 }, (_, i) => {
              const bit = (reg.rawValue >> (15 - i)) & 1;
              return (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-sm border ${
                    bit
                      ? 'bg-green-500 border-green-400 shadow-[0_0_3px_rgba(34,197,94,0.6)]'
                      : 'bg-zinc-800 border-zinc-700'
                  }`}
                  title={`Bit ${15 - i}: ${bit}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Polling effect
export function usePolling() {
  const { state, dispatch } = useAppState();
  const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    const currentPolling = state.tabs.filter(t => t.isPolling);
    const currentIds = new Set(currentPolling.map(t => t.id));

    // Stop intervals for tabs that are no longer polling
    for (const [id, interval] of Object.entries(intervalsRef.current)) {
      if (!currentIds.has(id)) {
        clearInterval(interval);
        delete intervalsRef.current[id];
      }
    }

    // Start intervals for newly polling tabs
    for (const tab of currentPolling) {
      if (!intervalsRef.current[tab.id]) {
        intervalsRef.current[tab.id] = setInterval(() => {
          simulateRead(tab, dispatch);
        }, tab.pollInterval);
      }
    }

    return () => {
      // Cleanup on unmount
    };
  }, [state.tabs, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    const intervals = intervalsRef.current;
    return () => {
      for (const interval of Object.values(intervals)) {
        clearInterval(interval);
      }
    };
  }, []);
}

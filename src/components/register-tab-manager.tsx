'use client';

import { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState, type Action } from '@/hooks/use-app-state';
import type { RegisterTab, RegisterData, FunctionCode, DataDisplayFormat, ByteOrder32, ByteOrder64, LogEntry, ConnectionConfig } from '@/lib/modbus-types';
import { generateId, formatRegisterValue, getRegistersPerValue, buildRTUFrame, toHexString } from '@/lib/modbus-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TranslationKey } from '@/lib/i18n';

function getFormatLabel(format: DataDisplayFormat, t: (key: TranslationKey) => string): string {
  const map: Record<DataDisplayFormat, TranslationKey> = {
    led: 'formatLed',
    short: 'formatShort',
    ushort: 'formatUShort',
    hex: 'formatHex',
    binary: 'formatBinary',
    long: 'formatLong',
    ulong: 'formatULong',
    float: 'formatFloat',
    double: 'formatDouble',
  };
  return t(map[format]);
}

export function RegisterTabManager() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const [showConfig, setShowConfig] = useState(true);

  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);

  const handleAddTab = () => {
    const connectionId = state.connections.length > 0 ? state.connections[0].id : '';
    const conn = state.connections.find(c => c.id === connectionId);
    const newTab: RegisterTab = {
      id: generateId(),
      name: `Reg ${state.tabs.length + 1}`,
      connectionId,
      startAddress: 0,
      registerCount: 10,
      functionCode: '03',
      pollInterval: 1000,
      displayFormat: 'hex',
      byteOrder32: conn?.byteOrder32 ?? state.globalByteOrder32,
      byteOrder64: conn?.byteOrder64 ?? state.globalByteOrder64,
      isPolling: false,
    };
    dispatch({ type: 'ADD_TAB', payload: newTab });
    setShowConfig(true);
  };

  const handleDeleteTab = (tabId: string) => {
    dispatch({ type: 'DELETE_TAB', payload: tabId });
  };

  const handleTabChange = (tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId });
    setShowConfig(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-border bg-muted/20">
        <ScrollArea className="flex-1">
          <div className="flex items-center gap-1">
            {state.tabs.map(tab => {
              const conn = state.connections.find(c => c.id === tab.connectionId);
              const status = conn ? state.connectionStatus[conn.id] : 'disconnected';
              return (
                <button
                  key={tab.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md transition-colors border-b-2 group ${
                    tab.id === state.activeTabId
                      ? 'bg-background border-blue-500 text-foreground'
                      : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                  onClick={() => handleTabChange(tab.id)}
                >
                  <span className="max-w-[70px] truncate">{tab.name}</span>
                  <span className="text-[9px] text-muted-foreground/60 hidden group-hover:inline">
                    {conn?.name ? `${conn.name}:` : ''}{tab.startAddress}~{tab.startAddress + tab.registerCount - 1}
                  </span>
                  {tab.isPolling && status === 'connected' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                  {tab.isPolling && status !== 'connected' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Connection not established" />
                  )}
                  <span
                    className="ml-1 text-muted-foreground hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                  >
                    x
                  </span>
                </button>
              );
            })}
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
            className={`h-7 px-2 text-xs shrink-0 ${showConfig ? 'text-blue-400' : ''}`}
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

  const connection = state.connections.find(c => c.id === tab.connectionId);

  const updateTab = (updates: Partial<RegisterTab>) => {
    dispatch({ type: 'UPDATE_TAB', payload: { ...tab, ...updates } });
  };

  return (
    <div className="p-3 border-b border-border bg-muted/10 space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
          <Select value={tab.connectionId} onValueChange={v => {
            const newConn = state.connections.find(c => c.id === v);
            updateTab({
              connectionId: v,
              byteOrder32: newConn?.byteOrder32 ?? tab.byteOrder32,
              byteOrder64: newConn?.byteOrder64 ?? tab.byteOrder64,
            });
          }}>
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
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('functionCode')}</label>
          <ToggleGroup type="single" value={tab.functionCode} onValueChange={v => v && updateTab({ functionCode: v as FunctionCode })} className="justify-start flex-wrap gap-0.5">
            {(['01', '02', '03', '04', '05', '06', '15', '16'] as const).map(fc => {
              const fcKey = `fc${fc}` as const;
              return (
                <ToggleGroupItem key={fc} value={fc} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 data-[state=on]:border-blue-500/30 border border-border/50 group" title={t(fcKey)}>
                  <span className="flex flex-col items-center leading-tight">
                    <span className="font-mono">FC{fc}</span>
                    <span className="text-[7px] text-muted-foreground/50 group-data-[state=on]:text-blue-400/60 hidden sm:inline whitespace-nowrap">
                      {t(fcKey).replace(/^\d+ - /, '')}
                    </span>
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('displayFormat')}</label>
          <div className="flex flex-wrap gap-1">
            <ToggleGroup type="single" value={tab.displayFormat} onValueChange={v => v && updateTab({ displayFormat: v as DataDisplayFormat })} className="justify-start flex-wrap gap-0.5">
              <ToggleGroupItem value="led" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-cyan-500/20 data-[state=on]:text-cyan-400 data-[state=on]:border-cyan-500/30 border border-border/50">
                LED
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="short" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Short
              </ToggleGroupItem>
              <ToggleGroupItem value="ushort" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                UShort
              </ToggleGroupItem>
              <ToggleGroupItem value="hex" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Hex
              </ToggleGroupItem>
              <ToggleGroupItem value="binary" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Binary
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="long" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                Long
              </ToggleGroupItem>
              <ToggleGroupItem value="ulong" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                ULong
              </ToggleGroupItem>
              <ToggleGroupItem value="float" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                Float
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="double" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-400 data-[state=on]:border-purple-500/30 border border-border/50">
                Double
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {/* Always show byte order selectors - they apply to any format that uses multiple registers */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('byteOrder')} (32-bit)</label>
          <ToggleGroup type="single" value={tab.byteOrder32} onValueChange={v => v && updateTab({ byteOrder32: v as ByteOrder32 })} className="justify-start flex-wrap gap-0.5">
            <ToggleGroupItem value="ABCD" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">ABCD</ToggleGroupItem>
            <ToggleGroupItem value="DCBA" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">DCBA</ToggleGroupItem>
            <ToggleGroupItem value="BADC" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">BADC</ToggleGroupItem>
            <ToggleGroupItem value="CDAB" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">CDAB</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('byteOrder')} (64-bit)</label>
          <ToggleGroup type="single" value={tab.byteOrder64} onValueChange={v => v && updateTab({ byteOrder64: v as ByteOrder64 })} className="justify-start flex-wrap gap-0.5">
            <ToggleGroupItem value="ABCDEFGH" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">ABCDEFGH</ToggleGroupItem>
            <ToggleGroupItem value="HGFEDCBA" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">HGFEDCBA</ToggleGroupItem>
            <ToggleGroupItem value="BADCFEHG" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">BADCFEHG</ToggleGroupItem>
            <ToggleGroupItem value="GHEFCDAB" size="sm" className="h-6 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 border border-border/50">GHEFCDAB</ToggleGroupItem>
          </ToggleGroup>
        </div>
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
            if (connection) {
              simulateRead(tab, connection, dispatch);
            }
          }}
        >
          {t('readOnce')}
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {connection ? `${connection.byteOrder32} / ${connection.byteOrder64}` : ''}
        </span>
      </div>
    </div>
  );
}

function simulateRead(tab: RegisterTab, connection: ConnectionConfig, dispatch: React.Dispatch<Action>) {
  const slaveId = connection.slaveId;
  const fc = parseInt(tab.functionCode);
  const isWrite = fc === 5 || fc === 6 || fc === 15 || fc === 16;

  // For write functions, simulate writing data
  if (isWrite) {
    const txFrame = buildRTUFrame(slaveId, fc, tab.startAddress, tab.registerCount);

    const txLog: LogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      connectionId: connection.id,
      tabId: tab.id,
      direction: 'tx',
      type: 'data',
      message: `[${tab.name}] FC${tab.functionCode} Write Addr:${tab.startAddress} Qty:${tab.registerCount}`,
      rawData: toHexString(txFrame),
    };

    dispatch({
      type: 'ADD_LOG',
      payload: { connectionId: connection.id, log: txLog },
    });

    // Simulate write response (echo back)
    setTimeout(() => {
      const rxLog: LogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        connectionId: connection.id,
        tabId: tab.id,
        direction: 'rx',
        type: 'data',
        message: `[${tab.name}] Write OK Addr:${tab.startAddress} Qty:${tab.registerCount}`,
        rawData: toHexString(txFrame),
      };

      dispatch({
        type: 'ADD_LOG',
        payload: { connectionId: connection.id, log: rxLog },
      });
    }, 50);

    return;
  }

  // Read functions (FC01-FC04)
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

  const txFrame = buildRTUFrame(slaveId, fc, tab.startAddress, tab.registerCount);

  const txLog: LogEntry = {
    id: generateId(),
    timestamp: Date.now(),
    connectionId: connection.id,
    tabId: tab.id,
    direction: 'tx',
    type: 'data',
    message: `[${tab.name}] FC${tab.functionCode} Start:${tab.startAddress} Qty:${tab.registerCount}`,
    rawData: toHexString(txFrame),
  };

  dispatch({
    type: 'ADD_LOG',
    payload: { connectionId: connection.id, log: txLog },
  });

  // Simulate response with delay
  setTimeout(() => {
    const responseData = data.map(d => d.rawValue);
    const rxBytes: number[] = [slaveId, fc, tab.registerCount * 2];
    for (const val of responseData) {
      rxBytes.push((val >> 8) & 0xff, val & 0xff);
    }

    const rxLog: LogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      connectionId: connection.id,
      tabId: tab.id,
      direction: 'rx',
      type: 'data',
      message: `[${tab.name}] Response ${tab.registerCount} regs | ${tab.registerCount * 2} bytes`,
      rawData: toHexString(rxBytes),
    };

    dispatch({
      type: 'ADD_LOG',
      payload: { connectionId: connection.id, log: rxLog },
    });
  }, 50);
}

function DataDisplayArea({ tab }: { tab: RegisterTab }) {
  const { t } = useI18n();
  const { state } = useAppState();
  const data = state.registerData[tab.id] ?? [];
  const regsPerValue = getRegistersPerValue(tab.displayFormat);
  const conn = state.connections.find(c => c.id === tab.connectionId);

  if (data.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
        <span>{t('noData')}</span>
        {conn && (
          <span className="text-[10px] text-muted-foreground/60">
            {conn.name} | {conn.protocol.toUpperCase()}/{conn.mode.toUpperCase()} | Slave:{conn.slaveId}
          </span>
        )}
      </div>
    );
  }

  const displayRows = data.length / regsPerValue;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Info bar */}
      <div className="flex items-center gap-3 px-3 py-1 border-b border-border/50 bg-muted/10 text-[10px] text-muted-foreground shrink-0">
        {conn && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              state.connectionStatus[conn.id] === 'connected' ? 'bg-green-500' : 'bg-zinc-600'
            }`} />
            {conn.name}
          </span>
        )}
        <span>Addr: {tab.startAddress} ~ {tab.startAddress + tab.registerCount - 1}</span>
        <span>FC{tab.functionCode}</span>
        <span>{getFormatLabel(tab.displayFormat, t)}</span>
        {regsPerValue > 1 && (
          <span className="text-cyan-400/70">32:{tab.byteOrder32} / 64:{tab.byteOrder64}</span>
        )}
        <span className="ml-auto">{Math.floor(displayRows)} values</span>
        {tab.isPolling && (
          <span className="text-green-400 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
            {tab.pollInterval}ms
          </span>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {tab.displayFormat === 'led' ? (
            <LedDisplay data={data} />
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-1 px-2 w-12">#</th>
                  <th className="text-left py-1 px-2 w-16">{t('address')}</th>
                  <th className="text-left py-1 px-2 w-20">{t('raw')}</th>
                  <th className="text-left py-1 px-2">{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((reg, idx) => {
                  const isGroupStart = idx % regsPerValue === 0;
                  const groupIndex = Math.floor(idx / regsPerValue);
                  const displayValue = isGroupStart
                    ? formatRegisterValue(data, idx, tab.displayFormat, tab.byteOrder32, tab.byteOrder64)
                    : '';

                  return (
                    <tr
                      key={reg.address}
                      className={`border-b border-border/20 hover:bg-muted/30 transition-colors ${
                        isGroupStart && regsPerValue > 1 ? 'bg-muted/5' : ''
                      }`}
                    >
                      <td className="py-0.5 px-2 text-muted-foreground/50 text-[10px]">
                        {isGroupStart && regsPerValue > 1 ? groupIndex + 1 : ''}
                      </td>
                      <td className="py-0.5 px-2 text-cyan-400">
                        {reg.address.toString().padStart(5, '0')}
                      </td>
                      <td className="py-0.5 px-2 text-amber-400">
                        {reg.rawValue.toString(16).toUpperCase().padStart(4, '0')}
                      </td>
                      <td className={`py-0.5 px-2 ${
                        tab.displayFormat === 'float' || tab.displayFormat === 'double'
                          ? 'text-cyan-300'
                          : 'text-green-400'
                      }`}>
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
    </div>
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

// Polling effect - each tab independently polls its register range
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

    // Start intervals for newly polling tabs - each tab makes independent requests
    for (const tab of currentPolling) {
      if (!intervalsRef.current[tab.id]) {
        const conn = state.connections.find(c => c.id === tab.connectionId);
        // Only poll if connection exists and is connected
        if (conn && state.connectionStatus[conn.id] === 'connected') {
          intervalsRef.current[tab.id] = setInterval(() => {
            // Re-check connection status each poll tick
            const currentConn = state.connections.find(c => c.id === tab.connectionId);
            if (currentConn && state.connectionStatus[currentConn.id] === 'connected') {
              simulateRead(tab, currentConn, dispatch);
            }
          }, tab.pollInterval);
        }
      }
    }

    // Cleanup on unmount
  }, [state.tabs, state.connections, state.connectionStatus, dispatch]);

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
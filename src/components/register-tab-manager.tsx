'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState, type Action } from '@/hooks/use-app-state';
import { useModbusWs } from '@/hooks/use-modbus-ws';
import type { RegisterTab, RegisterData, FunctionCode, DataDisplayFormat, ByteOrder32, ByteOrder64, LogEntry, ConnectionConfig } from '@/lib/modbus-types';
import { generateId, formatRegisterValue, getBitsPerValue, buildRTUFrame, toHexString } from '@/lib/modbus-utils';
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
      bitCount: 160,
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
                    {conn?.name ? `${conn.name}:` : ''}{tab.startAddress}~{tab.startAddress + (['01', '02', '05', '15'].includes(tab.functionCode) ? tab.bitCount - 1 : Math.floor(tab.bitCount / 16) - 1)}
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-xs shrink-0"
              onClick={handleAddTab}
            >
              +
            </Button>
          </div>
        </ScrollArea>
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
  const { readRegisters, writeRegisters } = useModbusWs();
  const isBitFC = ['01', '02', '05', '15'].includes(tab.functionCode);
  const isWriteFC = ['05', '06', '15', '16'].includes(tab.functionCode);
  const maxCount = isBitFC ? 2000 : 125;

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
            className="h-9 text-xs bg-background border-border"
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
            <SelectTrigger className="h-9 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.connections.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* 32-bit byte order dropdown */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground font-medium">{t('byteOrder')} (32-bit)</label>
          <Select value={tab.byteOrder32} onValueChange={v => updateTab({ byteOrder32: v as ByteOrder32 })}>
            <SelectTrigger className="h-9 text-xs bg-background border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ABCD" className="font-mono text-xs">ABCD ({t('bigEndian')})</SelectItem>
              <SelectItem value="DCBA" className="font-mono text-xs">DCBA ({t('littleEndian')})</SelectItem>
              <SelectItem value="BADC" className="font-mono text-xs">BADC ({t('bigEndianSwap')})</SelectItem>
              <SelectItem value="CDAB" className="font-mono text-xs">CDAB ({t('littleEndianSwap')})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* 64-bit byte order dropdown */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground font-medium">{t('byteOrder')} (64-bit)</label>
          <Select value={tab.byteOrder64} onValueChange={v => updateTab({ byteOrder64: v as ByteOrder64 })}>
            <SelectTrigger className="h-9 text-xs bg-background border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ABCDEFGH" className="font-mono text-xs">ABCDEFGH ({t('bigEndian')})</SelectItem>
              <SelectItem value="HGFEDCBA" className="font-mono text-xs">HGFEDCBA ({t('littleEndian')})</SelectItem>
              <SelectItem value="BADCFEHG" className="font-mono text-xs">BADCFEHG ({t('bigEndianSwap')})</SelectItem>
              <SelectItem value="GHEFCDAB" className="font-mono text-xs">GHEFCDAB ({t('littleEndianSwap')})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1 col-span-2">
          <label className="text-[10px] text-muted-foreground">{t('functionCode')}</label>
          <ToggleGroup type="single" value={tab.functionCode} onValueChange={v => v && updateTab({ functionCode: v as FunctionCode })} className="justify-start flex-wrap gap-0.5">
            {(['01', '02', '03', '04', '05', '06', '15', '16'] as const).map(fc => {
              const fcKey = `fc${fc}` as const;
              return (
                <ToggleGroupItem key={fc} value={fc} size="sm" className="h-9 text-[10px] px-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-400 data-[state=on]:border-blue-500/30 border border-border/50 group" title={t(fcKey)}>
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
          <label className="text-[10px] text-muted-foreground">{t('startAddress')}</label>
          <Input
            type="number"
            className="h-9 text-xs bg-background border-border"
            value={tab.startAddress}
            min={0}
            max={65535}
            onChange={e => updateTab({ startAddress: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t(isBitFC ? 'coilCount' : 'registerCount')}</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="flex-1 h-9 text-xs bg-background border-border"
              value={isBitFC ? tab.bitCount : Math.floor(tab.bitCount / 16)}
              min={1}
              max={maxCount}
              onChange={e => {
                const val = Math.min(maxCount, Math.max(1, Number(e.target.value)));
                updateTab({ bitCount: isBitFC ? val : Math.floor(val * 16) });
              }}
            />
            <span className="w-24 text-[9px] text-muted-foreground">
              {isBitFC
                ? `${t('registerCount')}: ${Math.floor(tab.bitCount / 16)}`
                : `位: ${tab.bitCount}`}
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1 col-span-2">
          <label className="text-[10px] text-muted-foreground">{t('displayFormat')}</label>
          <div className="flex flex-wrap gap-1">
            <ToggleGroup type="single" value={tab.displayFormat} onValueChange={v => v && updateTab({ displayFormat: v as DataDisplayFormat })} className="justify-start flex-wrap gap-0.5">
              <ToggleGroupItem value="led" title={t('formatLed')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-cyan-500/20 data-[state=on]:text-cyan-400 data-[state=on]:border-cyan-500/30 border border-border/50">
                Bit
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="binary" title={t('formatBinary')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Binary
              </ToggleGroupItem>
              <ToggleGroupItem value="short" title={t('formatShort')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Short
              </ToggleGroupItem>
              <ToggleGroupItem value="ushort" title={t('formatUShort')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                UShort
              </ToggleGroupItem>
              <ToggleGroupItem value="hex" title={t('formatHex')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 border border-border/50">
                Hex
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="long" title={t('formatLong')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                Long
              </ToggleGroupItem>
              <ToggleGroupItem value="ulong" title={t('formatULong')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                ULong
              </ToggleGroupItem>
              <ToggleGroupItem value="float" title={t('formatFloat')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-400 data-[state=on]:border-amber-500/30 border border-border/50">
                Float
              </ToggleGroupItem>
              <span className="text-[8px] text-muted-foreground/40 mx-0.5 self-center">|</span>
              <ToggleGroupItem value="double" title={t('formatDouble')} size="sm" className="h-7 text-[10px] px-1.5 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-400 data-[state=on]:border-purple-500/30 border border-border/50">
                Double
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t('pollInterval')}</label>
          <Input
            type="number"
            className="h-9 text-xs bg-background border-border"
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
          className="h-9 text-xs"
          onClick={() => updateTab({ isPolling: !tab.isPolling })}
        >
          {tab.isPolling ? t('stopPolling') : t('startPolling')}
        </Button>
        <Button
            size="sm"
            variant="outline"
            className="h-9 text-xs"
            onClick={() => {
              if (connection) {
                readRegisters(
                  connection.id,
                  tab.id,
                  connection.slaveId,
                  parseInt(tab.functionCode),
                  tab.startAddress,
                  isBitFC ? Math.floor(tab.bitCount / 16) : tab.bitCount,
                  connection.mode,
                );
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

function DataDisplayArea({ tab }: { tab: RegisterTab }) {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const { readRegisters, writeRegisters } = useModbusWs();
  const data = state.registerData[tab.id] ?? [];
  const bitsPerValue = getBitsPerValue(tab.displayFormat);
  const regsPerValue = tab.displayFormat === 'led' ? 1 : bitsPerValue / 16;
  const conn = state.connections.find(c => c.id === tab.connectionId);
  const isWriteFC = ['05', '06', '15', '16'].includes(tab.functionCode);
  const isBitFC = ['01', '02', '05', '15'].includes(tab.functionCode);
  const [editingValues, setEditingValues] = useState<Record<number, string>>({});
  const dataCount = Math.ceil(tab.bitCount / 16);

  const handleWrite = useCallback(async () => {
    if (!conn) return;
    const entries = Object.entries(editingValues);
    if (entries.length === 0) return;
    const values: number[] = [];
    for (let i = 0; i < dataCount; i++) {
      const addr = tab.startAddress + i;
      const val = editingValues[addr];
      if (val !== undefined) {
        values.push(parseInt(val, 10) || 0);
      } else {
        values.push(0);
      }
    }
    writeRegisters(conn.id, tab.id, conn.slaveId, parseInt(tab.functionCode), tab.startAddress, values, conn.mode);
    // Update register data in state
    const updatedData = values.map((v, i) => ({
      address: tab.startAddress + i,
      rawValue: v,
    }));
    dispatch({ type: 'SET_REGISTER_DATA', payload: { tabId: tab.id, data: updatedData } });
    setEditingValues({});
  }, [conn, data, editingValues, tab, writeRegisters, dispatch, dataCount]);

  const setValue = useCallback((addr: number, val: string) => {
    setEditingValues(prev => ({ ...prev, [addr]: val }));
  }, []);

  // If no data, generate placeholder data based on tab config
  const displayData = data.length > 0
    ? data
    : Array.from({ length: dataCount }, (_, i) => ({
        address: tab.startAddress + i,
        rawValue: 0,
      }));

  const values = Math.floor(tab.bitCount / bitsPerValue);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Info bar */}
      <div className="flex h-7 items-center gap-3 px-3 py-1 border-b border-border/50 bg-muted/10 text-[10px] text-muted-foreground shrink-0">
        {conn && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              state.connectionStatus[conn.id] === 'connected' ? 'bg-green-500' : 'bg-zinc-600'
            }`} />
            {conn.name}
          </span>
        )}
        <span>Addr: {tab.startAddress} ~ {tab.startAddress + dataCount - 1}</span>
        <span>FC{tab.functionCode}</span>
        <span>{getFormatLabel(tab.displayFormat, t)}</span>
        <span className="ml-auto">{values} values</span>
        {isWriteFC && Object.keys(editingValues).length > 0 && (
          <button
            onClick={handleWrite}
            className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-colors"
          >
            {t('write')} ({Object.keys(editingValues).length})
          </button>
        )}
        {tab.isPolling && (
          <span className="text-green-400 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
            {tab.pollInterval}ms
          </span>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted-foreground border-b border-border sticky top-0 bg-[#0a0e14] z-10">
                    <th className="text-left py-1 px-2 w-12">#</th>
                    <th className="text-left py-1 px-2 w-12">{t('offset')}</th>
                    <th className="text-left py-1 px-2 w-20">{t('address')}</th>
                    <th className="text-left py-1 px-2 w-20">{t('raw')}</th>
                    <th className="text-left py-1 px-2">{t('value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayData.map((reg, idx) => {
                  const isGroupStart = idx % regsPerValue === 0;
                  const groupIndex = Math.floor(idx / regsPerValue);
                  const displayValue = isGroupStart
                    ? formatRegisterValue(displayData, idx, tab.displayFormat, tab.byteOrder32, tab.byteOrder64)
                    : '';

                  return (
                    <tr
                      key={reg.address}
                      className={`border-b border-border/20 hover:bg-muted/30 transition-colors ${
                        isGroupStart && regsPerValue > 1 ? 'bg-muted/5' : ''
                      }`}
                    >
                      <td className="py-0.5 px-2 text-muted-foreground/50 text-[10px]">
                        {isGroupStart ? groupIndex + 1 : ''}
                      </td>
                      <td className="py-0.5 px-2 text-muted-foreground/40 text-[10px]">
                        {idx}
                      </td>
                      <td className="py-0.5 px-2 text-cyan-400 font-mono">
                        0x{reg.address.toString(16).toUpperCase().padStart(4, '0')}
                      </td>
                      <td className="py-0.5 px-2 text-amber-400">
                        0x{reg.rawValue.toString(16).toUpperCase().padStart(4, '0')}
                      </td>
                      <td className="py-0.5 px-2">
                        {tab.displayFormat === 'led' ? (
                          <div className="flex gap-0.5 items-center h-7 flex-nowrap">
                            {Array.from({ length: 16 }, (_, i) => {
                              const bit = isWriteFC
                                ? ((parseInt(editingValues[reg.address] ?? '0', 10) || 0) >> (15 - i)) & 1
                                : (reg.rawValue >> (15 - i)) & 1;
                              return (
                                <div
                                  key={i}
                                  onClick={() => {
                                    if (!isWriteFC) return;
                                    const currentVal = parseInt(editingValues[reg.address] ?? '0', 10) || reg.rawValue;
                                    const newVal = currentVal ^ (1 << (15 - i));
                                    setValue(reg.address, newVal.toString());
                                  }}
                                  className={`w-2.5 h-2.5 rounded-sm border ${
                                    bit
                                      ? 'bg-green-500 border-green-400 shadow-[0_0_2px_rgba(34,197,94,0.6)]'
                                      : 'bg-zinc-800 border-zinc-700'
                                  } ${isWriteFC ? 'cursor-pointer hover:ring-1 hover:ring-amber-500' : ''} ${i % 4 === 3 ? 'mr-1' : ''}`}
                                  title={`Bit ${15 - i}: ${bit}${isWriteFC ? ' (click to toggle)' : ''}`}
                                />
                              );
                            })}
                          </div>
                        ) : isWriteFC && isGroupStart ? (
                          <input
                            type="text"
                            value={editingValues[reg.address] ?? displayValue}
                            onChange={e => setValue(reg.address, e.target.value)}
                            className="w-full bg-transparent border border-amber-500/30 rounded px-1 text-green-400 h-7 focus:outline-none focus:border-amber-500"
                          />
                        ) : (
                          <span className={`inline-flex items-center h-7 ${tab.displayFormat === 'float' || tab.displayFormat === 'double' ? 'text-cyan-300' : 'text-green-400'}`}>
                            {displayValue || '\u00A0'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ScrollArea>
    </div>
  );
}

// Polling effect - each tab independently polls its register range
export function usePolling() {
  const { state, dispatch } = useAppState();
  const { readRegisters } = useModbusWs();
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
            const isBitFC = ['01', '02', '05', '15'].includes(tab.functionCode);
            readRegisters(
              conn.id,
              tab.id,
              conn.slaveId,
              parseInt(tab.functionCode),
              tab.startAddress,
              isBitFC ? Math.floor(tab.bitCount / 16) : tab.bitCount,
              conn.mode,
            );
          }, tab.pollInterval);
        }
      }
    }

    // Cleanup on unmount
  }, [state.tabs, state.connections, state.connectionStatus, dispatch, readRegisters]);

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
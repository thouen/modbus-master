'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ConnectionPanel } from '@/components/modbus/ConnectionPanel';
import { DataPanel } from '@/components/modbus/DataPanel';
import { LogPanel } from '@/components/modbus/LogPanel';
import { StatusBar } from '@/components/modbus/StatusBar';
import type { ConnectionConfig, ConnectionStatus, LogEntry, ReadResult, ByteOrder } from '@/types/modbus';

let resultIdCounter = 0;
function nextResultId(): string {
  resultIdCounter += 1;
  return `${Date.now()}-${resultIdCounter}`;
}

export default function ModbusMasterPage() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    config: null,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [lastReadTime, setLastReadTime] = useState<number | null>(null);
  
  // Global settings
  const [defaultByteOrder, setDefaultByteOrder] = useState<ByteOrder>('LE');
  const [defaultSigned, setDefaultSigned] = useState(true);

  // Load settings from localStorage
  useEffect(() => {
    const savedByteOrder = localStorage.getItem('modbus-byte-order');
    if (savedByteOrder) setDefaultByteOrder(savedByteOrder as ByteOrder);
    const savedSigned = localStorage.getItem('modbus-signed');
    if (savedSigned !== null) setDefaultSigned(savedSigned === 'true');
  }, []);

  const handleSettingsChange = useCallback((byteOrder: ByteOrder, signed: boolean) => {
    setDefaultByteOrder(byteOrder);
    setDefaultSigned(signed);
    localStorage.setItem('modbus-byte-order', byteOrder);
    localStorage.setItem('modbus-signed', signed.toString());
  }, []);

  // Check initial connection status
  useEffect(() => {
    fetch('/api/modbus/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setConnectionStatus(data.data);
        }
      })
      .catch(() => {
        // ignore
      });

    // Load initial logs
    fetch('/api/modbus/logs?limit=50')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setLogs(data.data.logs);
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  const addLog = useCallback((log: LogEntry) => {
    setLogs((prev) => [log, ...prev].slice(0, 500));
  }, []);

  const handleConnect = useCallback(
    async (config: ConnectionConfig): Promise<boolean> => {
      try {
        const res = await fetch('/api/modbus/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        const data = await res.json();
        if (data.success) {
          setConnectionStatus({ connected: true, config });
          addLog(data.data);
        } else {
          addLog(data.data || { type: 'error', message: data.error, success: false, timestamp: Date.now(), id: nextResultId() });
        }
        return data.success;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Connection failed';
        addLog({
          type: 'error',
          message: errMsg,
          success: false,
          timestamp: Date.now(),
          id: nextResultId(),
        });
        return false;
      }
    },
    [addLog]
  );

  const handleDisconnect = useCallback(async () => {
    try {
      const res = await fetch('/api/modbus/disconnect', { method: 'POST' });
      const data = await res.json();
      setConnectionStatus({ connected: false, config: null });
      if (data.success) {
        addLog(data.data);
      }
    } catch {
      setConnectionStatus({ connected: false, config: null });
    }
  }, [addLog]);

  const handleRead = useCallback(
    async (functionCode: number, address: number, quantity: number) => {
      try {
        const res = await fetch('/api/modbus/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ functionCode, address, quantity }),
        });
        const data = await res.json();
        if (data.success) {
          setLastReadTime(Date.now());
          addLog(data.data.log);
          return {
            id: nextResultId(),
            timestamp: Date.now(),
            functionCode,
            address,
            quantity,
            values: data.data.values,
            name: `FC${functionCode}`,
            startAddr: address,
            data: data.data.values,
          } as ReadResult;
        } else {
          if (data.log) addLog(data.log);
        }
        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Read failed';
        addLog({
          type: 'error',
          message: errMsg,
          success: false,
          timestamp: Date.now(),
          id: nextResultId(),
        });
        return null;
      }
    },
    [addLog]
  );

  const handleWrite = useCallback(
    async (functionCode: number, address: number, values: number[] | boolean[]) => {
      try {
        const res = await fetch('/api/modbus/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ functionCode, address, values }),
        });
        const data = await res.json();
        if (data.success) {
          addLog(data.data);
        } else {
          if (data.log) addLog(data.log);
        }
        return data.success;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Write failed';
        addLog({
          type: 'error',
          message: errMsg,
          success: false,
          timestamp: Date.now(),
          id: nextResultId(),
        });
        return false;
      }
    },
    [addLog]
  );

  const handleClearLogs = useCallback(async () => {
    await fetch('/api/modbus/logs', { method: 'DELETE' });
    setLogs([]);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="18" rx="2" />
                <path d="M8 7h8M8 11h8M8 15h4" />
                <circle cx="18" cy="15" r="1.5" fill="currentColor" />
              </svg>
              <h1 className="text-lg font-semibold tracking-tight">MODBUS MASTER</h1>
            </div>
          </div>
          <StatusBar
            isConnected={connectionStatus.connected}
            isConnecting={false}
            connectionConfig={connectionStatus.config}
            isPolling={isPolling}
            pollInterval={0}
            lastReadTime={lastReadTime}
            defaultByteOrder={defaultByteOrder}
            defaultSigned={defaultSigned}
            onSettingsChange={handleSettingsChange}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-4">
        {/* Two Column Layout: Left (Connection + Log), Right (Data Panel) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Left Column - Connection + Log */}
          <div className="xl:col-span-4 space-y-4">
            <ConnectionPanel
              connected={connectionStatus.connected}
              config={connectionStatus.config}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
            <LogPanel logs={logs} onClear={handleClearLogs} />
          </div>

          {/* Right Column - Data Panel with Tabs */}
          <div className="xl:col-span-8">
            <DataPanel onRead={handleRead} onWrite={handleWrite} />
          </div>
        </div>
      </main>
    </div>
  );
}

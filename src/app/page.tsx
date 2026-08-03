'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ConnectionManager } from '@/components/modbus/ConnectionManager';
import { ConnectionStatusPanel } from '@/components/modbus/ConnectionStatusPanel';
import { DataPanel } from '@/components/modbus/DataPanel';
import { LogPanel } from '@/components/modbus/LogPanel';
import StatusBar from '@/components/modbus/StatusBar';
import type { ConnectionConfig, ConnectionStatus, LogEntry, ReadResult, ByteOrder, SavedConnection } from '@/types/modbus';

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
  const [connectionTimes, setConnectionTimes] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [lastReadTime, setLastReadTime] = useState<number | null>(null);
  
  // Global settings
  const [defaultByteOrder, setDefaultByteOrder] = useState<ByteOrder>('LE');
  const [defaultSigned, setDefaultSigned] = useState(true);

  // Connection management
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string>('');
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  // Load settings and connections from localStorage
  useEffect(() => {
    const savedByteOrder = localStorage.getItem('modbus-byte-order');
    if (savedByteOrder) setDefaultByteOrder(savedByteOrder as ByteOrder);
    const savedSigned = localStorage.getItem('modbus-signed');
    if (savedSigned !== null) setDefaultSigned(savedSigned === 'true');

    // Load saved connections
    const savedConnections = localStorage.getItem('modbus-connections');
    if (savedConnections) {
      try {
        const parsed = JSON.parse(savedConnections);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConnections(parsed);
          const savedActiveId = localStorage.getItem('modbus-active-connection');
          if (savedActiveId && parsed.find((c: SavedConnection) => c.id === savedActiveId)) {
            setActiveConnectionId(savedActiveId);
          } else {
            setActiveConnectionId(parsed[0].id);
          }
        } else {
          // Create default connection
          const defaultConn: SavedConnection = {
            id: 'default',
            name: 'default',
            protocol: 'tcp',
            host: '127.0.0.1',
            port: 502,
            unitId: 1,
            timeout: 5000,
          };
          setConnections([defaultConn]);
          setActiveConnectionId('default');
          localStorage.setItem('modbus-connections', JSON.stringify([defaultConn]));
          localStorage.setItem('modbus-active-connection', 'default');
        }
      } catch {
        // Create default connection on parse error
        const defaultConn: SavedConnection = {
          id: 'default',
          name: 'default',
          protocol: 'tcp',
          host: '127.0.0.1',
          port: 502,
          unitId: 1,
          timeout: 5000,
        };
        setConnections([defaultConn]);
        setActiveConnectionId('default');
        localStorage.setItem('modbus-connections', JSON.stringify([defaultConn]));
        localStorage.setItem('modbus-active-connection', 'default');
      }
    } else {
      // Create default connection
      const defaultConn: SavedConnection = {
        id: 'default',
        name: 'default',
        protocol: 'tcp',
        host: '127.0.0.1',
        port: 502,
        unitId: 1,
        timeout: 5000,
      };
      setConnections([defaultConn]);
      setActiveConnectionId('default');
      localStorage.setItem('modbus-connections', JSON.stringify([defaultConn]));
      localStorage.setItem('modbus-active-connection', 'default');
    }
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
    async (id: string) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return;
      try {
        const res = await fetch('/api/modbus/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(conn),
        });
        const data = await res.json();
        if (data.success) {
          setConnectionStatus({ connected: true, config: conn });
          setConnectedIds((prev) => new Set(prev).add(id));
          setConnectionTimes((prev) => ({ ...prev, [id]: Date.now() }));
          addLog(data.data);
        } else {
          addLog(data.data || { type: 'error', message: data.error, success: false, timestamp: Date.now(), id: nextResultId() });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Connection failed';
        addLog({
          type: 'error',
          message: errMsg,
          success: false,
          timestamp: Date.now(),
          id: nextResultId(),
        });
      }
    },
    [addLog, connections]
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      try {
        const res = await fetch('/api/modbus/disconnect', { method: 'POST' });
        const data = await res.json();
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setConnectionTimes((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (id === activeConnectionId) {
          setConnectionStatus({ connected: false, config: null });
        }
        if (data.success) {
          addLog(data.data);
        }
      } catch {
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setConnectionTimes((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (id === activeConnectionId) {
          setConnectionStatus({ connected: false, config: null });
        }
      }
    },
    [addLog, activeConnectionId]
  );

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
          // Log error even if no log object is returned
          if (data.log) {
            addLog(data.log);
          } else if (data.error) {
            addLog({
              id: Date.now().toString(),
              timestamp: Date.now(),
              type: 'error',
              functionCode,
              address,
              quantity,
              message: data.error,
              success: false,
            });
          }
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
          // Log error even if no log object is returned
          if (data.log) {
            addLog(data.log);
          } else if (data.error) {
            addLog({
              id: Date.now().toString(),
              timestamp: Date.now(),
              type: 'error',
              functionCode,
              address,
              quantity: values.length,
              message: data.error,
              success: false,
            });
          }
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

  // Connection Management
  const handleSelectConnection = useCallback((id: string) => {
    setActiveConnectionId(id);
  }, []);

  const handleAddConnection = useCallback((connection: SavedConnection) => {
    setConnections((prev) => {
      const next = [...prev, connection];
      localStorage.setItem('modbus-connections', JSON.stringify(next));
      return next;
    });
    setActiveConnectionId(connection.id);
  }, []);

  const handleUpdateConnection = useCallback((id: string, config: Partial<Omit<SavedConnection, 'id'>>) => {
    setConnections((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...config } : c));
      localStorage.setItem('modbus-connections', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDeleteConnection = useCallback((id: string) => {
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== id);
      localStorage.setItem('modbus-connections', JSON.stringify(next));
      return next;
    });
    if (activeConnectionId === id) {
      const remaining = connections.filter((c) => c.id !== id);
      setActiveConnectionId(remaining[0]?.id || '');
    }
  }, [activeConnectionId, connections]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50">
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
        </div>
      </header>

      {/* StatusBar - Moved outside header to fix modal positioning */}
      <div className="fixed top-3 right-4 z-40">
        <StatusBar
          onSettingsChange={handleSettingsChange}
        />
      </div>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-4">
        {/* Three Column Layout: Left (Connection Manager), Middle (Data Panel), Right (Log Panel) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Left Column - Connection Manager */}
          <div className="xl:col-span-2">
            <ConnectionManager
              connections={connections}
              activeConnectionId={activeConnectionId}
              connectedIds={connectedIds}
              onSelectConnection={handleSelectConnection}
              onAddConnection={handleAddConnection}
              onUpdateConnection={handleUpdateConnection}
              onRemoveConnection={handleDeleteConnection}
            />
          </div>

          {/* Middle Column - Data Panel with Tabs */}
          <div className="xl:col-span-7">
            <DataPanel onRead={handleRead} onWrite={handleWrite} />
          </div>

          {/* Right Column - Connection Status + Log Panel */}
          <div className="xl:col-span-3">
            <ConnectionStatusPanel
              activeConnection={connections.find(c => c.id === activeConnectionId) || null}
              isConnected={connectedIds.has(activeConnectionId)}
              connectionTime={activeConnectionId ? connectionTimes[activeConnectionId] : undefined}
              onConnect={() => handleConnect(activeConnectionId)}
              onDisconnect={() => handleDisconnect(activeConnectionId)}
            />
            <LogPanel 
              logs={logs} 
              onClear={handleClearLogs}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

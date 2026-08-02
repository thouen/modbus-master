'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedConnection, ConnectionConfig } from '@/types/modbus';

interface ConnectionManagerProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  onSelectConnection: (id: string) => void;
  onAddConnection: (connection: SavedConnection) => void;
  onRemoveConnection: (id: string) => void;
  onUpdateConnection: (id: string, config: ConnectionConfig) => void;
}

const STORAGE_KEY = 'modbus-connections';

function loadConnections(): SavedConnection[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveConnections(connections: SavedConnection[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    // ignore
  }
}

export function ConnectionManager({
  connections,
  activeConnectionId,
  onSelectConnection,
  onAddConnection,
  onRemoveConnection,
  onUpdateConnection,
}: ConnectionManagerProps) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newHost, setNewHost] = useState('127.0.0.1');
  const [newPort, setNewPort] = useState('502');
  const [newUnitId, setNewUnitId] = useState('1');
  const [newTimeout, setNewTimeout] = useState('5000');
  const [newProtocol, setNewProtocol] = useState<'tcp' | 'udp' | 'rtu_tcp'>('tcp');

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    const connection: SavedConnection = {
      id: `conn-${Date.now()}`,
      name: newName.trim(),
      host: newHost,
      port: parseInt(newPort) || 502,
      unitId: parseInt(newUnitId) || 1,
      timeout: parseInt(newTimeout) || 5000,
      protocol: newProtocol,
    };
    onAddConnection(connection);
    setIsAdding(false);
    setNewName('');
  }, [newName, newHost, newPort, newUnitId, newTimeout, newProtocol, onAddConnection]);

  const handleUpdate = useCallback(
    (id: string) => {
      onUpdateConnection(id, {
        host: newHost,
        port: parseInt(newPort) || 502,
        unitId: parseInt(newUnitId) || 1,
        timeout: parseInt(newTimeout) || 5000,
        protocol: newProtocol,
      });
      setEditingId(null);
    },
    [newHost, newPort, newUnitId, newTimeout, newProtocol, onUpdateConnection]
  );

  const startEdit = useCallback((conn: SavedConnection) => {
    setEditingId(conn.id);
    setNewName(conn.name);
    setNewHost(conn.host);
    setNewPort(conn.port.toString());
    setNewUnitId(conn.unitId.toString());
    setNewTimeout((conn.timeout || 5000).toString());
    setNewProtocol(conn.protocol || 'tcp');
  }, []);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {t('connection.connections')}
        </h3>
        <button
          onClick={() => {
            setIsAdding(!isAdding);
            setEditingId(null);
          }}
          className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isAdding ? t('common.cancel') : t('common.add')}
        </button>
      </div>

      {isAdding && (
        <div className="mb-3 p-3 bg-background rounded border border-border space-y-2">
          <input
            type="text"
            placeholder={t('connection.name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Host"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <input
              type="text"
              placeholder="Port"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Unit ID"
              value={newUnitId}
              onChange={(e) => setNewUnitId(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <input
              type="text"
              placeholder="Timeout"
              value={newTimeout}
              onChange={(e) => setNewTimeout(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <select
              value={newProtocol}
              onChange={(e) => setNewProtocol(e.target.value as 'tcp' | 'udp' | 'rtu_tcp')}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="rtu_tcp">RTU/TCP</option>
            </select>
          </div>
          <button
            onClick={handleAdd}
            className="w-full px-2 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      )}

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {connections.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-4">
            {t('connection.noConnections')}
          </div>
        ) : (
          connections.map((conn) => (
            <div
              key={conn.id}
              className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors ${
                activeConnectionId === conn.id
                  ? 'bg-primary/20 border border-primary/50'
                  : 'bg-background hover:bg-accent border border-transparent'
              }`}
              onClick={() => onSelectConnection(conn.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{conn.name}</div>
                <div className="text-xs text-muted-foreground">
                  {conn.host}:{conn.port}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(conn);
                    setIsAdding(false);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={t('common.edit')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveConnection(conn.id);
                  }}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title={t('common.delete')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingId && (
        <div className="mt-3 p-3 bg-background rounded border border-border space-y-2">
          <div className="text-xs text-muted-foreground mb-1">{t('connection.editing')}</div>
          <input
            type="text"
            placeholder={t('connection.name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Host"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <input
              type="text"
              placeholder="Port"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Unit ID"
              value={newUnitId}
              onChange={(e) => setNewUnitId(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <input
              type="text"
              placeholder="Timeout"
              value={newTimeout}
              onChange={(e) => setNewTimeout(e.target.value)}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            />
            <select
              value={newProtocol}
              onChange={(e) => setNewProtocol(e.target.value as 'tcp' | 'udp' | 'rtu_tcp')}
              className="px-2 py-1 text-sm bg-input border border-border rounded text-foreground"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="rtu_tcp">RTU/TCP</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleUpdate(editingId)}
              className="flex-1 px-2 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t('common.save')}
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="flex-1 px-2 py-1 text-sm rounded bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { loadConnections, saveConnections };

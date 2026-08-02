'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SavedConnection } from '@/types/modbus';

const STORAGE_KEY = 'modbus-connections';
const ACTIVE_KEY = 'modbus-active-connection';

export function loadConnections(): SavedConnection[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return [
    {
      id: 'default',
      name: '本地连接',
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      timeout: 5000,
      protocol: 'tcp',
    },
  ];
}

export function loadActiveConnectionId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || 'default';
  } catch {
    return 'default';
  }
}

function saveConnections(connections: SavedConnection[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    // ignore
  }
}

interface ConnectionManagerProps {
  connections: SavedConnection[];
  activeConnectionId: string;
  connectedIds: Set<string>;
  onSelectConnection: (id: string) => void;
  onAddConnection: (connection: SavedConnection) => void;
  onRemoveConnection: (id: string) => void;
  onUpdateConnection: (id: string, config: Partial<SavedConnection>) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}

export function ConnectionManager({
  connections,
  activeConnectionId,
  connectedIds,
  onSelectConnection,
  onAddConnection,
  onRemoveConnection,
  onUpdateConnection,
  onConnect,
  onDisconnect,
}: ConnectionManagerProps) {
  const { t } = useTranslation();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('127.0.0.1');
  const [formPort, setFormPort] = useState('502');
  const [formUnitId, setFormUnitId] = useState('1');
  const [formTimeout, setFormTimeout] = useState('5000');
  const [formProtocol, setFormProtocol] = useState<'tcp' | 'udp' | 'rtu_tcp'>('tcp');

  // Persist connections
  useEffect(() => {
    saveConnections(connections);
  }, [connections]);

  const openAddModal = useCallback(() => {
    setModalMode('add');
    setEditId(null);
    setFormName('');
    setFormHost('127.0.0.1');
    setFormPort('502');
    setFormUnitId('1');
    setFormTimeout('5000');
    setFormProtocol('tcp');
  }, []);

  const openEditModal = useCallback(
    (id: string) => {
      const conn = connections.find((c) => c.id === id);
      if (conn) {
        setModalMode('edit');
        setEditId(id);
        setFormName(conn.name);
        setFormHost(conn.host);
        setFormPort(String(conn.port));
        setFormUnitId(String(conn.unitId));
        setFormTimeout(String(conn.timeout));
        setFormProtocol(conn.protocol || 'tcp');
      }
    },
    [connections]
  );

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!formName.trim()) return;
    if (modalMode === 'add') {
      const connection: SavedConnection = {
        id: `conn-${Date.now()}`,
        name: formName.trim(),
        host: formHost,
        port: parseInt(formPort) || 502,
        unitId: parseInt(formUnitId) || 1,
        timeout: parseInt(formTimeout) || 5000,
        protocol: formProtocol,
      };
      onAddConnection(connection);
    } else if (modalMode === 'edit' && editId) {
      onUpdateConnection(editId, {
        name: formName.trim(),
        host: formHost,
        port: parseInt(formPort) || 502,
        unitId: parseInt(formUnitId) || 1,
        timeout: parseInt(formTimeout) || 5000,
        protocol: formProtocol,
      });
    }
    closeModal();
  }, [modalMode, editId, formName, formHost, formPort, formUnitId, formTimeout, formProtocol, onAddConnection, onUpdateConnection, closeModal]);

  const handleDelete = useCallback(
    (id: string) => {
      onDisconnect(id);
      onRemoveConnection(id);
    },
    [onDisconnect, onRemoveConnection]
  );

  const handleConnect = useCallback(
    (id: string) => {
      if (connectedIds.has(id)) {
        onDisconnect(id);
      } else {
        onConnect(id);
      }
    },
    [connectedIds, onConnect, onDisconnect]
  );

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono uppercase tracking-wider text-foreground">
          {t('connection.title')}
        </h2>
        <button
          onClick={openAddModal}
          className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('common.add')}
        </button>
      </div>

      {/* Connection List */}
      <div className="space-y-1">
        {connections.map((conn) => {
          const isActive = conn.id === activeConnectionId;
          const isConnected = connectedIds.has(conn.id);
          return (
            <div
              key={conn.id}
              className={`p-2 rounded border transition-colors ${
                isActive
                  ? 'bg-primary/20 border-primary'
                  : 'bg-panel border-border hover:bg-accent'
              }`}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onSelectConnection(conn.id)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium text-foreground">
                    {conn.name}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {conn.host}:{conn.port}
                    {isConnected && (
                      <span className="ml-2 text-primary">
                        UID:{conn.unitId}
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleConnect(conn.id)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      isConnected
                        ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  >
                    {isConnected ? t('common.disconnect') : t('common.connect')}
                  </button>
                  <button
                    onClick={() => openEditModal(conn.id)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title={t('common.edit')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title={t('common.delete')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              {isConnected && (
                <div className="mt-1 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs text-primary">{t('connection.status.online')}</span>
                </div>
              )}
            </div>
          );
        })}
        {connections.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {t('connection.noConnections')}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalMode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-card border border-border rounded-lg p-6 min-w-[400px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-mono uppercase tracking-wider text-foreground mb-4">
              {modalMode === 'add' ? t('connection.addConnection') : t('connection.editConnection')}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.name')}
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.host')}
                </label>
                <input
                  type="text"
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.port')}
                </label>
                <input
                  type="text"
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.unitId')}
                </label>
                <input
                  type="text"
                  value={formUnitId}
                  onChange={(e) => setFormUnitId(e.target.value)}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.timeout')}
                </label>
                <input
                  type="text"
                  value={formTimeout}
                  onChange={(e) => setFormTimeout(e.target.value)}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.protocol')}
                </label>
                <select
                  value={formProtocol}
                  onChange={(e) => setFormProtocol(e.target.value as 'tcp' | 'udp' | 'rtu_tcp')}
                  className="w-full px-2 py-1 text-sm font-mono bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="rtu_tcp">RTU over TCP</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-1.5 text-xs rounded bg-panel hover:bg-accent transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

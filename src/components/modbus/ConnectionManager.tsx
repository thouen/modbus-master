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
      name: 'default',
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
    setFormName(t('connection.defaultName'));
    setFormHost('127.0.0.1');
    setFormPort('502');
    setFormUnitId('1');
    setFormTimeout('5000');
    setFormProtocol('tcp');
  }, [t]);

  const openEditModal = useCallback(
    (id: string) => {
      const conn = connections.find((c) => c.id === id);
      if (conn) {
        setModalMode('edit');
        setEditId(id);
        setFormName(conn.name === 'default' ? t('connection.defaultName') : conn.name);
        setFormHost(conn.host);
        setFormPort(String(conn.port));
        setFormUnitId(String(conn.unitId));
        setFormTimeout(String(conn.timeout));
        setFormProtocol(conn.protocol || 'tcp');
      }
    },
    [connections, t]
  );

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!formName.trim()) return;
    // If the name matches the translated default name, save as 'default'
    const savedName = formName.trim() === t('connection.defaultName') ? 'default' : formName.trim();
    if (modalMode === 'add') {
      const connection: SavedConnection = {
        id: `conn-${Date.now()}`,
        name: savedName,
        host: formHost,
        port: parseInt(formPort) || 502,
        unitId: parseInt(formUnitId) || 1,
        timeout: parseInt(formTimeout) || 5000,
        protocol: formProtocol,
      };
      onAddConnection(connection);
    } else if (modalMode === 'edit' && editId) {
      onUpdateConnection(editId, {
        name: savedName,
        host: formHost,
        port: parseInt(formPort) || 502,
        unitId: parseInt(formUnitId) || 1,
        timeout: parseInt(formTimeout) || 5000,
        protocol: formProtocol,
      });
    }
    closeModal();
  }, [modalMode, editId, formName, formHost, formPort, formUnitId, formTimeout, formProtocol, onAddConnection, onUpdateConnection, closeModal, t]);

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
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          {t('connection.connections')}
        </h2>
        <button
          onClick={openAddModal}
          className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
        >
          + {t('common.add')}
        </button>
      </div>

      {/* Connection List */}
      <div className="space-y-1.5">
        {connections.map((conn) => {
          const isActive = conn.id === activeConnectionId;
          const isConnected = connectedIds.has(conn.id);
          return (
            <div
              key={conn.id}
              className={`rounded-sm border transition-colors ${isActive
                  ? 'bg-primary/10 border-primary/60'
                  : 'bg-panel border-border hover:bg-accent/50'
                }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* Status indicator */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-primary shadow-[0_0_6px_rgba(0,212,170,0.5)]' : 'bg-muted-foreground/30'}`} />

                {/* Connection info */}
                <button
                  onClick={() => onSelectConnection(conn.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {conn.name === 'default' ? t('connection.defaultName') : conn.name}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-background/60 border border-border/50 text-muted-foreground uppercase">
                      {conn.protocol}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
                    <span>{conn.host}:{conn.port}</span>
                    <span className="text-foreground/40">|</span>
                    <span>UID:{conn.unitId}</span>
                  </div>
                </button>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleConnect(conn.id)}
                    className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors ${isConnected
                        ? 'bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30'
                        : 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                      }`}
                  >
                    {isConnected ? t('connection.disconnect') : t('connection.connect')}
                  </button>
                  <button
                    onClick={() => openEditModal(conn.id)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-accent"
                    title={t('connection.edit')}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-sm hover:bg-accent"
                    title={t('connection.delete')}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Connected status bar */}
              {isConnected && (
                <div className="px-3 py-1 border-t border-primary/20 bg-primary/5 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
                    {t('connection.status.online')}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {connections.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm font-mono">{t('connection.noConnections')}</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalMode && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-card border border-border rounded-sm shadow-2xl w-[460px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-border bg-panel">
              <h3 className="text-sm font-mono uppercase tracking-wider text-foreground flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary" />
                {modalMode === 'add' ? t('connection.addConnection') : t('connection.editConnection')}
              </h3>
            </div>

            {/* Modal Body */}
            <div className="px-5 py-4 space-y-3">
              {/* Name */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.name')}:
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Protocol */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.protocol')}:
                </label>
                <select
                  value={formProtocol}
                  onChange={(e) => setFormProtocol(e.target.value as 'tcp' | 'udp' | 'rtu_tcp')}
                  className="w-full px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="rtu_tcp">RTU over TCP</option>
                </select>
              </div>

              {/* Host + Port */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.host')}:
                </label>
                <div className="flex items-center gap-4 min-w-0">
                  <input
                    type="text"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground shrink-0">
                      {t('connection.port')}:
                    </label>
                    <input
                      type="text"
                      value={formPort}
                      onChange={(e) => setFormPort(e.target.value)}
                      className="w-[80px] px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Unit ID + Timeout */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-3">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {t('connection.unitId')}:
                </label>
                <div className="flex items-center gap-5 min-w-0">
                  <input
                    type="text"
                    value={formUnitId}
                    onChange={(e) => setFormUnitId(e.target.value)}
                    className="w-[80px] px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground shrink-0 w-[100px]">
                      {t('connection.timeout')}:
                    </label>
                    <input
                      type="text"
                      value={formTimeout}
                      onChange={(e) => setFormTimeout(e.target.value)}
                      className="w-[120px] px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-border bg-panel flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm bg-background border border-border hover:bg-accent transition-colors text-foreground"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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

'use client';

import { useTranslation } from 'react-i18next';
import type { SavedConnection, ConnectionStatus } from '@/types/modbus';

interface ConnectionStatusPanelProps {
  activeConnection: SavedConnection | null;
  isConnected: boolean;
  connectionTime?: number;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionStatusPanel({
  activeConnection,
  isConnected,
  connectionTime,
  onConnect,
  onDisconnect,
}: ConnectionStatusPanelProps) {
  const { t } = useTranslation();

  const formatConnectionTime = (time: number) => {
    const date = new Date(time);
    return date.toLocaleString();
  };

  const getProtocolName = (protocol?: string) => {
    switch (protocol) {
      case 'tcp': return 'Modbus TCP/IP';
      case 'udp': return 'Modbus UDP';
      case 'rtu-over-tcp': return 'RTU over TCP';
      default: return (protocol || 'TCP').toUpperCase();
    }
  };

  if (!activeConnection) {
    return (
      <div className="bg-panel border border-border rounded p-3 mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-muted-foreground"></div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {t('connection.noConnection')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-panel border border-border rounded p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-primary shadow-[0_0_8px_rgba(0,212,170,0.6)] animate-pulse' : 'bg-muted-foreground'}`}></div>
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {t('connection.connectionStatus')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={onDisconnect}
              className="px-3 py-1 text-xs rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors uppercase tracking-wider"
              title={t('connection.disconnect')}
            >
              {t('connection.disconnect')}
            </button>
          ) : (
            <button
              onClick={onConnect}
              className="px-3 py-1 text-xs rounded border border-primary/50 text-primary hover:bg-primary/10 transition-colors uppercase tracking-wider"
              title={t('connection.connect')}
            >
              {t('connection.connect')}
            </button>
          )}
        </div>
      </div>
      
      <div className="space-y-1 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('connection.name')}:</span>
          <span className="text-foreground">{activeConnection.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('connection.protocol')}:</span>
          <span className="text-foreground">{getProtocolName(activeConnection.protocol)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('connection.host')}:</span>
          <span className="text-foreground">{activeConnection.host}:{activeConnection.port}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('connection.unitId')}:</span>
          <span className="text-foreground">{activeConnection.unitId}</span>
        </div>
        {isConnected && connectionTime && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('log.connectedSince')}:</span>
            <span className="text-primary">{formatConnectionTime(connectionTime)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

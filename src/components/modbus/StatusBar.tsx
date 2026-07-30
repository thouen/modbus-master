'use client';

import type { ConnectionConfig } from '@/types/modbus';

interface StatusBarProps {
  connected: boolean;
  config: ConnectionConfig | null;
}

export function StatusBar({ connected, config }: StatusBarProps) {
  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      {config && (
        <>
          <span className="text-muted-foreground">
            <span className="text-foreground">{config.host}</span>
            <span className="text-muted-foreground">:{config.port}</span>
          </span>
          <span className="text-muted-foreground">
            UID: <span className="text-foreground">{config.unitId}</span>
          </span>
        </>
      )}
      <div className="flex items-center gap-2">
        <div className={`status-dot ${connected ? 'status-dot-connected animate-pulse-glow' : 'status-dot-disconnected'}`} />
        <span className={connected ? 'text-emerald-400' : 'text-muted-foreground'}>
          {connected ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
    </div>
  );
}

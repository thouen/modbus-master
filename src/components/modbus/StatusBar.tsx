'use client';

import type { ConnectionConfig, ModbusProtocol } from '@/types/modbus';

interface StatusBarProps {
  connected: boolean;
  config: ConnectionConfig | null;
}

const PROTOCOL_LABELS: Record<ModbusProtocol, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  rtu_tcp: 'RTU/TCP',
};

export function StatusBar({ connected, config }: StatusBarProps) {
  const protocol = config?.protocol || 'tcp';

  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      {config && (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 rounded-sm bg-secondary/50 border border-border/50">
              {PROTOCOL_LABELS[protocol]}
            </span>
            <span className="text-muted-foreground">
              <span className="text-foreground">{config.host}</span>
              <span className="text-muted-foreground">:{config.port}</span>
            </span>
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

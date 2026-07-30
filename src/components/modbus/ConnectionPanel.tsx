'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ConnectionConfig, ModbusProtocol } from '@/types/modbus';

interface ConnectionPanelProps {
  connected: boolean;
  config: ConnectionConfig | null;
  onConnect: (config: ConnectionConfig) => Promise<boolean>;
  onDisconnect: () => void;
}

const PROTOCOL_OPTIONS: { value: ModbusProtocol; label: string; desc: string }[] = [
  { value: 'tcp', label: 'Modbus TCP', desc: 'MBAP + TCP' },
  { value: 'udp', label: 'Modbus UDP', desc: 'MBAP + UDP' },
  { value: 'rtu_tcp', label: 'RTU over TCP', desc: 'CRC + TCP' },
];

export function ConnectionPanel({ connected, config, onConnect, onDisconnect }: ConnectionPanelProps) {
  const [host, setHost] = useState(config?.host || '127.0.0.1');
  const [port, setPort] = useState(String(config?.port || 502));
  const [unitId, setUnitId] = useState(String(config?.unitId || 1));
  const [timeout, setTimeout] = useState('5000');
  const [protocol, setProtocol] = useState<ModbusProtocol>(config?.protocol || 'tcp');
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect({
        host,
        port: parseInt(port, 10),
        unitId: parseInt(unitId, 10),
        timeout: parseInt(timeout, 10),
        protocol,
      });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="industrial-panel p-4">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <h2 className="industrial-header">Connection</h2>
      </div>

      <div className="space-y-4">
        {/* Protocol Selector */}
        <div>
          <label className="text-sm font-mono font-medium text-foreground/70 mb-2 block">PROTOCOL</label>
          <div className="grid grid-cols-2 gap-2">
            {PROTOCOL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={connected}
                onClick={() => setProtocol(opt.value)}
                className={`
                  px-3 py-2.5 text-xs font-mono uppercase tracking-wider rounded-sm border transition-all
                  ${protocol === opt.value
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-secondary/30 text-foreground/60 hover:border-primary/40 hover:text-foreground'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-[10px] opacity-60 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-mono font-medium text-foreground/70 mb-2 block">HOST / IP</label>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.100"
            disabled={connected}
            className="font-mono bg-secondary/50 border-border text-base"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-mono font-medium text-foreground/70 mb-2 block">PORT</label>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="502"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-base"
              type="number"
            />
          </div>
          <div>
            <label className="text-sm font-mono font-medium text-foreground/70 mb-2 block">UNIT ID</label>
            <Input
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              placeholder="1"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-base"
              type="number"
              min="1"
              max="247"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-mono font-medium text-foreground/70 mb-2 block">TIMEOUT (ms)</label>
          <Input
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
            placeholder="5000"
            disabled={connected}
            className="font-mono bg-secondary/50 border-border text-base"
            type="number"
          />
        </div>

        <div className="pt-2">
          {connected ? (
            <Button
              onClick={onDisconnect}
              variant="destructive"
              className="w-full font-mono text-sm font-medium uppercase tracking-wider"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M4.93 4.93l14.14 14.14" />
              </svg>
              Disconnect
            </Button>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={connecting || !host || !port}
              className="w-full font-mono text-sm font-medium uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

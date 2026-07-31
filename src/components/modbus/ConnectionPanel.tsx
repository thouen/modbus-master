'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ConnectionConfig, ModbusProtocol } from '@/types/modbus';

interface ConnectionPanelProps {
  connected: boolean;
  config: ConnectionConfig | null;
  onConnect: (config: ConnectionConfig) => Promise<boolean>;
  onDisconnect: () => void;
}

const PROTOCOL_OPTIONS: { value: ModbusProtocol; label: string }[] = [
  { value: 'tcp', label: 'Modbus TCP/IP' },
  { value: 'udp', label: 'Modbus UDP/IP' },
  { value: 'rtu_tcp', label: 'Modbus RTU over TCP/IP' },
];

export function ConnectionPanel({ connected, config, onConnect, onDisconnect }: ConnectionPanelProps) {
  const { t } = useTranslation();
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
        <h2 className="industrial-header">{t('connection.title')}</h2>
      </div>

      <div className="space-y-3">
        {/* Protocol Selector - Select Dropdown */}
        {/* Protocol */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-mono font-medium text-foreground/70 w-20 shrink-0">{t('connection.protocol')}</label>
          <select
            value={protocol}
            onChange={(e) => !connected && setProtocol(e.target.value as ModbusProtocol)}
            disabled={connected}
            className="flex-1 font-mono text-sm bg-secondary/50 border border-border rounded px-2 py-1.5 text-foreground/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            {PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* IP: Host : Port */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-mono font-medium text-foreground/70 w-20 shrink-0">{t('connection.ip')}</label>
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-sm flex-1 py-1.5"
            />
            <span className="text-sm font-mono text-foreground/50">:</span>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="502"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-sm w-20 py-1.5"
              type="number"
            />
          </div>
        </div>

        {/* Unit ID : Timeout */}
        <div className="grid grid-cols-2 gap-5">
          <div className="flex items-center gap-3">
            <label className="text-sm font-mono font-medium text-foreground/70 w-20 shrink-0">{t('connection.unitId')}</label>
            <Input
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              placeholder="1"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-sm flex-1 py-1.5"
              type="number"
              min="1"
              max="247"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-mono font-medium text-foreground/70 w-20 shrink-0">{t('connection.timeout')}</label>
            <Input
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              placeholder="5000"
              disabled={connected}
              className="font-mono bg-secondary/50 border-border text-sm flex-1 py-1.5"
              type="number"
            />
          </div>
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
              {t('connection.disconnect')}
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
              {connecting ? 'Connecting...' : t('connection.connect')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

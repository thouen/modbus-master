'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PollConfig } from '@/types/modbus';

interface ReadPanelProps {
  connected: boolean;
  isPolling: boolean;
  onRead: (functionCode: number, address: number, quantity: number) => Promise<unknown>;
  onStartPolling: (functionCode: number, address: number, quantity: number, interval: number) => void;
  onStopPolling: () => void;
  pollConfig: PollConfig | null;
}

const FUNCTION_CODES = [
  { value: '1', label: 'FC01 - Read Coils' },
  { value: '2', label: 'FC02 - Read Discrete Inputs' },
  { value: '3', label: 'FC03 - Read Holding Registers' },
  { value: '4', label: 'FC04 - Read Input Registers' },
];

export function ReadPanel({ connected, isPolling, onRead, onStartPolling, onStopPolling, pollConfig }: ReadPanelProps) {
  const [functionCode, setFunctionCode] = useState('3');
  const [address, setAddress] = useState('0');
  const [quantity, setQuantity] = useState('10');
  const [interval, setInterval] = useState('1000');
  const [reading, setReading] = useState(false);

  const handleRead = async () => {
    setReading(true);
    try {
      await onRead(parseInt(functionCode, 10), parseInt(address, 10), parseInt(quantity, 10));
    } finally {
      setReading(false);
    }
  };

  const handleTogglePolling = () => {
    if (isPolling) {
      onStopPolling();
    } else {
      onStartPolling(
        parseInt(functionCode, 10),
        parseInt(address, 10),
        parseInt(quantity, 10),
        parseInt(interval, 10)
      );
    }
  };

  return (
    <div className="industrial-panel p-4">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 11-6.219-8.56" />
          <path d="M21 3v6h-6" />
        </svg>
        <h2 className="industrial-header">Read Registers</h2>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1 block">FUNCTION CODE</label>
          <Select value={functionCode} onValueChange={setFunctionCode} disabled={!connected}>
            <SelectTrigger className="font-mono text-xs bg-secondary/50 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNCTION_CODES.map((fc) => (
                <SelectItem key={fc.value} value={fc.value} className="font-mono text-xs">
                  {fc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">START ADDR</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0"
              disabled={!connected}
              className="font-mono bg-secondary/50 border-border text-sm"
              type="number"
              min="0"
              max="65535"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">QUANTITY</label>
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="10"
              disabled={!connected}
              className="font-mono bg-secondary/50 border-border text-sm"
              type="number"
              min="1"
              max="125"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleRead}
            disabled={!connected || reading}
            className="flex-1 font-mono text-xs uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white"
          >
            {reading ? (
              <svg className="w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            ) : (
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
              </svg>
            )}
            Read
          </Button>
        </div>

        {/* Polling Section */}
        <div className="border-t border-border pt-3 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Auto Polling</span>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs font-mono text-muted-foreground mb-1 block">INTERVAL (ms)</label>
              <Input
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                placeholder="1000"
                disabled={!connected || isPolling}
                className="font-mono bg-secondary/50 border-border text-sm"
                type="number"
                min="100"
              />
            </div>
            <Button
              onClick={handleTogglePolling}
              disabled={!connected}
              variant={isPolling ? 'destructive' : 'secondary'}
              className={`font-mono text-xs uppercase tracking-wider ${
                isPolling ? '' : 'bg-amber-600 hover:bg-amber-700 text-white'
              }`}
            >
              {isPolling ? (
                <>
                  <svg className="w-3.5 h-3.5 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start
                </>
              )}
            </Button>
          </div>
          {isPolling && pollConfig && (
            <div className="mt-2 text-xs font-mono text-amber-400/80">
              Polling FC{pollConfig.functionCode.toString().padStart(2, '0')} @ {pollConfig.address} x{pollConfig.quantity} every {pollConfig.interval}ms
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

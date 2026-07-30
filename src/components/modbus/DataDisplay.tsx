'use client';

import { useState } from 'react';
import type { ReadResult, PollConfig } from '@/types/modbus';

interface DataDisplayProps {
  results: ReadResult[];
  isPolling: boolean;
  pollConfig: PollConfig | null;
}

type DisplayFormat = 'hex' | 'dec' | 'bin';

const FC_LABELS: Record<number, string> = {
  1: 'Coils',
  2: 'Discrete Inputs',
  3: 'Holding Registers',
  4: 'Input Registers',
};

const FORMAT_OPTIONS: { value: DisplayFormat; label: string }[] = [
  { value: 'hex', label: 'HEX' },
  { value: 'dec', label: 'DEC' },
  { value: 'bin', label: 'BIN' },
];

export function DataDisplay({ results, isPolling, pollConfig }: DataDisplayProps) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const latestResult = results[0];

  const formatValue = (val: number | boolean, isBool: boolean): string => {
    const numVal = isBool ? (val ? 1 : 0) : (val as number);
    if (displayFormat === 'hex') {
      return numVal.toString(16).toUpperCase().padStart(isBool ? 1 : 4, '0');
    } else if (displayFormat === 'bin') {
      return isBool ? (val ? '1' : '0') : numVal.toString(2).padStart(16, '0');
    }
    return String(numVal);
  };

  return (
    <div className="industrial-panel p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          <h2 className="industrial-header">Register Data</h2>
        </div>
        <div className="flex items-center gap-3">
          {isPolling && pollConfig && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-mono font-medium text-amber-400">POLLING</span>
            </div>
          )}
          {/* Format selector */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-sm p-0.5">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDisplayFormat(opt.value)}
                className={`
                  px-2.5 py-1 text-xs font-mono font-medium rounded-sm transition-all
                  ${displayFormat === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!latestResult ? (
        <div className="flex flex-col items-center justify-center py-16 text-foreground/50">
          <svg className="w-12 h-12 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          <p className="text-base font-mono">No data yet</p>
          <p className="text-sm font-mono mt-1 text-foreground/40">Connect and read registers to see data</p>
        </div>
      ) : (
        <div>
          {/* Result header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-3 text-sm font-mono">
              <span className="text-foreground/70">
                FC{latestResult.functionCode.toString().padStart(2, '0')} - {FC_LABELS[latestResult.functionCode] || 'Unknown'}
              </span>
              <span className="text-foreground/60">
                ADDR: <span className="text-foreground font-medium">{latestResult.address}</span>
              </span>
              <span className="text-foreground/60">
                QTY: <span className="text-foreground font-medium">{latestResult.quantity}</span>
              </span>
            </div>
            <span className="text-xs font-mono text-foreground/60">
              {new Date(latestResult.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Data grid - 8 rows x 8 columns, address left + value right */}
          <div className="border border-border rounded-sm overflow-hidden">
            <div className="overflow-auto max-h-[400px] scanline p-2">
              <div className="grid grid-cols-8 gap-1">
                {latestResult.values.map((val, idx) => {
                  const addr = latestResult.address + idx;
                  const isBool = typeof val === 'boolean';

                  return (
                    <div
                      key={idx}
                      className="group bg-secondary/30 border border-border rounded-sm px-2 py-1.5 hover:border-primary/50 hover:bg-secondary/60 transition-all data-cell-highlight flex items-center justify-between gap-1"
                    >
                      <div className="text-xs font-mono text-muted-foreground shrink-0">
                        {addr.toString().padStart(3, '0')}
                      </div>
                      <div className="text-sm font-mono font-medium text-primary truncate">
                        {formatValue(val, isBool)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="mt-3 flex items-center gap-4 text-xs font-mono text-muted-foreground px-1">
            <span>
              Total: <span className="text-foreground">{latestResult.values.length}</span> registers
            </span>
            {latestResult.values.some((v) => v !== 0 && v !== false) && (
              <span>
                Non-zero: <span className="text-primary">{latestResult.values.filter((v) => v !== 0 && v !== false).length}</span>
              </span>
            )}
            <span className="ml-auto">
              Format: <span className="text-foreground font-medium">{displayFormat.toUpperCase()}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

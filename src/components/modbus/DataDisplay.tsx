'use client';

import type { ReadResult, PollConfig } from '@/types/modbus';

interface DataDisplayProps {
  results: ReadResult[];
  isPolling: boolean;
  pollConfig: PollConfig | null;
}

const FC_LABELS: Record<number, string> = {
  1: 'Coils',
  2: 'Discrete Inputs',
  3: 'Holding Registers',
  4: 'Input Registers',
};

export function DataDisplay({ results, isPolling, pollConfig }: DataDisplayProps) {
  const latestResult = results[0];

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
        {isPolling && pollConfig && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-sm font-mono font-medium text-amber-400">POLLING</span>
          </div>
        )}
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
          <div className="flex items-center justify-between mb-3 px-2">
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
            <span className="text-sm font-mono text-foreground/60">
              {new Date(latestResult.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Data table */}
          <div className="border border-border rounded-sm overflow-hidden">
            <div className="overflow-auto max-h-[400px] scanline">
              <table className="w-full">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur-sm">
                  <tr>
                    <th className="text-left text-sm font-mono font-medium text-foreground/70 px-3 py-2 border-b border-border">
                      OFFSET
                    </th>
                    <th className="text-left text-sm font-mono font-medium text-foreground/70 px-3 py-2 border-b border-border">
                      ADDR
                    </th>
                    <th className="text-left text-sm font-mono font-medium text-foreground/70 px-3 py-2 border-b border-border">
                      HEX
                    </th>
                    <th className="text-left text-sm font-mono font-medium text-foreground/70 px-3 py-2 border-b border-border">
                      DEC
                    </th>
                    <th className="text-left text-sm font-mono font-medium text-foreground/70 px-3 py-2 border-b border-border">
                      BIN
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latestResult.values.map((val, idx) => {
                    const addr = latestResult.address + idx;
                    const isBool = typeof val === 'boolean';
                    const numVal = isBool ? (val ? 1 : 0) : (val as number);

                    return (
                      <tr
                        key={idx}
                        className="hover:bg-secondary/30 transition-colors data-cell-highlight"
                      >
                        <td className="data-cell text-muted-foreground">
                          +{idx.toString().padStart(4, '0')}
                        </td>
                        <td className="data-cell text-foreground font-medium">
                          {addr.toString().padStart(5, '0')}
                        </td>
                        <td className="data-cell text-primary">
                          {numVal.toString(16).toUpperCase().padStart(isBool ? 1 : 4, '0')}
                        </td>
                        <td className="data-cell text-foreground">
                          {numVal}
                        </td>
                        <td className="data-cell text-muted-foreground text-xs">
                          {isBool
                            ? (val ? '1' : '0').padStart(1, '0')
                            : numVal.toString(2).padStart(16, '0')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
          </div>
        </div>
      )}
    </div>
  );
}

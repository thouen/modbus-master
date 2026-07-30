'use client';

import { useState, useMemo } from 'react';
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

const PAGE_SIZE = 64; // 8x8 grid
const TOTAL_PAGES = 1024; // 64 * 1024 = 65536 registers

export function DataDisplay({ results, isPolling, pollConfig }: DataDisplayProps) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [currentPage, setCurrentPage] = useState(0);

  const latestResult = results[0];

  // Build a map of address -> value from the latest result
  const dataMap = useMemo(() => {
    const map = new Map<number, number | boolean>();
    if (latestResult) {
      latestResult.values.forEach((val: number | boolean, idx: number) => {
        map.set(latestResult.address + idx, val);
      });
    }
    return map;
  }, [latestResult]);

  // Generate 8x8 grid data for current page
  const gridData = useMemo(() => {
    const startAddr = currentPage * PAGE_SIZE;
    const rows: { addr: number; val: number | boolean | null }[][] = [];

    for (let row = 0; row < 8; row++) {
      const rowData: { addr: number; val: number | boolean | null }[] = [];
      for (let col = 0; col < 8; col++) {
        const addr = startAddr + row * 8 + col;
        const val = dataMap.has(addr) ? dataMap.get(addr)! : null;
        rowData.push({ addr, val });
      }
      rows.push(rowData);
    }
    return rows;
  }, [currentPage, dataMap]);

  const formatValue = (val: number | boolean | null, isBool: boolean): string => {
    if (val === null) return '0';
    const numVal = isBool ? (val ? 1 : 0) : (val as number);
    if (displayFormat === 'hex') {
      return numVal.toString(16).toUpperCase().padStart(isBool ? 1 : 4, '0');
    } else if (displayFormat === 'bin') {
      return isBool ? (val ? '1' : '0') : numVal.toString(2).padStart(16, '0');
    }
    return String(numVal);
  };

  const isBoolType = latestResult?.functionCode === 1 || latestResult?.functionCode === 2;

  return (
    <div className="industrial-panel p-4">
      <div className="flex items-center justify-between mb-3">
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

      {/* Result info */}
      {latestResult && (
        <div className="flex items-center gap-3 mb-3 px-1 text-sm font-mono">
          <span className="text-foreground/70">
            FC{latestResult.functionCode.toString().padStart(2, '0')} - {FC_LABELS[latestResult.functionCode] || 'Unknown'}
          </span>
          <span className="text-foreground/60">
            ADDR: <span className="text-foreground font-medium">{latestResult.address}</span>
          </span>
          <span className="text-foreground/60">
            QTY: <span className="text-foreground font-medium">{latestResult.quantity}</span>
          </span>
          <span className="text-foreground/60">
            TS: <span className="text-foreground font-medium">{new Date(latestResult.timestamp).toLocaleTimeString()}</span>
          </span>
        </div>
      )}

      {/* 8x8 Grid */}
      <div className="space-y-1">
        {gridData.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-8 gap-1">
            {row.map((cell) => (
              <div
                key={cell.addr}
                className="flex items-center gap-1 bg-secondary/30 rounded-sm px-1.5 py-1 border border-border/30 hover:border-primary/30 transition-colors"
              >
                <span className="text-[10px] font-mono text-foreground/40 w-7 shrink-0 text-right">
                  {cell.addr.toString().padStart(5, '0')}
                </span>
                <span
                  className={`text-xs font-mono font-medium truncate ${
                    cell.val === null ? 'text-foreground/25' : 'text-primary'
                  }`}
                >
                  {formatValue(cell.val, isBoolType)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            &lt; PREV
          </button>
          <span className="text-xs font-mono text-foreground/60">
            PAGE <span className="text-foreground font-medium">{currentPage + 1}</span> / {TOTAL_PAGES}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(TOTAL_PAGES - 1, p + 1))}
            disabled={currentPage === TOTAL_PAGES - 1}
            className="px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            NEXT &gt;
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max={TOTAL_PAGES}
            value={currentPage + 1}
            onChange={(e) => {
              const page = parseInt(e.target.value, 10);
              if (!isNaN(page) && page >= 1 && page <= TOTAL_PAGES) {
                setCurrentPage(page - 1);
              }
            }}
            className="w-16 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-center text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <span className="text-xs font-mono text-foreground/40">
            ADDR {currentPage * PAGE_SIZE} - {currentPage * PAGE_SIZE + PAGE_SIZE - 1}
          </span>
        </div>
      </div>
    </div>
  );
}

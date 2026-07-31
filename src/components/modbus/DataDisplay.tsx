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

const HEX_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

// 16x16 = 256 per page for HEX/DEC, 16x4 = 64 per page for BIN
const PAGE_SIZE_HEX = 256;
const PAGE_SIZE_BIN = 64;
const TOTAL_PAGES_HEX = 256;  // 256 * 256 = 65536
const TOTAL_PAGES_BIN = 1024; // 64 * 1024 = 65536

export function DataDisplay({ results, isPolling, pollConfig }: DataDisplayProps) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [currentPage, setCurrentPage] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<{ addr: number; val: number | boolean | null } | null>(null);

  const isBinMode = displayFormat === 'bin';
  const pageSize = isBinMode ? PAGE_SIZE_BIN : PAGE_SIZE_HEX;
  const totalPages = isBinMode ? TOTAL_PAGES_BIN : TOTAL_PAGES_HEX;
  const cols = isBinMode ? 4 : 16;
  const rows = 16;

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

  // Generate grid data for current page
  const gridData = useMemo(() => {
    const startAddr = currentPage * pageSize;
    const gridRows: { addr: number; val: number | boolean | null }[][] = [];

    for (let row = 0; row < rows; row++) {
      const rowData: { addr: number; val: number | boolean | null }[] = [];
      for (let col = 0; col < cols; col++) {
        const addr = startAddr + row * cols + col;
        const val = dataMap.has(addr) ? dataMap.get(addr)! : null;
        rowData.push({ addr, val });
      }
      gridRows.push(rowData);
    }
    return gridRows;
  }, [currentPage, dataMap, pageSize, cols]);

  const formatCellValue = (val: number | boolean | null, isBool: boolean): string => {
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

  // Format address for display (hex, 4 digits)
  const formatAddr = (addr: number): string => {
    return addr.toString(16).toUpperCase().padStart(4, '0');
  };

  // Format decimal address (5 digits, 00000-65535)
  const formatDecAddr = (addr: number): string => {
    return addr.toString().padStart(5, '0');
  };

  // Get column headers based on mode and page
  const getColumnHeaders = (): string[] => {
    if (!isBinMode) {
      // HEX/DEC mode: always 0-F
      return HEX_CHARS;
    }
    // BIN mode: 4 cols, headers based on page
    // Page 0: 0,1,2,3 | Page 1: 4,5,6,7 | Page 2: 8,9,A,B | Page 3: C,D,E,F | repeat
    const offset = (currentPage % 4) * 4;
    return HEX_CHARS.slice(offset, offset + 4);
  };

  // Format value for tooltip
  const formatTooltipValue = (val: number | boolean | null, isBool: boolean) => {
    if (val === null) return { dec: '0', hex: '0x0000', bin: '0b0000 0000 0000 0000' };
    const numVal = isBool ? (val ? 1 : 0) : (val as number);
    const hex = '0x' + numVal.toString(16).toUpperCase().padStart(4, '0');
    const bin = '0b' + numVal.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
    return { dec: String(numVal), hex, bin };
  };

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
                onClick={() => {
                  setDisplayFormat(opt.value);
                  setCurrentPage(0);
                }}
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

      {/* 16x16 or 16x4 Grid with headers */}
      <div className="relative">
        <div className="flex">
          {/* Column headers */}
          <div className="w-8 shrink-0" />
          <div className={`grid gap-0.5 flex-1`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {getColumnHeaders().map((ch, i) => (
              <div key={i} className="text-center text-[10px] font-mono text-foreground/50 py-1">
                {ch}
              </div>
            ))}
          </div>
        </div>

        {/* Grid rows */}
        <div className="space-y-0.5">
          {gridData.map((row, rowIdx) => (
            <div key={rowIdx} className="flex items-center">
              {/* Row header */}
              <div className="w-8 shrink-0 text-center text-[10px] font-mono text-foreground/50">
                {HEX_CHARS[rowIdx]}
              </div>
              {/* Cells */}
              <div className={`grid gap-0.5 flex-1`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {row.map((cell) => (
                  <div
                    key={cell.addr}
                    className="relative bg-secondary/30 rounded-sm px-1 py-0.5 text-center cursor-pointer transition-colors hover:bg-secondary/60"
                    onMouseEnter={() => setHoveredCell(cell)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <span
                      className={`text-xs font-mono font-medium ${cell.val === null ? 'text-foreground/25' : 'text-primary'
                        }`}
                    >
                      {formatCellValue(cell.val, isBoolType)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Hover Tooltip */}
        {hoveredCell && (
          <div className="absolute top-0 right-0 z-10 bg-background border border-border rounded-sm p-2 shadow-lg pointer-events-none">
            <div className="text-xs font-mono space-y-1">
              <div className="text-foreground/60">
                ADDR: <span className="text-foreground font-medium">{formatDecAddr(hoveredCell.addr)}</span>
                <span className="text-foreground/60 ml-2">0x{formatAddr(hoveredCell.addr)}</span>
              </div>
              {hoveredCell.val !== null && (
                <div className="space-y-0.5">
                  <div className="text-foreground/60">
                    DEC: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, isBoolType).dec}</span>
                  </div>
                  <div className="text-foreground/60">
                    HEX: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, isBoolType).hex}</span>
                  </div>
                  <div className="text-foreground/60">
                    BIN: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, isBoolType).bin}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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
            PAGE <span className="text-foreground font-medium">{currentPage + 1}</span> / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
            className="px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            NEXT &gt;
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max={totalPages}
            value={currentPage + 1}
            onChange={(e) => {
              const page = parseInt(e.target.value, 10);
              if (!isNaN(page) && page >= 1 && page <= totalPages) {
                setCurrentPage(page - 1);
              }
            }}
            className="w-16 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-center text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <span className="text-xs font-mono text-foreground/40">
            ADDR {currentPage * pageSize} - {currentPage * pageSize + pageSize - 1}
          </span>
        </div>
      </div>
    </div>
  );
}

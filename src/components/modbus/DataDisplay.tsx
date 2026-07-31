'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ReadResult } from '@/types/modbus';

interface DataDisplayProps {
  readResults: ReadResult[];
  isPolling: boolean;
  pollConfig: { functionCode: number; address: number; quantity: number; interval: number } | null;
  onRead?: (functionCode: number, address: number, quantity: number) => Promise<ReadResult | null>;
  readTrigger?: number | null;
}

type DisplayFormat = 'hex' | 'dec' | 'bin' | 'float';

const FORMAT_OPTIONS: { label: string; value: DisplayFormat }[] = [
  { label: 'HEX', value: 'hex' },
  { label: 'DEC', value: 'dec' },
  { label: 'BIN', value: 'bin' },
  { label: 'FLOAT', value: 'float' },
];

const FC_LABELS: Record<number, string> = {
  1: 'Read Coils',
  2: 'Read Discrete Inputs',
  3: 'Read Holding Registers',
  4: 'Read Input Registers',
};

const HEX_CHARS = '0123456789ABCDEF'.split('');

// Float row headers: 0,2,4,6,8,a,c,e repeated twice
const FLOAT_ROW_HEADERS = ['0', '2', '4', '6', '8', 'a', 'c', 'e', '0', '2', '4', '6', '8', 'a', 'c', 'e'];
// Float column headers: 0/8, 1/9, 2/a, 3/b, 4/c, 5/d, 6/e, 7/f
const FLOAT_COL_HEADERS = ['0/8', '1/9', '2/a', '3/b', '4/c', '5/d', '6/e', '7/f'];

// Pages per mode (based on 65536 total registers)
const PAGES_HEX_DEC = 256; // 256 regs/page
const PAGES_BIN = 1024;    // 64 regs/page
const PAGES_FLOAT = 512;   // 128 floats (256 regs)/page

// Registers per page per mode
const REGS_PER_PAGE_HEX_DEC = 256;
const REGS_PER_PAGE_BIN = 64;
const REGS_PER_PAGE_FLOAT = 256; // 128 floats * 2 regs each

export function DataDisplay({ readResults, isPolling, pollConfig, onRead, readTrigger }: DataDisplayProps) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [currentPage, setCurrentPage] = useState(0);

  // Jump to page when readTrigger changes
  useEffect(() => {
    if (readTrigger != null) {
      const pagesPerMode = displayFormat === 'bin' ? 1024 : displayFormat === 'float' ? 512 : 256;
      const regsPerPage = displayFormat === 'bin' ? 64 : 256;
      const targetPage = Math.floor(readTrigger / regsPerPage);
      setCurrentPage(Math.min(targetPage, pagesPerMode - 1));
    }
  }, [readTrigger, displayFormat]);
  const [hoveredCell, setHoveredCell] = useState<{ addr: number; val: number | boolean | null; floatVal?: number } | null>(null);
  const [pageInput, setPageInput] = useState('');

  const latestResult = readResults.length > 0 ? readResults[0] : null;

  // Grid dimensions based on format
  const isFloatMode = displayFormat === 'float';
  const isBinMode = displayFormat === 'bin';
  const rows = 16;
  const cols = isFloatMode ? 8 : (isBinMode ? 4 : 16);

  // Total pages based on format
  const totalPages = isFloatMode ? PAGES_FLOAT : (isBinMode ? PAGES_BIN : PAGES_HEX_DEC);

  // Calculate start address based on current page and format
  const regsPerPage = isFloatMode ? REGS_PER_PAGE_FLOAT : (isBinMode ? REGS_PER_PAGE_BIN : REGS_PER_PAGE_HEX_DEC);
  const startAddr = currentPage * regsPerPage;

  // Get page for a given address (for consistent pagination across modes)
  const getPageForAddress = useCallback((addr: number, format: DisplayFormat): number => {
    const rpp = format === 'float' ? REGS_PER_PAGE_FLOAT : (format === 'bin' ? REGS_PER_PAGE_BIN : REGS_PER_PAGE_HEX_DEC);
    return Math.floor(addr / rpp);
  }, []);

  // Handle format change - keep consistent pagination
  const handleFormatChange = useCallback((format: DisplayFormat) => {
    setDisplayFormat(format);
    // Calculate current address range and jump to corresponding page
    const currentStartAddr = currentPage * regsPerPage;
    const newPage = getPageForAddress(currentStartAddr, format);
    setCurrentPage(newPage);
  }, [currentPage, regsPerPage, getPageForAddress]);

  // Handle read and jump to page
  const handleReadAndJump = useCallback(async (functionCode: number, address: number, quantity: number) => {
    if (onRead) {
      const result = await onRead(functionCode, address, quantity);
      if (result) {
        // Jump to page containing the start address
        const page = getPageForAddress(address, displayFormat);
        setCurrentPage(page);
      }
      return result;
    }
    return null;
  }, [onRead, displayFormat, getPageForAddress]);

  // Expose handleReadAndJump via a ref-like pattern (parent can call via onRead prop)
  // For the read button in ReadPanel, we'll pass the jump logic through

  // Build grid data with new address mapping: addr = startAddr + col * 16 + row
  const gridData = useMemo(() => {
    const data: { addr: number; val: number | boolean | null; floatVal?: number }[][] = [];

    if (!latestResult) {
      // No data - show all zeros with addresses
      for (let row = 0; row < rows; row++) {
        const rowData: { addr: number; val: number | boolean | null }[] = [];
        for (let col = 0; col < cols; col++) {
          const addr = startAddr + col * 16 + row;
          rowData.push({ addr, val: null });
        }
        data.push(rowData);
      }
      return data;
    }

    const isBoolType = latestResult.functionCode === 1 || latestResult.functionCode === 2;
    const resultStart = latestResult.address;
    const resultEnd = resultStart + latestResult.quantity;

    for (let row = 0; row < rows; row++) {
      const rowData: { addr: number; val: number | boolean | null; floatVal?: number }[] = [];
      for (let col = 0; col < cols; col++) {
        const addr = startAddr + col * 16 + row;

        if (isFloatMode) {
          // Float mode: each float uses 2 registers (addr and addr+8)
          // Column determines the low register offset (0-7), row determines the base (0,2,4,6,8,a,c,e)
          const rowBase = row < 8 ? row * 2 : (row - 8) * 2 + 1;
          const colLow = col; // 0-7
          const reg1Addr = startAddr + colLow + rowBase * 16;
          const reg2Addr = reg1Addr + 8;

          const val1 = (addr >= resultStart && addr < resultEnd)
            ? latestResult.values[addr - resultStart]
            : null;
          const val2 = (reg2Addr >= resultStart && reg2Addr < resultEnd)
            ? latestResult.values[reg2Addr - resultStart]
            : null;

          let floatVal: number | undefined;
          if (val1 !== null && val2 !== null && typeof val1 === 'number' && typeof val2 === 'number') {
            // Combine two 16-bit registers into 32-bit float
            const combined = (val1 << 16) | val2;
            const floatArray = new Float32Array([combined]);
            floatVal = floatArray[0];
          }

          rowData.push({ addr: reg1Addr, val: val1, floatVal });
        } else {
          const val = (addr >= resultStart && addr < resultEnd)
            ? latestResult.values[addr - resultStart]
            : null;
          rowData.push({ addr, val });
        }
      }
      data.push(rowData);
    }
    return data;
  }, [latestResult, startAddr, rows, cols, isFloatMode]);

  // Format cell value
  const formatCellValue = (val: number | boolean | null, floatVal?: number): string => {
    if (val === null) return '0';

    if (isFloatMode && floatVal !== undefined) {
      return floatVal.toFixed(4);
    }

    const isBool = typeof val === 'boolean';
    const numVal = isBool ? (val ? 1 : 0) : (val as number);

    if (displayFormat === 'hex') {
      return '0x' + numVal.toString(16).toUpperCase().padStart(isBool ? 1 : 4, '0');
    } else if (displayFormat === 'bin') {
      return isBool ? (val ? '1' : '0') : '0b' + numVal.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
    }
    return String(numVal);
  };

  // Format address for display (hex, 4 digits)
  const formatAddr = (addr: number): string => {
    return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
  };

  // Format decimal address (5 digits, 00000-65535)
  const formatDecAddr = (addr: number): string => {
    return addr.toString().padStart(5, '0');
  };

  // Get column headers based on mode and page
  const getColumnHeaders = (): string[] => {
    if (isFloatMode) {
      return FLOAT_COL_HEADERS;
    }
    if (isBinMode) {
      // BIN mode: 4 cols, headers based on page
      const offset = (currentPage % 4) * 4;
      return HEX_CHARS.slice(offset, offset + 4);
    }
    // HEX/DEC mode: always 0-F
    return HEX_CHARS;
  };

  // Get row headers based on mode
  const getRowHeaders = (): string[] => {
    if (isFloatMode) {
      return FLOAT_ROW_HEADERS;
    }
    return HEX_CHARS;
  };

  // Format value for tooltip
  const formatTooltipValue = (val: number | boolean | null, isBool: boolean) => {
    if (val === null) return { dec: '00000', hex: '0x0000', bin: '0b0000 0000 0000 0000' };
    const numVal = isBool ? (val ? 1 : 0) : (val as number);
    const hex = '0x' + numVal.toString(16).toUpperCase().padStart(4, '0');
    const bin = '0b' + numVal.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
    return { dec: String(numVal).padStart(5, '0'), hex, bin };
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
                onClick={() => handleFormatChange(opt.value)}
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
            PAGE: <span className="text-foreground font-medium">{currentPage + 1}/{totalPages}</span>
          </span>
        </div>
      )}

      {/* Grid with headers */}
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
                {getRowHeaders()[rowIdx]}
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
                      {formatCellValue(cell.val, cell.floatVal)}
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
                <span className="text-foreground/60 ml-2">{formatAddr(hoveredCell.addr)}</span>
              </div>
              {isFloatMode && hoveredCell.floatVal !== undefined && (
                <div className="text-foreground/60">
                  FLOAT: <span className="text-primary font-medium">{hoveredCell.floatVal.toFixed(6)}</span>
                </div>
              )}
              {hoveredCell.val !== null && (
                <div className="space-y-0.5">
                  <div className="text-foreground/60">
                    DEC: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, typeof hoveredCell.val === 'boolean').dec}</span>
                  </div>
                  <div className="text-foreground/60">
                    HEX: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, typeof hoveredCell.val === 'boolean').hex}</span>
                  </div>
                  <div className="text-foreground/60">
                    BIN: <span className="text-primary font-medium">{formatTooltipValue(hoveredCell.val, typeof hoveredCell.val === 'boolean').bin}</span>
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
            value={pageInput || (currentPage + 1).toString()}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => {
              const page = parseInt(pageInput, 10);
              if (!isNaN(page) && page >= 1 && page <= totalPages) {
                setCurrentPage(page - 1);
              }
              setPageInput('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const page = parseInt(pageInput, 10);
                if (!isNaN(page) && page >= 1 && page <= totalPages) {
                  setCurrentPage(page - 1);
                }
                setPageInput('');
              }
            }}
            className="w-16 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-center focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs font-mono text-foreground/50">
            ADDR {formatDecAddr(startAddr)} - {formatDecAddr(Math.min(startAddr + regsPerPage - 1, 65535))}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between mt-2 px-1 text-xs font-mono text-foreground/50">
        <span>
          {isFloatMode ? '128 floats' : `${rows * cols} registers`} / page | {totalPages} pages | 65536 total
        </span>
        <span className="uppercase">{displayFormat} mode</span>
      </div>
    </div>
  );
}

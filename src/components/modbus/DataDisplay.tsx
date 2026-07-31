'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ReadResult } from '@/types/modbus';

interface DataDisplayProps {
  readResults: ReadResult[];
  isPolling: boolean;
  pollConfig: { functionCode: number; address: number; quantity: number; interval: number } | null;
  onRead?: (functionCode: number, address: number, quantity: number) => Promise<ReadResult | null>;
  readTrigger?: number | null;
}

type DisplayFormat = 'hex' | 'dec' | 'bin' | 'flt' | 'dlb';
type IntMode = 'signed' | 'unsigned';
type ByteOrder = 'ABCD' | 'CDAB' | 'BADC' | 'DCBA';

const FORMAT_OPTIONS: { label: string; value: DisplayFormat }[] = [
  { label: 'HEX', value: 'hex' },
  { label: 'DEC', value: 'dec' },
  { label: 'BIN', value: 'bin' },
  { label: 'FLT', value: 'flt' },
  { label: 'DLB', value: 'dlb' },
];

const FC_LABELS: Record<number, string> = {
  1: 'Read Coils',
  2: 'Read Discrete Inputs',
  3: 'Read Holding Registers',
  4: 'Read Input Registers',
};

const HEX_CHARS = '0123456789ABCDEF'.split('');

// FLT column headers for odd/even pages
const FLT_COL_HEADERS_ODD = ['0', '1', '2', '3', '4', '5', '6', '7'];
const FLT_COL_HEADERS_EVEN = ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

// DLB row headers: 0,2,4,6,8,A,C,E repeated twice
const DLB_ROW_HEADERS = ['0', '2', '4', '6', '8', 'A', 'C', 'E', '0', '2', '4', '6', '8', 'A', 'C', 'E'];
// DLB column headers: 0/8, 1/9, 2/A, 3/B, 4/C, 5/D, 6/E, 7/F
const DLB_COL_HEADERS = ['0/8', '1/9', '2/A', '3/B', '4/C', '5/D', '6/E', '7/F'];

// Pages per mode (based on 65536 total registers)
const PAGES_256 = 256;   // 256 regs/page (HEX/DEC)
const PAGES_BIN = 1024;  // 64 regs/page
const PAGES_FLT = 512;   // 128 regs/page (16x8 FLT)
const PAGES_DLB = 512;   // 128 regs/page (16x8 DLB, 2 regs per value)

// Registers per page per mode
const REGS_PER_PAGE_256 = 256;
const REGS_PER_PAGE_BIN = 64;
const REGS_PER_PAGE_FLT = 128;  // 16 rows * 8 cols = 128 floats (2 regs each)
const REGS_PER_PAGE_DLB = 128;  // 16 rows * 8 cols = 128 doubles (2 regs each, row step 2)

export function DataDisplay({ readResults, isPolling, pollConfig, onRead, readTrigger }: DataDisplayProps) {
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [intMode, setIntMode] = useState<IntMode>('signed');
  const [byteOrder, setByteOrder] = useState<ByteOrder>('ABCD');
  const [currentPage, setCurrentPage] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<{
    addr: number;
    val: number | boolean | null;
    fltVal?: number;
    dlbVal?: number;
    mouseX?: number;
    mouseY?: number;
  } | null>(null);
  const [pageInput, setPageInput] = useState('');
  const tooltipRef = useRef<HTMLDivElement>(null);

  const getRegsPerPage = (format: DisplayFormat): number => {
    if (format === 'bin') return REGS_PER_PAGE_BIN;
    if (format === 'flt') return REGS_PER_PAGE_FLT;
    if (format === 'dlb') return REGS_PER_PAGE_DLB;
    return REGS_PER_PAGE_256;
  };

  const getPagesPerMode = (format: DisplayFormat): number => {
    if (format === 'bin') return PAGES_BIN;
    if (format === 'flt') return PAGES_FLT;
    if (format === 'dlb') return PAGES_DLB;
    return PAGES_256;
  };

  // Jump to page when readTrigger changes
  useEffect(() => {
    if (readTrigger != null) {
      const regsPerPage = getRegsPerPage(displayFormat);
      const pagesPerMode = getPagesPerMode(displayFormat);
      const targetPage = Math.floor(readTrigger / regsPerPage);
      setCurrentPage(Math.min(targetPage, pagesPerMode - 1));
    }
  }, [readTrigger, displayFormat]);

  const latestResult = readResults.length > 0 ? readResults[0] : null;

  // Grid dimensions based on format
  const isFltMode = displayFormat === 'flt';
  const isDlbMode = displayFormat === 'dlb';
  const isBinMode = displayFormat === 'bin';
  const rows = 16;
  const cols = (isFltMode || isDlbMode) ? 8 : isBinMode ? 4 : 16;

  // Total pages based on format
  const totalPages = getPagesPerMode(displayFormat);

  // Calculate start address based on current page and format
  const regsPerPage = getRegsPerPage(displayFormat);
  const startAddr = currentPage * regsPerPage;

  // Get page for a given address (for consistent pagination across modes)
  const getPageForAddress = useCallback((addr: number, format: DisplayFormat): number => {
    const rpp = getRegsPerPage(format);
    return Math.floor(addr / rpp);
  }, []);

  // Handle format change - keep consistent pagination
  const handleFormatChange = useCallback((format: DisplayFormat) => {
    setDisplayFormat(format);
    const currentStartAddr = currentPage * regsPerPage;
    const newPage = getPageForAddress(currentStartAddr, format);
    setCurrentPage(newPage);
  }, [currentPage, regsPerPage, getPageForAddress]);

  // Handle read and jump to page
  const handleReadAndJump = useCallback(async (functionCode: number, address: number, quantity: number) => {
    if (onRead) {
      const result = await onRead(functionCode, address, quantity);
      if (result) {
        const page = getPageForAddress(address, displayFormat);
        setCurrentPage(page);
      }
      return result;
    }
    return null;
  }, [onRead, displayFormat, getPageForAddress]);

  // Swap bytes based on byte order
  const swapBytes = useCallback((regs: number[], order: ByteOrder): number[] => {
    if (order === 'ABCD') return regs;
    if (order === 'CDAB') return [regs[1], regs[0], regs[3], regs[2]];
    if (order === 'BADC') return [regs[1], regs[0], regs[2], regs[3]];
    if (order === 'DCBA') return [regs[3], regs[2], regs[1], regs[0]];
    return regs;
  }, []);

  // Parse 32-bit float from 2 registers
  const parseFloat32 = useCallback((reg1: number, reg2: number, order: ByteOrder): number => {
    const regs = swapBytes([reg1, reg2, 0, 0], order);
    const combined = (regs[0] << 16) | regs[1];
    const floatArray = new Float32Array([combined]);
    return floatArray[0];
  }, [swapBytes]);

  // Parse 64-bit double from 4 registers
  const parseFloat64 = useCallback((reg1: number, reg2: number, reg3: number, reg4: number, order: ByteOrder): number => {
    const regs = swapBytes([reg1, reg2, reg3, reg4], order);
    const high = (regs[0] << 16) | regs[1];
    const low = (regs[2] << 16) | regs[3];
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, high);
    view.setUint32(4, low);
    return view.getFloat64(0);
  }, [swapBytes]);

  // Build grid data with address mapping: addr = startAddr + col * 16 + row
  const gridData = useMemo(() => {
    const data: {
      addr: number;
      val: number | boolean | null;
      fltVal?: number;
      dlbVal?: number;
    }[][] = [];

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

    const getVal = (addr: number): number | boolean | null => {
      if (addr >= resultStart && addr < resultEnd) {
        return latestResult.values[addr - resultStart];
      }
      return null;
    };

    for (let row = 0; row < rows; row++) {
      const rowData: { addr: number; val: number | boolean | null; fltVal?: number; dlbVal?: number }[] = [];
      for (let col = 0; col < cols; col++) {
        const addr = startAddr + col * 16 + row;
        const val = getVal(addr);

        if (displayFormat === 'flt') {
          // FLT mode: 16x8 grid, 512 pages
          // Odd pages: col headers 0-7, Even pages: col headers 8-F
          const colOffset = currentPage % 2 === 1 ? 0 : 8;
          const reg1Addr = startAddr + (colOffset + col) * 16 + row;
          const reg2Addr = reg1Addr + 1;
          const val1 = getVal(reg1Addr);
          const val2 = getVal(reg2Addr);
          let fltVal: number | undefined;
          if (val1 !== null && val2 !== null && typeof val1 === 'number' && typeof val2 === 'number') {
            fltVal = parseFloat32(val1, val2, byteOrder);
          }
          rowData.push({ addr: reg1Addr, val: val1, fltVal });
        } else if (displayFormat === 'dlb') {
          // DLB mode: 16x8 grid, 512 pages
          // Row step = 2 (each DLB occupies 2 registers)
          // Col step = 16
          const reg1Addr = startAddr + col * 16 + row * 2;
          const reg2Addr = reg1Addr + 1;
          const reg3Addr = reg1Addr + 16;
          const reg4Addr = reg1Addr + 17;

          const v1 = getVal(reg1Addr);
          const v2 = getVal(reg2Addr);
          const v3 = getVal(reg3Addr);
          const v4 = getVal(reg4Addr);

          let dlbVal: number | undefined;
          if (v1 !== null && v2 !== null && v3 !== null && v4 !== null &&
              typeof v1 === 'number' && typeof v2 === 'number' &&
              typeof v3 === 'number' && typeof v4 === 'number') {
            dlbVal = parseFloat64(v1, v2, v3, v4, byteOrder);
          }

          rowData.push({ addr: reg1Addr, val: v1, dlbVal });
        } else {
          rowData.push({ addr, val });
        }
      }
      data.push(rowData);
    }
    return data;
  }, [latestResult, startAddr, rows, cols, displayFormat, byteOrder, parseFloat32, parseFloat64, currentPage]);

  // Format cell value
  const formatCellValue = (val: number | boolean | null, fltVal?: number, dlbVal?: number): string => {
    if (val === null) return '0';

    if (displayFormat === 'flt' && fltVal !== undefined) {
      return fltVal.toFixed(4);
    }
    if (displayFormat === 'dlb' && dlbVal !== undefined) {
      return dlbVal.toFixed(6);
    }

    const isBool = typeof val === 'boolean';
    const numVal = isBool ? (val ? 1 : 0) : (val as number);

    if (displayFormat === 'hex') {
      return '0x' + numVal.toString(16).toUpperCase().padStart(isBool ? 1 : 4, '0');
    } else if (displayFormat === 'bin') {
      return isBool ? (val ? '1' : '0') : '0b' + numVal.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
    } else if (displayFormat === 'dec') {
      if (intMode === 'unsigned' && !isBool) {
        return String(numVal >>> 0);
      }
      return String(numVal);
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
    if (isDlbMode) {
      return DLB_COL_HEADERS;
    }
    if (isFltMode) {
      // FLT: odd pages (0,2,4...) show 0-7, even pages (1,3,5...) show 8-F
      return currentPage % 2 === 0 ? FLT_COL_HEADERS_ODD : FLT_COL_HEADERS_EVEN;
    }
    if (isBinMode) {
      const offset = (currentPage % 4) * 4;
      return HEX_CHARS.slice(offset, offset + 4);
    }
    return HEX_CHARS;
  };

  // Get row headers based on mode
  const getRowHeaders = (): string[] => {
    if (isDlbMode) {
      return DLB_ROW_HEADERS;
    }
    return HEX_CHARS;
  };

  // Format value for tooltip
  const formatTooltipValue = (val: number | boolean | null, isBool: boolean) => {
    if (val === null) return { dec: '00000', hex: '0x0000', bin: '0b0000 0000 0000 0000' };
    const numVal = isBool ? (val ? 1 : 0) : (val as number);
    const hex = '0x' + numVal.toString(16).toUpperCase().padStart(4, '0');
    const bin = '0b' + numVal.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
    const dec = intMode === 'unsigned' ? String(numVal >>> 0).padStart(5, '0') : String(numVal).padStart(5, '0');
    return { dec, hex, bin };
  };

  // Check if address tail is even (for DLB display)
  const isEvenAddr = (addr: number): boolean => {
    return addr % 2 === 0;
  };

  // Handle mouse move for tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent, cell: typeof hoveredCell) => {
    if (cell) {
      setHoveredCell({
        ...cell,
        mouseX: e.clientX,
        mouseY: e.clientY,
      });
    }
  }, []);

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
          {/* Int mode selector (for DEC) */}
          {displayFormat === 'dec' && (
            <div className="flex items-center gap-1 bg-secondary/50 rounded-sm p-0.5">
              <button
                onClick={() => setIntMode('signed')}
                className={`px-2 py-1 text-xs font-mono rounded-sm transition-all ${intMode === 'signed' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                S
              </button>
              <button
                onClick={() => setIntMode('unsigned')}
                className={`px-2 py-1 text-xs font-mono rounded-sm transition-all ${intMode === 'unsigned' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                U
              </button>
            </div>
          )}
          {/* Byte order selector (for FLT/DLB) */}
          {(displayFormat === 'flt' || displayFormat === 'dlb') && (
            <select
              value={byteOrder}
              onChange={(e) => setByteOrder(e.target.value as ByteOrder)}
              className="px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ABCD">ABCD</option>
              <option value="CDAB">CDAB</option>
              <option value="BADC">BADC</option>
              <option value="DCBA">DCBA</option>
            </select>
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
                {row.map((cell) => {
                  const showDlb = displayFormat !== 'dlb' && isEvenAddr(cell.addr);
                  return (
                    <div
                      key={cell.addr}
                      className="relative bg-secondary/30 rounded-sm px-1 py-0.5 text-center cursor-pointer transition-colors hover:bg-secondary/60"
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      onMouseMove={(e) => handleMouseMove(e, cell)}
                    >
                      <span
                        className={`text-xs font-mono font-medium truncate block max-w-full ${cell.val === null ? 'text-foreground/25' : 'text-primary'
                          }`}
                        title={formatCellValue(cell.val, cell.fltVal, cell.dlbVal)}
                      >
                        {formatCellValue(cell.val, cell.fltVal, cell.dlbVal)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Hover Tooltip - follows mouse */}
        {hoveredCell && hoveredCell.mouseX != null && hoveredCell.mouseY != null && (
          <div
            ref={tooltipRef}
            className="fixed z-50 bg-background border border-border rounded-sm p-2 shadow-lg pointer-events-none"
            style={{
              left: hoveredCell.mouseX + 12,
              top: hoveredCell.mouseY + 12,
            }}
          >
            <div className="text-xs font-mono space-y-1">
              <div className="text-foreground/60">
                ADDR: <span className="text-foreground font-medium">{formatDecAddr(hoveredCell.addr)}</span>
                <span className="text-foreground/60 ml-2">{formatAddr(hoveredCell.addr)}</span>
              </div>
              {displayFormat === 'flt' && hoveredCell.fltVal !== undefined && (
                <div className="text-foreground/60">
                  FLT: <span className="text-primary font-medium">{hoveredCell.fltVal.toFixed(6)}</span>
                </div>
              )}
              {displayFormat === 'dlb' && hoveredCell.dlbVal !== undefined && (
                <div className="text-foreground/60">
                  DLB: <span className="text-primary font-medium">{hoveredCell.dlbVal.toFixed(10)}</span>
                </div>
              )}
              {displayFormat !== 'dlb' && isEvenAddr(hoveredCell.addr) && hoveredCell.val !== null && (
                <div className="text-foreground/60">
                  DLB: <span className="text-amber-400 font-medium">hover for double</span>
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
            className="w-16 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs font-mono text-foreground/50">
            {displayFormat === 'bin' ? '64 regs/page' : displayFormat === 'dlb' ? '128 dbl/page' : displayFormat === 'flt' ? '256 regs/page' : '256 regs/page'}
          </span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReadResult, DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';
const ROW_HEADERS_16 = Array.from({ length: 16 }, (_, i) => HEX_CHARS[i]);
const ROW_HEADERS_DBL = ['0', '2', '4', '6', '8', 'A', 'C', 'E'];

const DEFAULT_BYTE_ORDER: ByteOrder = 'LE';
const DEFAULT_SIGNED = true;

function getStoredByteOrder(): ByteOrder {
  if (typeof window === 'undefined') return DEFAULT_BYTE_ORDER;
  return (localStorage.getItem('modbus-byte-order') as ByteOrder) || DEFAULT_BYTE_ORDER;
}

function getStoredSigned(): boolean {
  if (typeof window === 'undefined') return DEFAULT_SIGNED;
  const v = localStorage.getItem('modbus-signed');
  return v === null ? DEFAULT_SIGNED : v === 'true';
}

function swapBytes32(val: number): number {
  return (
    ((val & 0xff) << 24) |
    (((val >> 8) & 0xff) << 16) |
    (((val >> 16) & 0xff) << 8) |
    ((val >> 24) & 0xff)
  );
}

function swapBytes64(hi: number, lo: number, byteOrder: ByteOrder): [number, number] {
  if (byteOrder === 'LE') return [hi, lo];
  return [lo, hi];
}

function parseFloat32(regs: number[], byteOrder: ByteOrder): number {
  let hi = regs[0] & 0xffff;
  let lo = regs[1] & 0xffff;
  if (byteOrder === 'BE') {
    const tmp = hi;
    hi = lo;
    lo = tmp;
  }
  const combined = (hi << 16) | lo;
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, combined >>> 0);
  return new DataView(buf).getFloat32(0);
}

function parseFloat64(regs: number[], byteOrder: ByteOrder): number {
  let r0 = regs[0] & 0xffff;
  let r1 = regs[1] & 0xffff;
  let r2 = regs[2] & 0xffff;
  let r3 = regs[3] & 0xffff;
  if (byteOrder === 'BE') {
    const tmp0 = r0; r0 = r3; r3 = tmp0;
    const tmp1 = r1; r1 = r2; r2 = tmp1;
  }
  const hi = (r0 << 16) | r1;
  const lo = (r2 << 16) | r3;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, hi >>> 0);
  view.setUint32(4, lo >>> 0);
  return view.getFloat64(0);
}

interface DataDisplayProps {
  readResults: ReadResult[];
  isPolling: boolean;
  pollConfig: { functionCode: number; address: number; quantity: number; interval: number } | null;
  onRead: (functionCode: number, address: number, quantity: number) => Promise<ReadResult | null>;
  readTrigger: number | null;
}

// Grid config per display mode
// rows x cols, regs per cell, regs per page, total pages
const GRID_CONFIG: Record<DisplayFormat, { rows: number; cols: number; regsPerCell: number; regsPerPage: number; totalPages: number }> = {
  sht: { rows: 16, cols: 16, regsPerCell: 1, regsPerPage: 256, totalPages: 256 },
  hex: { rows: 16, cols: 16, regsPerCell: 1, regsPerPage: 256, totalPages: 256 },
  dec: { rows: 16, cols: 16, regsPerCell: 1, regsPerPage: 256, totalPages: 256 },
  bin: { rows: 16, cols: 4, regsPerCell: 1, regsPerPage: 64, totalPages: 1024 },
  flt: { rows: 16, cols: 8, regsPerCell: 2, regsPerPage: 128, totalPages: 512 },
  dbl: { rows: 8, cols: 8, regsPerCell: 4, regsPerPage: 128, totalPages: 512 },
};

export function DataDisplay({ readResults, isPolling, pollConfig, onRead, readTrigger }: DataDisplayProps) {
  const { t } = useTranslation();
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [byteOrder, setByteOrder] = useState<ByteOrder>(getStoredByteOrder);
  const [signed, setSigned] = useState(getStoredSigned);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  useEffect(() => {
    localStorage.setItem('modbus-byte-order', byteOrder);
  }, [byteOrder]);

  useEffect(() => {
    localStorage.setItem('modbus-signed', String(signed));
  }, [signed]);

  const config = GRID_CONFIG[displayFormat];
  const { rows, cols, regsPerCell, regsPerPage, totalPages } = config;

  // Jump to page containing the read address
  useEffect(() => {
    if (readTrigger != null) {
      const targetPage = Math.floor(readTrigger / regsPerPage);
      setCurrentPage(Math.min(targetPage, totalPages - 1));
    }
  }, [readTrigger, displayFormat, regsPerPage, totalPages]);

  const latestResult = readResults.length > 0 ? readResults[0] : null;

  const getReg = useCallback((addr: number): number | boolean | null => {
    if (!latestResult?.data) return null;
    const offset = addr - latestResult.startAddr;
    if (offset < 0 || offset >= latestResult.data.length) return null;
    return latestResult.data[offset];
  }, [latestResult]);

  // Column headers: based on C digit of address 0xABCD
  const getColHeaders = useCallback((): string[] => {
    if (displayFormat === 'bin') {
      // 4 cols: cycle 0-3, 4-7, 8-B, C-F
      const pageMod = currentPage % 4;
      const start = pageMod * 4;
      return Array.from({ length: 4 }, (_, i) => HEX_CHARS[start + i]);
    }
    if (displayFormat === 'flt') {
      // 8 cols: cycle 0-7, 8-F
      const pageMod = currentPage % 2;
      const start = pageMod * 8;
      return Array.from({ length: 8 }, (_, i) => HEX_CHARS[start + i]);
    }
    if (displayFormat === 'dbl') {
      // 8 cols: 0-7 (C digit for doubles, each double = 4 regs, so C = 0-7)
      return Array.from({ length: 8 }, (_, i) => HEX_CHARS[i]);
    }
    // hex/dec/sht: 16 cols, 0-F
    return ROW_HEADERS_16;
  }, [displayFormat, currentPage]);

  const getRowHeaders = useCallback((): string[] => {
    if (displayFormat === 'dbl') return ROW_HEADERS_DBL;
    return ROW_HEADERS_16;
  }, [displayFormat]);

  // Calculate register address for cell (row, col) on current page
  const getCellAddr = useCallback((row: number, col: number): number => {
    const pageStartAddr = currentPage * regsPerPage;
    if (displayFormat === 'dbl') {
      // DBL: 8 rows x 8 cols, each cell = 4 regs
      // Row headers: 0,2,4,6,8,A,C,E (D digit, even only)
      // Col headers: 0-7 (C digit)
      // addr = pageStart + col*4 + row*16
      return pageStartAddr + col * 4 + row * 16;
    }
    if (displayFormat === 'flt') {
      // FLT: 16 rows x 8 cols, each cell = 2 regs
      // Row = D digit (0-F), Col = C digit (0-7 or 8-F)
      // addr = pageStart + col*16 + row
      return pageStartAddr + col * 16 + row;
    }
    if (displayFormat === 'bin') {
      // BIN: 16 rows x 4 cols, each cell = 1 reg
      // Row = D digit (0-F), Col = C digit (0-3, 4-7, 8-B, C-F)
      // addr = pageStart + col*16 + row
      return pageStartAddr + col * 16 + row;
    }
    // HEX/DEC: 16 rows x 16 cols, each cell = 1 reg
    // Row = D digit (0-F), Col = C digit (0-F)
    // addr = pageStart + col*16 + row
    return pageStartAddr + col * 16 + row;
  }, [currentPage, regsPerPage, displayFormat]);

  const gridData = useMemo(() => {
    const data: {
      addr: number;
      value: number | boolean | null;
      fltVal?: number;
      dblVal?: number;
      hasFlt: boolean;
      hasDbl: boolean;
    }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const addr = getCellAddr(row, col);
        const value = getReg(addr);

        let fltVal: number | undefined;
        let dblVal: number | undefined;
        let hasFlt = false;
        let hasDbl = false;

        // FLT tooltip: always compute for non-DBL modes
        if (displayFormat !== 'dbl') {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          if (r0 !== null && r1 !== null && typeof r0 === 'number' && typeof r1 === 'number') {
            fltVal = parseFloat32([r0, r1], byteOrder);
            hasFlt = true;
          }
        }

        // DBL tooltip: only for even addresses
        if (addr % 2 === 0) {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          const r2 = getReg(addr + 2);
          const r3 = getReg(addr + 3);
          if (r0 !== null && r1 !== null && r2 !== null && r3 !== null &&
              typeof r0 === 'number' && typeof r1 === 'number' &&
              typeof r2 === 'number' && typeof r3 === 'number') {
            dblVal = parseFloat64([r0, r1, r2, r3], byteOrder);
            hasDbl = true;
          }
        }

        data.push({ addr, value, fltVal, dblVal, hasFlt, hasDbl });
      }
    }
    return data;
  }, [latestResult, rows, cols, displayFormat, byteOrder, currentPage, getReg, getCellAddr]);

  const formatCellValue = (val: number | boolean | null, fltVal?: number, dblVal?: number): string => {
    if (displayFormat === 'flt') {
      if (fltVal !== undefined) return fltVal.toFixed(4);
      return '0.0000';
    }
    if (displayFormat === 'dbl') {
      if (dblVal !== undefined) return dblVal.toFixed(6);
      return '0.000000';
    }
    if (val === null) return '0';
    if (typeof val === 'boolean') return val ? '1' : '0';
    const numVal = val & 0xffff;
    if (displayFormat === 'hex') return numVal.toString(16).toUpperCase().padStart(4, '0');
    if (displayFormat === 'bin') return numVal.toString(2).padStart(16, '0');
    if (displayFormat === 'sht') {
      // SHT: signed 16-bit integer
      return numVal > 32767 ? (numVal - 65536).toString() : numVal.toString();
    }
    if (!signed) return numVal.toString();
    return numVal > 32767 ? (numVal - 65536).toString() : numVal.toString();
  };

  const handleMouseMove = (e: React.MouseEvent, addr: number, fltVal?: number, dblVal?: number) => {
    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">ADDR:</span> {addr} (0x{addr.toString(16).toUpperCase().padStart(4, '0')})</div>
        {fltVal !== undefined && (
          <div><span className="text-muted-foreground">FLT:</span> {fltVal.toFixed(6)} ({byteOrder === 'LE' ? 'LE' : 'BE'})</div>
        )}
        {dblVal !== undefined && (
          <div><span className="text-muted-foreground">DBL:</span> {dblVal.toFixed(10)} ({byteOrder === 'LE' ? 'LE' : 'BE'})</div>
        )}
      </div>
    );
    setTooltip({ x: e.clientX + 12, y: e.clientY + 12, content });
  };

  const handleMouseLeave = () => setTooltip(null);

  const colHeaders = getColHeaders();
  const rowHeaders = getRowHeaders();

  const handlePageJump = () => {
    const p = parseInt(pageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      setCurrentPage(p - 1);
      setPageInput('');
    }
  };

  const isDblMode = displayFormat === 'dbl';

  return (
    <div className="industrial-panel flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="industrial-header flex items-center gap-2">
          <span className="text-primary">▦</span>
          {t('data.title')}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Format buttons */}
          <div className="flex items-center gap-1">
            {(['hex', 'dec', 'bin', 'flt', 'dbl'] as DisplayFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setDisplayFormat(fmt)}
                className={`px-2 py-1 text-xs font-mono uppercase rounded-sm transition-colors ${
                  displayFormat === fmt
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground border border-border'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
          {/* S/U toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSigned(true)}
              className={`px-2 py-1 text-xs font-mono rounded-sm transition-colors ${
                signed ? 'bg-primary/20 text-primary border border-primary/50' : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              S
            </button>
            <button
              onClick={() => setSigned(false)}
              className={`px-2 py-1 text-xs font-mono rounded-sm transition-colors ${
                !signed ? 'bg-primary/20 text-primary border border-primary/50' : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              U
            </button>
          </div>
          {/* Byte order dropdown */}
          <select
            value={byteOrder}
            onChange={(e) => setByteOrder(e.target.value as ByteOrder)}
            className="px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-foreground cursor-pointer"
          >
            <option value="LE">ABCD (LE)</option>
            <option value="BE">DCBA (BE)</option>
          </select>
        </div>
      </div>

      {latestResult ? (
        <>
          <div className="flex items-center gap-4 mb-2 text-xs font-mono text-muted-foreground">
            <span>FC{String(latestResult.functionCode).padStart(2, '0')} - {latestResult.name}</span>
            <span>ADDR: {latestResult.startAddr}</span>
            <span>QTY: {latestResult.quantity}</span>
            <span>PAGE: {currentPage + 1}/{totalPages}</span>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="inline-block min-w-full">
              <div
                className="grid gap-px"
                style={{
                  gridTemplateColumns: `40px repeat(${cols}, minmax(80px, 1fr))`,
                }}
              >
                {/* Header row */}
                <div className={isDblMode ? 'h-12' : 'h-6'}></div>
                {colHeaders.map((h, i) => (
                  <div key={i} className={`${isDblMode ? 'h-12' : 'h-6'} flex items-center justify-center text-xs font-mono text-muted-foreground`}>
                    {h}
                  </div>
                ))}

                {/* Data rows */}
                {Array.from({ length: rows }, (_, rowIdx) => {
                  const rowStartIdx = rowIdx * cols;
                  const rowData = gridData.slice(rowStartIdx, rowStartIdx + cols);

                  return (
                    <div key={rowIdx} className="contents">
                      {/* Row header */}
                      <div className={`${isDblMode ? 'h-14' : 'h-7'} flex items-center justify-center text-xs font-mono text-muted-foreground`}>
                        {rowHeaders[rowIdx]}
                      </div>
                      {/* Data cells */}
                      {rowData.map((cell, colIdx) => {
                        const displayValue = formatCellValue(cell.value, cell.fltVal, cell.dblVal);
                        const showFlt = cell.hasFlt;
                        const showDbl = cell.hasDbl;

                        return (
                          <div
                            key={colIdx}
                            className={`${isDblMode ? 'h-14' : 'h-7'} flex items-center justify-center text-xs font-mono border border-border/30 cursor-pointer hover:bg-primary/10 ${
                              cell.value !== null && cell.value !== 0 ? 'text-primary font-medium' : 'text-muted-foreground'
                            }`}
                            onMouseMove={(e) => {
                              if (showFlt || showDbl) {
                                handleMouseMove(e, cell.addr, cell.fltVal, cell.dblVal);
                              }
                            }}
                            onMouseLeave={handleMouseLeave}
                          >
                            <span className="truncate max-w-full px-1" title={displayValue}>
                              {displayValue}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-2 py-1 text-xs font-mono border border-border rounded-sm hover:bg-secondary disabled:opacity-30"
              >
                &lt; {t('data.prev')}
              </button>
              <span className="text-xs font-mono text-muted-foreground">
                {t('data.page')} {currentPage + 1} {t('data.of')} {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="px-2 py-1 text-xs font-mono border border-border rounded-sm hover:bg-secondary disabled:opacity-30"
              >
                {t('data.next')} &gt;
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePageJump()}
                placeholder={t('data.goTo')}
                className="w-16 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded-sm text-center"
                min={1}
                max={totalPages}
              />
              <span className="text-xs font-mono text-muted-foreground">
                {regsPerPage} regs/page
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <div className="text-4xl mb-2 opacity-30"></div>
            <p className="text-sm">{t('data.noData')}</p>
            <p className="text-xs mt-1">{t('data.connectToRead')}</p>
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="fixed z-50 bg-panel border border-border rounded px-3 py-2 shadow-lg pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

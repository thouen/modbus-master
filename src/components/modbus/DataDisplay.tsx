'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReadResult, DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';
const ROW_HEADERS_16 = Array.from({ length: 16 }, (_, i) => HEX_CHARS[i]);
const ROW_HEADERS_DLB = ['0', '2', '4', '6', '8', 'A', 'C', 'E', '0', '2', '4', '6', '8', 'A', 'C', 'E'];
const FLT_COL_HEADERS_LOW = ['0', '1', '2', '3', '4', '5', '6', '7'];
const FLT_COL_HEADERS_HIGH = ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
const DLB_COL_HEADERS = ['0/8', '1/9', '2/A', '3/B', '4/C', '5/D', '6/E', '7/F'];

const REGS_PER_PAGE_256 = 256;
const REGS_PER_PAGE_BIN = 64;
const REGS_PER_PAGE_DLB = 256;
const PAGES_256 = 256;
const PAGES_BIN = 1024;
const PAGES_DLB = 256;

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

function swapBytes16(val: number): number {
  return ((val & 0xff) << 8) | ((val >> 8) & 0xff);
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

  const getRegsPerPage = useCallback((format: DisplayFormat): number => {
    if (format === 'bin') return REGS_PER_PAGE_BIN;
    if (format === 'dlb') return REGS_PER_PAGE_DLB;
    return REGS_PER_PAGE_256;
  }, []);

  const getPagesPerMode = useCallback((format: DisplayFormat): number => {
    if (format === 'bin') return PAGES_BIN;
    if (format === 'dlb') return PAGES_DLB;
    return PAGES_256;
  }, []);

  useEffect(() => {
    if (readTrigger != null) {
      const regsPerPage = getRegsPerPage(displayFormat);
      const pagesPerMode = getPagesPerMode(displayFormat);
      const targetPage = Math.floor(readTrigger / regsPerPage);
      setCurrentPage(Math.min(targetPage, pagesPerMode - 1));
    }
  }, [readTrigger, displayFormat, getRegsPerPage, getPagesPerMode]);

  const latestResult = readResults.length > 0 ? readResults[0] : null;
  const startAddr = latestResult?.startAddr ?? 0;

  const isFloatMode = displayFormat === 'flt' || displayFormat === 'dlb';
  const rows = 16;
  const cols = displayFormat === 'dlb' ? 8 : displayFormat === 'flt' ? 8 : 16;

  const getColHeaders = (): string[] => {
    if (displayFormat === 'dlb') return DLB_COL_HEADERS;
    if (displayFormat === 'flt') {
      return currentPage % 2 === 0 ? FLT_COL_HEADERS_LOW : FLT_COL_HEADERS_HIGH;
    }
    return ROW_HEADERS_16;
  };

  const getRowHeaders = (): string[] => {
    if (displayFormat === 'dlb') return ROW_HEADERS_DLB;
    return ROW_HEADERS_16;
  };

  const getReg = useCallback((addr: number): number | boolean | null => {
    if (!latestResult?.data) return null;
    const offset = addr - latestResult.startAddr;
    if (offset < 0 || offset >= latestResult.data.length) return null;
    return latestResult.data[offset];
  }, [latestResult]);

  const gridData = useMemo(() => {
    const data: {
      addr: number;
      value: number | boolean | null;
      fltVal?: number;
      dlbVal?: number;
      hasFlt: boolean;
      hasDlb: boolean;
    }[] = [];

    const regsPerPage = getRegsPerPage(displayFormat);
    const pageStartAddr = currentPage * regsPerPage;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let addr: number;
        if (displayFormat === 'dlb') {
          // DLB: each double occupies 4 registers (8 bytes)
          // Same column: upper row addr = lower row addr - 2
          // Each column spans 32 registers (16 rows * 2 regs spacing)
          addr = pageStartAddr + col * 32 + row * 2;
        } else if (displayFormat === 'flt') {
          // FLT: each float occupies 2 registers (4 bytes)
          addr = pageStartAddr + col * 16 + row;
        } else {
          // HEX/DEC/BIN: each register is 1 unit
          addr = pageStartAddr + col * 16 + row;
        }

        const value = getReg(addr);

        let fltVal: number | undefined;
        let dlbVal: number | undefined;
        let hasFlt = false;
        let hasDlb = false;

        if (displayFormat === 'flt') {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          if (r0 !== null && r1 !== null && typeof r0 === 'number' && typeof r1 === 'number') {
            fltVal = parseFloat32([r0, r1], byteOrder);
            hasFlt = true;
          }
        } else if (displayFormat === 'dlb') {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          const r2 = getReg(addr + 2);
          const r3 = getReg(addr + 3);
          if (r0 !== null && r1 !== null && r2 !== null && r3 !== null &&
              typeof r0 === 'number' && typeof r1 === 'number' &&
              typeof r2 === 'number' && typeof r3 === 'number') {
            dlbVal = parseFloat64([r0, r1, r2, r3], byteOrder);
            hasDlb = true;
          }
        } else {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          if (r0 !== null && r1 !== null && typeof r0 === 'number' && typeof r1 === 'number') {
            fltVal = parseFloat32([r0, r1], byteOrder);
            hasFlt = true;
          }
          if (addr % 2 === 0) {
            const r0 = getReg(addr);
            const r1 = getReg(addr + 1);
            const r2 = getReg(addr + 2);
            const r3 = getReg(addr + 3);
            if (r0 !== null && r1 !== null && r2 !== null && r3 !== null &&
                typeof r0 === 'number' && typeof r1 === 'number' &&
                typeof r2 === 'number' && typeof r3 === 'number') {
              dlbVal = parseFloat64([r0, r1, r2, r3], byteOrder);
              hasDlb = true;
            }
          }
        }

        data.push({ addr, value, fltVal, dlbVal, hasFlt, hasDlb });
      }
    }
    return data;
  }, [latestResult, startAddr, rows, cols, displayFormat, byteOrder, currentPage, getReg, getRegsPerPage]);

  const formatCellValue = (val: number | boolean | null, fltVal?: number, dlbVal?: number): string => {
    if (displayFormat === 'flt') {
      if (fltVal !== undefined) return fltVal.toFixed(4);
      return '0.0000';
    }
    if (displayFormat === 'dlb') {
      if (dlbVal !== undefined) return dlbVal.toFixed(6);
      return '0.000000';
    }
    if (val === null) return '0';
    if (typeof val === 'boolean') return val ? '1' : '0';
    const numVal = val & 0xffff;
    if (displayFormat === 'hex') return numVal.toString(16).toUpperCase().padStart(4, '0');
    if (displayFormat === 'bin') return numVal.toString(2).padStart(16, '0');
    if (!signed) return numVal.toString();
    return numVal > 32767 ? (numVal - 65536).toString() : numVal.toString();
  };

  const handleMouseMove = (e: React.MouseEvent, addr: number, fltVal?: number, dlbVal?: number) => {
    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">ADDR:</span> {addr} (0x{addr.toString(16).toUpperCase().padStart(4, '0')})</div>
        {fltVal !== undefined && (
          <div><span className="text-muted-foreground">FLT:</span> {fltVal.toFixed(6)} ({byteOrder === 'LE' ? 'LE' : 'BE'})</div>
        )}
        {dlbVal !== undefined && (
          <div><span className="text-muted-foreground">DLB:</span> {dlbVal.toFixed(10)} ({byteOrder === 'LE' ? 'LE' : 'BE'})</div>
        )}
      </div>
    );
    setTooltip({ x: e.clientX + 12, y: e.clientY + 12, content });
  };

  const handleMouseLeave = () => setTooltip(null);

  const totalPages = getPagesPerMode(displayFormat);
  const regsPerPage = getRegsPerPage(displayFormat);
  const colHeaders = getColHeaders();
  const rowHeaders = getRowHeaders();

  const handlePageJump = () => {
    const p = parseInt(pageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      setCurrentPage(p - 1);
      setPageInput('');
    }
  };

  return (
    <div className="industrial-panel flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="industrial-header flex items-center gap-2">
          <span className="text-primary">▦</span>
          {t('data.title')}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setByteOrder('LE')}
              className={`px-2 py-1 text-xs font-mono rounded-sm transition-colors ${
                byteOrder === 'LE' ? 'bg-primary/20 text-primary border border-primary/50' : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              ABCD
            </button>
            <button
              onClick={() => setByteOrder('BE')}
              className={`px-2 py-1 text-xs font-mono rounded-sm transition-colors ${
                byteOrder === 'BE' ? 'bg-primary/20 text-primary border border-primary/50' : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              DCBA
            </button>
          </div>
          <div className="flex items-center gap-1">
            {(['hex', 'dec', 'bin', 'flt', 'dlb'] as DisplayFormat[]).map((fmt) => (
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
              <div className="grid gap-px" style={{ gridTemplateColumns: `40px repeat(${cols}, minmax(80px, 1fr))` }}>
                {/* Header row */}
                <div className="h-6"></div>
                {colHeaders.map((h, i) => (
                  <div key={i} className="h-6 flex items-center justify-center text-xs font-mono text-muted-foreground">
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
                      <div className="h-7 flex items-center justify-center text-xs font-mono text-muted-foreground border-b border-border/30">
                        {rowHeaders[rowIdx]}
                      </div>
                      {/* Data cells */}
                      {rowData.map((cell, colIdx) => {
                        const displayValue = formatCellValue(cell.value, cell.fltVal, cell.dlbVal);
                        const showFlt = cell.hasFlt;
                        const showDlb = cell.hasDlb && cell.addr % 2 === 0;

                        return (
                          <div
                            key={colIdx}
                            className={`h-7 flex items-center justify-center text-xs font-mono border-b border-border/30 cursor-pointer hover:bg-primary/10 ${
                              cell.value !== null && cell.value !== 0 ? 'text-primary font-medium' : 'text-muted-foreground'
                            }`}
                            onMouseMove={(e) => {
                              if (showFlt || showDlb) {
                                handleMouseMove(e, cell.addr, cell.fltVal, cell.dlbVal);
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

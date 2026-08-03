'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DisplayFormat, ByteOrder, ReadResult } from '@/types/modbus';

interface DataDisplayProps {
  readResults: ReadResult[];
  displayFormat: DisplayFormat;
  byteOrder: ByteOrder;
  signed: boolean;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const HEX_CHARS = '0123456789ABCDEF';
const ROW_HEADERS_16 = Array.from({ length: 16 }, (_, i) => HEX_CHARS[i]);
const ROW_HEADERS_8 = Array.from({ length: 8 }, (_, i) => HEX_CHARS[i * 2]); // 0,2,4,6,8,A,C,E

const GRID_CONFIG: Record<DisplayFormat, { rows: number; cols: number; regsPerCell: number; regsPerPage: number; totalPages: number }> = {
  hex: { rows: 16, cols: 8, regsPerCell: 1, regsPerPage: 128, totalPages: 512 },
  dec: { rows: 16, cols: 8, regsPerCell: 1, regsPerPage: 128, totalPages: 512 },
  bin: { rows: 16, cols: 4, regsPerCell: 1, regsPerPage: 64, totalPages: 1024 },
  flt: { rows: 8, cols: 4, regsPerCell: 2, regsPerPage: 64, totalPages: 1024 },
};

const parseFloat32 = (regs: number[], byteOrder: ByteOrder): number => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  if (byteOrder === 'LE') {
    view.setUint16(0, regs[0] & 0xffff, true);
    view.setUint16(2, regs[1] & 0xffff, true);
  } else {
    view.setUint16(0, regs[1] & 0xffff, true);
    view.setUint16(2, regs[0] & 0xffff, true);
  }
  return view.getFloat32(0, true);
};

export default function DataDisplay({
  readResults,
  displayFormat,
  byteOrder,
  signed,
  currentPage,
  onPageChange,
}: DataDisplayProps) {
  const { t } = useTranslation();
  const [pageInput, setPageInput] = useState('');
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  const { rows, cols, regsPerCell, regsPerPage, totalPages } = GRID_CONFIG[displayFormat];

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
      // 4 cols: 0-3 (C digit for floats, each float = 2 regs, so C = 0-3)
      return Array.from({ length: 4 }, (_, i) => HEX_CHARS[i]);
    }
    // hex/dec: 8 cols, 0-7
    const pageMod = currentPage % 2;
    const start = pageMod * 8;
    return Array.from({ length: 8 }, (_, i) => HEX_CHARS[start + i]);
  }, [displayFormat, currentPage]);

  const getRowHeaders = useCallback((): string[] => {
    if (displayFormat === 'flt') return ROW_HEADERS_8;
    return ROW_HEADERS_16;
  }, [displayFormat]);

  // Calculate register address for cell (row, col) on current page
  const getCellAddr = useCallback((row: number, col: number): number => {
    const pageStartAddr = currentPage * regsPerPage;
    if (displayFormat === 'flt') {
      // FLT: 8 rows x 4 cols, each cell = 2 regs
      // Row headers: 0,2,4,6,8,A,C,E (D digit, even only)
      // Col headers: 0-3 (C digit)
      // addr = pageStart + col*8 + row*2
      return pageStartAddr + col * 8 + row * 2;
    }
    if (displayFormat === 'bin') {
      // BIN: 16 rows x 4 cols, each cell = 1 reg
      // Row = D digit (0-F), Col = C digit (0-3, 4-7, 8-B, C-F)
      // addr = pageStart + col*16 + row
      return pageStartAddr + col * 16 + row;
    }
    // HEX/DEC: 16 rows x 8 cols, each cell = 1 reg
    // Row = D digit (0-F), Col = C digit (0-7 or 8-F)
    // addr = pageStart + col*16 + row
    return pageStartAddr + col * 16 + row;
  }, [currentPage, regsPerPage, displayFormat]);

  const gridData = useMemo(() => {
    const data: {
      addr: number;
      value: number | boolean | null;
      fltVal?: number;
      hasFlt: boolean;
    }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const addr = getCellAddr(row, col);
        const value = getReg(addr);

        let fltVal: number | undefined;
        let hasFlt = false;

        // FLT tooltip: compute for FLT mode
        if (displayFormat === 'flt') {
          const r0 = getReg(addr);
          const r1 = getReg(addr + 1);
          if (r0 !== null && r1 !== null && typeof r0 === 'number' && typeof r1 === 'number') {
            fltVal = parseFloat32([r0, r1], byteOrder);
            hasFlt = true;
          }
        }

        data.push({ addr, value, fltVal, hasFlt });
      }
    }
    return data;
  }, [latestResult, rows, cols, displayFormat, byteOrder, currentPage, getReg, getCellAddr]);

  const formatCellValue = (val: number | boolean | null, fltVal?: number): string => {
    if (displayFormat === 'flt') {
      if (fltVal !== undefined) return fltVal.toFixed(4);
      return '0.0000';
    }
    if (val === null) return '0';
    if (typeof val === 'boolean') return val ? '1' : '0';
    const numVal = val & 0xffff;
    if (displayFormat === 'hex') return numVal.toString(16).toUpperCase().padStart(4, '0');
    if (displayFormat === 'bin') return numVal.toString(2).padStart(16, '0');
    if (!signed) return numVal.toString();
    return numVal > 32767 ? (numVal - 65536).toString() : numVal.toString();
  };

  const handleMouseMove = (e: React.MouseEvent, addr: number, fltVal?: number) => {
    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">ADDR:</span> {addr} (0x{addr.toString(16).toUpperCase().padStart(4, '0')})</div>
        {fltVal !== undefined && (
          <div><span className="text-muted-foreground">FLT:</span> {fltVal.toFixed(6)} ({byteOrder === 'LE' ? 'LE' : 'BE'})</div>
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
      onPageChange(p - 1);
      setPageInput('');
    }
  };

  const isFltMode = displayFormat === 'flt';

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
            {(['hex', 'dec', 'bin', 'flt'] as DisplayFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => {
                  onPageChange(0);
                }}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded transition-all ${
                  displayFormat === fmt
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                    : 'bg-panel hover:bg-accent text-muted-foreground'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {/* Byte order */}
          <select
            value={byteOrder}
            onChange={(e) => {}}
            className="bg-panel border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
          >
            <option value="LE">LE</option>
            <option value="BE">BE</option>
          </select>

          {/* Signed toggle */}
          <button
            className={`px-2 py-1.5 text-xs font-mono rounded transition-colors ${
              signed ? 'bg-primary text-primary-foreground' : 'bg-panel hover:bg-accent text-muted-foreground'
            }`}
          >
            {signed ? 'S' : 'U'}
          </button>

          {/* Pagination */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              onClick={() => onPageChange(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="px-2 py-1 rounded bg-panel hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ◀
            </button>
            <span className="font-mono min-w-[80px] text-center">
              {t('data.page', { current: currentPage + 1, total: totalPages })}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              className="px-2 py-1 rounded bg-panel hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ▶
            </button>
            <input
              type="number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePageJump()}
              placeholder={t('data.jumpToPage')}
              className="w-16 bg-panel border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
              min={1}
              max={totalPages}
            />
            <span className="text-muted-foreground">
              {regsPerPage} {t('data.regsPerPage')}
            </span>
          </div>
        </div>
      </div>

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        <div className="inline-block min-w-full">
          {/* Column headers */}
          <div className="flex">
            <div className="w-12 shrink-0"></div>
            {colHeaders.map((h, i) => (
              <div
                key={i}
                className="w-24 text-center text-xs font-mono text-muted-foreground py-1 border-b border-border"
              >
                0x{h}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {rowHeaders.map((rowH, row) => (
            <div key={row} className="flex">
              <div className="w-12 shrink-0 text-xs font-mono text-muted-foreground flex items-center justify-end pr-2">
                0x{rowH}
              </div>
              {Array.from({ length: cols }, (_, col) => {
                const idx = row * cols + col;
                const cell = gridData[idx];
                if (!cell) return <div key={col} className="w-24 h-8"></div>;
                const displayValue = formatCellValue(cell.value, cell.fltVal);
                return (
                  <div
                    key={col}
                    className={`w-24 text-center text-xs font-mono py-2 border-b border-border/50 cursor-default transition-colors hover:bg-accent/50 ${
                      isFltMode ? 'h-16 flex items-center justify-center' : 'h-8 flex items-center justify-center'
                    }`}
                    onMouseMove={(e) => handleMouseMove(e, cell.addr, cell.fltVal)}
                    onMouseLeave={handleMouseLeave}
                  >
                    {displayValue}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-panel border border-border rounded px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

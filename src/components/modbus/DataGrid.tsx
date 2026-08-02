'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';

function getHexDigit(addr: number, position: number): string {
  // position: 0 = lowest nibble (D), 1 = second lowest (C), etc.
  return HEX_CHARS[(addr >> (position * 4)) & 0xF];
}

function formatBinary(val: number): string {
  return '0b' + val.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
}

function formatHex(val: number): string {
  return '0x' + val.toString(16).toUpperCase().padStart(4, '0');
}

function formatAddress(addr: number): string {
  return addr.toString().padStart(5, '0');
}

function formatHexAddress(addr: number): string {
  return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
}

interface DataGridProps {
  data: number[];
  startAddr: number;
  quantity: number;
  displayFormat: DisplayFormat;
  byteOrder: ByteOrder;
  signed: boolean;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function parseFloat32(regs: number[], byteOrder: ByteOrder): number {
  let hi = regs[0] & 0xffff;
  let lo = regs[1] & 0xffff;
  if (byteOrder === 'BE') {
    const tmp = hi; hi = lo; lo = tmp;
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

export function DataGrid({ data, startAddr, quantity, displayFormat, byteOrder, signed, currentPage, totalPages, onPageChange }: DataGridProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  // Grid dimensions based on display format
  const isDBL = displayFormat === 'dbl';
  const isBinOrFlt = displayFormat === 'bin' || displayFormat === 'flt';
  
  const rows = isDBL ? 8 : 16;
  const cols = (isDBL || isBinOrFlt) ? 4 : 8;
  // For DBL, each cell uses 2 regs, so regs per page = rows * cols * 2
  const regsPerPage = isDBL ? rows * cols * 2 : rows * cols;

  // Page start address: starts from the input startAddr, not from 0
  const pageStartAddr = startAddr + currentPage * regsPerPage;

  // Generate row headers: start from D (last hex digit of startAddr), increment
  const rowHeaders = useMemo(() => {
    const d = startAddr & 0xF;
    return Array.from({ length: rows }, (_, i) => {
      if (isDBL) {
        // For DBL: D, F, 1, 3, 5, 7, 9, B (step by 2)
        return HEX_CHARS[(d + i * 2) % 16];
      }
      return HEX_CHARS[(d + i) % 16];
    });
  }, [startAddr, rows, isDBL]);

  // Generate column headers: start from C (second-to-last hex digit of startAddr), increment by page
  const colHeaders = useMemo(() => {
    const c = (startAddr >> 4) & 0xF;
    const pageOffset = currentPage * cols;
    return Array.from({ length: cols }, (_, i) => {
      return HEX_CHARS[(c + pageOffset + i) % 16];
    });
  }, [startAddr, currentPage, cols]);

  const getCellValue = useCallback((row: number, col: number): string => {
    // Calculate address: row-major order
    // For DBL: each cell represents 2 registers, row index is multiplied by 2
    const rowOffset = isDBL ? row * 2 : row;
    const addr = pageStartAddr + col * (isDBL ? 16 : (isBinOrFlt ? 16 : 16)) + rowOffset;
    
    // Wait, let me reconsider the address calculation
    // The user said: row = C digit, col = D digit
    // So address = pageStart + col * 16 + row (for 16-row modes)
    // For DBL (8 rows): address = pageStart + col * 16 + row * 2
    
    const actualAddr = pageStartAddr + col * 16 + (isDBL ? row * 2 : row);
    const relAddr = actualAddr - startAddr;
    
    if (relAddr < 0 || relAddr >= quantity) return '--';
    if (relAddr >= data.length) return '--';

    const val = data[relAddr];

    switch (displayFormat) {
      case 'hex':
        return formatHex(val);
      case 'dec': {
        if (!signed) return val.toString();
        return val > 32767 ? (val - 65536).toString() : val.toString();
      }
      case 'bin':
        return formatBinary(val);
      case 'flt': {
        if (relAddr + 1 >= data.length || relAddr + 1 >= quantity) return '--';
        const f = parseFloat32([val, data[relAddr + 1]], byteOrder);
        return f.toFixed(4);
      }
      case 'dbl': {
        if (relAddr + 3 >= data.length || relAddr + 3 >= quantity) return '--';
        const d = parseFloat64([val, data[relAddr + 1], data[relAddr + 2], data[relAddr + 3]], byteOrder);
        return d.toFixed(6);
      }
      default:
        return val.toString();
    }
  }, [data, startAddr, quantity, displayFormat, byteOrder, signed, pageStartAddr, isDBL, isBinOrFlt]);

  const getTooltipContent = useCallback((row: number, col: number) => {
    const rowOffset = isDBL ? row * 2 : row;
    const addr = pageStartAddr + col * 16 + rowOffset;
    const relAddr = addr - startAddr;
    
    if (relAddr < 0 || relAddr >= quantity) return null;

    const hexAddr = formatHexAddress(addr);
    const decAddr = formatAddress(addr);

    // If no data available, show address only
    if (relAddr >= data.length) {
      return (
        <div className="text-xs space-y-1">
          <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
          <div className="text-muted-foreground">{t('dataGrid.noData')}</div>
        </div>
      );
    }

    const val = data[relAddr];
    const decVal = signed && val > 32767 ? val - 65536 : val;
    const hexVal = formatHex(val);
    const binVal = formatBinary(val);

    // Check if DBL should be shown:
    // - Address parity matches start address parity (both even or both odd)
    // - relAddr + 3 < quantity (enough data for double)
    const startParity = startAddr % 2;
    const addrParity = addr % 2;
    const showDBL = startParity === addrParity && relAddr + 3 < data.length && relAddr + 3 < quantity;

    // Check if FLT should be shown (need at least 2 regs)
    const showFLT = relAddr + 1 < data.length && relAddr + 1 < quantity;

    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
        <div><span className="text-muted-foreground">{t('dataGrid.decimal')}:</span> {decVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.hex')}:</span> {hexVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.binary')}:</span> {binVal}</div>
        {showFLT && (
          <div><span className="text-muted-foreground">FLT ({byteOrder}):</span> {parseFloat32([val, data[relAddr + 1]], byteOrder).toFixed(4)}</div>
        )}
        {showDBL && (
          <div><span className="text-muted-foreground">DBL ({byteOrder}):</span> {parseFloat64([val, data[relAddr + 1], data[relAddr + 2], data[relAddr + 3]], byteOrder).toFixed(6)}</div>
        )}
      </div>
    );

    return content;
  }, [data, startAddr, quantity, pageStartAddr, signed, byteOrder, t, isDBL]);

  const handleCellHover = useCallback((row: number, col: number, e: React.MouseEvent) => {
    const content = getTooltipContent(row, col);
    if (content) {
      setTooltip({ x: e.clientX, y: e.clientY, content });
    }
  }, [getTooltipContent]);

  const handleCellLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  return (
    <div className="relative">
      <div className="overflow-auto max-h-[600px]">
        <div
          className="grid gap-0 border border-border"
          style={{
            gridTemplateColumns: `40px repeat(${cols}, minmax(80px, 1fr))`,
            gridTemplateRows: isDBL 
              ? `24px repeat(${rows}, 48px)` // DBL: header normal (24px), data rows 2x (48px)
              : `24px repeat(${rows}, 24px)`, // Other modes: all rows normal (24px)
          }}
        >
          {/* Header row */}
          <div className="bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground"></div>
          {colHeaders.map((h, i) => (
            <div key={i} className="bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground">
              {h}
            </div>
          ))}

          {/* Data rows */}
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="contents">
              <div className="bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground flex items-center justify-center">
                {rowHeaders[row]}
              </div>
              {Array.from({ length: cols }, (_, col) => {
                const cellValue = getCellValue(row, col);
                const isHighlighted = cellValue !== '--';
                return (
                  <div
                    key={col}
                    className={`border-b border-border p-1 text-center text-xs font-mono truncate cursor-pointer transition-colors hover:bg-accent flex items-center justify-center ${
                      isHighlighted ? 'text-primary' : 'text-muted-foreground'
                    }`}
                    onMouseEnter={(e) => handleCellHover(row, col, e)}
                    onMouseLeave={handleCellLeave}
                  >
                    {cellValue}
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
          className="fixed z-50 bg-card border border-border rounded p-2 shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y + 10 }}
        >
          {tooltip.content}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between mt-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="px-2 py-1 bg-panel border border-border rounded hover:bg-accent disabled:opacity-50"
          >
            {t('dataGrid.prevPage')}
          </button>
          <span className="text-muted-foreground">
            {t('dataGrid.page')} {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-2 py-1 bg-panel border border-border rounded hover:bg-accent disabled:opacity-50"
          >
            {t('dataGrid.nextPage')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={totalPages}
            placeholder={t('dataGrid.jumpToPage')}
            className="w-16 px-2 py-1 bg-panel border border-border rounded text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const page = parseInt((e.target as HTMLInputElement).value) - 1;
                if (page >= 0 && page < totalPages) {
                  onPageChange(page);
                }
              }
            }}
          />
          <span className="text-muted-foreground">
            {regsPerPage} {t('dataGrid.regsPerPage')}
          </span>
        </div>
      </div>
    </div>
  );
}

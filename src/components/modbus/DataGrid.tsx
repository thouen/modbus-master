'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReadResult, DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';
const ROW_HEADERS = Array.from({ length: 16 }, (_, i) => HEX_CHARS[i]);
const COL_HEADERS = Array.from({ length: 16 }, (_, i) => HEX_CHARS[i]);

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

export function DataGrid({ data, startAddr, displayFormat, byteOrder, signed, currentPage, totalPages, onPageChange }: DataGridProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  const pageStartAddr = currentPage * 256;

  const getCellValue = useCallback((row: number, col: number): string => {
    const addr = pageStartAddr + row * 16 + col;
    const relAddr = addr - startAddr;
    if (relAddr < 0 || relAddr >= data.length) return '--';

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
        if (relAddr + 1 >= data.length) return '--';
        const f = parseFloat32([val, data[relAddr + 1]], byteOrder);
        return f.toFixed(4);
      }
      case 'dbl': {
        if (relAddr + 3 >= data.length) return '--';
        const d = parseFloat64([val, data[relAddr + 1], data[relAddr + 2], data[relAddr + 3]], byteOrder);
        return d.toFixed(6);
      }
      default:
        return val.toString();
    }
  }, [data, startAddr, displayFormat, byteOrder, signed, pageStartAddr]);

  const getTooltipContent = useCallback((row: number, col: number) => {
    const addr = pageStartAddr + row * 16 + col;
    const relAddr = addr - startAddr;
    if (relAddr < 0 || relAddr >= data.length) return null;

    const val = data[relAddr];
    const decVal = signed && val > 32767 ? val - 65536 : val;
    const hexVal = formatHex(val);
    const binVal = formatBinary(val);
    const hexAddr = formatHexAddress(addr);
    const decAddr = formatAddress(addr);

    let content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
        <div><span className="text-muted-foreground">{t('dataGrid.decimal')}:</span> {decVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.hex')}:</span> {hexVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.binary')}:</span> {binVal}</div>
      </div>
    );

    // Float tooltip (if we have at least 2 regs)
    if (relAddr + 1 < data.length) {
      const f = parseFloat32([val, data[relAddr + 1]], byteOrder);
      content = (
        <div className="text-xs space-y-1">
          <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
          <div><span className="text-muted-foreground">{t('dataGrid.decimal')}:</span> {decVal}</div>
          <div><span className="text-muted-foreground">{t('dataGrid.hex')}:</span> {hexVal}</div>
          <div><span className="text-muted-foreground">{t('dataGrid.binary')}:</span> {binVal}</div>
          <div><span className="text-muted-foreground">FLT ({byteOrder}):</span> {f.toFixed(4)}</div>
        </div>
      );
    }

    // Double tooltip (if even address and we have 4 regs)
    if (addr % 2 === 0 && relAddr + 3 < data.length) {
      const d = parseFloat64([val, data[relAddr + 1], data[relAddr + 2], data[relAddr + 3]], byteOrder);
      content = (
        <div className="text-xs space-y-1">
          <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
          <div><span className="text-muted-foreground">{t('dataGrid.decimal')}:</span> {decVal}</div>
          <div><span className="text-muted-foreground">{t('dataGrid.hex')}:</span> {hexVal}</div>
          <div><span className="text-muted-foreground">{t('dataGrid.binary')}:</span> {binVal}</div>
          <div><span className="text-muted-foreground">FLT ({byteOrder}):</span> {parseFloat32([val, data[relAddr + 1]], byteOrder).toFixed(4)}</div>
          <div><span className="text-muted-foreground">DBL ({byteOrder}):</span> {d.toFixed(6)}</div>
        </div>
      );
    }

    return content;
  }, [data, startAddr, pageStartAddr, signed, byteOrder, t]);

  const handleCellHover = useCallback((row: number, col: number, e: React.MouseEvent) => {
    const content = getTooltipContent(row, col);
    if (content) {
      setTooltip({ x: e.clientX, y: e.clientY, content });
    }
  }, [getTooltipContent]);

  const handleCellLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  // DBL mode: 8 rows x 8 cols (each cell spans 2 regs)
  const isDBL = displayFormat === 'dbl';
  const rows = isDBL ? 8 : 16;
  const cols = isDBL ? 8 : 16;

  return (
    <div className="relative">
      <div className="overflow-auto max-h-[600px]">
        <div
          className="grid gap-0 border border-border"
          style={{
            gridTemplateColumns: `40px repeat(${cols}, minmax(80px, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground"></div>
          {(isDBL ? [0, 2, 4, 6, 8, 10, 12, 14] : COL_HEADERS).map((h, i) => (
            <div key={i} className="bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground">
              {isDBL ? h.toString(16).toUpperCase() : h}
            </div>
          ))}

          {/* Data rows */}
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="contents">
              <div className={`bg-panel border-b border-border p-1 text-center text-xs font-mono text-muted-foreground ${isDBL ? 'row-span-2' : ''}`}>
                {row.toString(16).toUpperCase()}
              </div>
              {Array.from({ length: cols }, (_, col) => {
                const cellValue = getCellValue(row, col);
                const isHighlighted = cellValue !== '--';
                return (
                  <div
                    key={col}
                    className={`border-b border-border p-1 text-center text-xs font-mono truncate cursor-pointer transition-colors hover:bg-accent ${
                      isHighlighted ? 'text-primary' : 'text-muted-foreground'
                    } ${isDBL ? 'row-span-2' : ''}`}
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
            disabled={currentPage === totalPages - 1}
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
            placeholder={t('dataGrid.jumpTo')}
            className="w-16 px-2 py-1 bg-panel border border-border rounded text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const page = parseInt((e.target as HTMLInputElement).value);
                if (page >= 1 && page <= totalPages) {
                  onPageChange(page - 1);
                }
              }
            }}
          />
          <span className="text-muted-foreground">256 regs/page</span>
        </div>
      </div>
    </div>
  );
}

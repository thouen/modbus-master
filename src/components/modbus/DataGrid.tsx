'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';

function getHexDigit(addr: number, position: number): string {
  // position: 0 = lowest nibble (D), 1 = second lowest (C), etc.
  return HEX_CHARS[(addr >> (position * 4)) & 0xF];
}

function formatBinary(val: number, bits: number = 32): string {
  return '0b' + val.toString(2).padStart(bits, '0').replace(/(.{4})/g, '$1 ').trim();
}

function formatHex(val: number, digits: number = 8): string {
  return '0x' + val.toString(16).toUpperCase().padStart(digits, '0');
}

function formatAddress(addr: number): string {
  return addr.toString().padStart(5, '0');
}

function formatHexAddress(addr: number): string {
  return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
}

// Swap bytes in a 32-bit value: ABCD -> DCBA
function swapBytes32(val: number): number {
  const b0 = val & 0xFF;
  const b1 = (val >> 8) & 0xFF;
  const b2 = (val >> 16) & 0xFF;
  const b3 = (val >> 24) & 0xFF;
  return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
}

// Parse input value: supports binary (0b...), hex (0x...), and signed decimal
function parseInputValue(input: string): number {
  const trimmed = input.trim();
  
  // Binary with spaces: "0b0000 0000 1001 1010"
  if (trimmed.startsWith('0b') || trimmed.startsWith('0B')) {
    const binStr = trimmed.slice(2).replace(/\s+/g, '');
    return parseInt(binStr, 2);
  }
  
  // Hex: "0xABCd" (case-insensitive)
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return parseInt(trimmed.slice(2), 16);
  }
  
  // Signed decimal: "-123"
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? 0 : num;
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
  editable?: boolean;
  onCellChange?: (addr: number, value: number) => void;
}

function float32ToUint32(val: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, val);
  return new DataView(buf).getUint32(0);
}

function uint32ToFloat32(val: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, val >>> 0);
  return new DataView(buf).getFloat32(0);
}

function float64ToUint64(val: number): [number, number] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, val);
  return [
    new DataView(buf).getUint32(0),
    new DataView(buf).getUint32(4),
  ];
}

function uint64ToFloat64(high: number, low: number): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, high >>> 0);
  view.setUint32(4, low >>> 0);
  return view.getFloat64(0);
}

export function DataGrid({ data, startAddr, quantity, displayFormat, byteOrder, signed, currentPage, totalPages, onPageChange, editable = false, onCellChange }: DataGridProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);
  const [editingCell, setEditingCell] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Grid dimensions based on display format
  // For 32-bit storage: each array element is one 32-bit value
  // FLT: 16 rows x 4 cols = 64 cells/page (each cell = 1 float32)
  // DBL: 8 rows x 4 cols = 32 cells/page (each cell = 1 float64 = 2 array elements)
  // HEX/DEC/BIN: 16 rows x 8 cols = 128 cells/page (each cell = 1 uint32)
  const isDBL = displayFormat === 'dbl';
  const isBinOrFlt = displayFormat === 'bin' || displayFormat === 'flt';
  
  const rows = isDBL ? 8 : 16;
  const cols = (isDBL || isBinOrFlt) ? 4 : 8;
  // For DBL, each cell uses 2 array elements (64-bit = 2 x 32-bit)
  const cellsPerPage = rows * cols;
  const elementsPerPage = isDBL ? cellsPerPage * 2 : cellsPerPage;

  // Page start address: starts from the input startAddr, not from 0
  const pageStartAddr = startAddr + currentPage * elementsPerPage;

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
    // Calculate address: column-major order
    // Address = pageStartAddr + col * 16 + row (for 16-row modes)
    // For DBL (8 rows): Address = pageStartAddr + col * 16 + row * 2
    const rowOffset = isDBL ? row * 2 : row;
    const actualAddr = pageStartAddr + col * 16 + rowOffset;
    const relAddr = actualAddr - startAddr;
    
    if (relAddr < 0 || relAddr >= quantity) return '--';
    if (relAddr >= data.length) return '--';

    const val = data[relAddr];

    switch (displayFormat) {
      case 'hex': {
        // Apply byte order for display
        const displayVal = byteOrder === 'BE' ? swapBytes32(val) : val;
        return formatHex(displayVal);
      }
      case 'dec': {
        // Apply byte order for display
        const displayVal = byteOrder === 'BE' ? swapBytes32(val) : val;
        if (!signed) return displayVal.toString();
        return displayVal > 2147483647 ? (displayVal - 4294967296).toString() : displayVal.toString();
      }
      case 'bin': {
        const displayVal = byteOrder === 'BE' ? swapBytes32(val) : val;
        return formatBinary(displayVal);
      }
      case 'flt': {
        // Interpret 32-bit value as float32
        const f = uint32ToFloat32(val);
        return f.toFixed(4);
      }
      case 'dbl': {
        // Combine two consecutive 32-bit values into float64
        if (relAddr + 1 >= data.length || relAddr + 1 >= quantity) return '--';
        const d = uint64ToFloat64(val, data[relAddr + 1]);
        return d.toFixed(6);
      }
      default:
        return val.toString();
    }
  }, [data, startAddr, quantity, displayFormat, byteOrder, signed, pageStartAddr, isDBL]);

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
    const displayVal = byteOrder === 'BE' ? swapBytes32(val) : val;
    const decVal = signed && displayVal > 2147483647 ? displayVal - 4294967296 : displayVal;
    const hexVal = formatHex(displayVal);
    const binVal = formatBinary(displayVal);

    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
        <div><span className="text-muted-foreground">{t('dataGrid.decimal')}:</span> {decVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.hex')}:</span> {hexVal}</div>
        <div><span className="text-muted-foreground">{t('dataGrid.binary')}:</span> {binVal}</div>
        <div><span className="text-muted-foreground">FLT:</span> {uint32ToFloat32(val).toFixed(4)}</div>
        {relAddr + 1 < data.length && relAddr + 1 < quantity && (
          <div><span className="text-muted-foreground">DBL:</span> {uint64ToFloat64(val, data[relAddr + 1]).toFixed(6)}</div>
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

  const getCellAddress = useCallback((row: number, col: number): number => {
    const rowOffset = isDBL ? row * 2 : row;
    return pageStartAddr + col * 16 + rowOffset;
  }, [pageStartAddr, isDBL]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!editable) return;
    const addr = getCellAddress(row, col);
    const relAddr = addr - startAddr;
    if (relAddr < 0 || relAddr >= quantity) return;
    
    const currentVal = relAddr < data.length ? data[relAddr] : 0;
    setEditingCell(addr);
    // Show hex format for editing
    setEditValue(formatHex(currentVal));
  }, [editable, getCellAddress, startAddr, quantity, data]);

  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  }, []);

  const handleEditBlur = useCallback(() => {
    if (editingCell !== null) {
      const num = parseInputValue(editValue);
      if (onCellChange) {
        onCellChange(editingCell, num);
      }
      setEditingCell(null);
      setEditValue('');
    }
  }, [editingCell, editValue, onCellChange]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    }
  }, [handleEditBlur]);

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
                const addr = getCellAddress(row, col);
                const relAddr = addr - startAddr;
                const isEditable = editable && relAddr >= 0 && relAddr < quantity;
                const isEditing = editingCell === addr;
                const isHighlighted = cellValue !== '--';
                return (
                  <div
                    key={col}
                    className={`border-b border-border p-1 text-center text-xs font-mono truncate flex items-center justify-center ${
                      isEditable ? 'cursor-text' : 'cursor-pointer'
                    } transition-colors hover:bg-accent ${
                      isHighlighted ? 'text-primary' : 'text-muted-foreground'
                    } ${isEditing ? 'bg-accent' : ''}`}
                    onMouseEnter={(e) => !isEditing && handleCellHover(row, col, e)}
                    onMouseLeave={handleCellLeave}
                    onClick={() => handleCellClick(row, col)}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={handleEditChange}
                        onBlur={handleEditBlur}
                        onKeyDown={handleEditKeyDown}
                        className="w-full bg-background border border-primary text-primary text-center text-xs font-mono outline-none"
                        autoFocus
                      />
                    ) : (
                      <span>{cellValue}</span>
                    )}
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
            className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('dataGrid.prevPage')}
          </button>
          <span className="text-muted-foreground">
            {t('dataGrid.page')} {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('dataGrid.nextPage')}
          </button>
        </div>
        <div className="text-muted-foreground">
          {elementsPerPage} {t('dataGrid.regsPerPage')}
        </div>
      </div>
    </div>
  );
}

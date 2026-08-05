'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayFormat, ByteOrder } from '@/types/modbus';

const HEX_CHARS = '0123456789ABCDEF';

function getHexDigit(addr: number, position: number): string {
  // position: 0 = lowest nibble (D), 1 = second lowest (C), etc.
  return HEX_CHARS[(addr >> (position * 4)) & 0xF];
}

function formatBinary16(val: number): string {
  return '0b' + val.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim();
}

function formatBinary32(val: number): string {
  return '0b' + val.toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim();
}

function formatHex16(val: number): string {
  return '0x' + val.toString(16).toUpperCase().padStart(4, '0');
}

function formatHex32(val: number): string {
  return '0x' + val.toString(16).toUpperCase().padStart(8, '0');
}

function formatAddress(addr: number): string {
  return addr.toString().padStart(5, '0');
}

function formatHexAddress(addr: number): string {
  return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
}

// Combine two 16-bit registers into a 32-bit value based on byte order
function combineRegs32(low: number, high: number, byteOrder: ByteOrder): number {
  if (byteOrder === 'LE') {
    return (high << 16) | low;
  }
  return (low << 16) | high;
}

// Combine four 16-bit registers into a 64-bit value (as two 32-bit halves)
function combineRegs64(regs: number[], byteOrder: ByteOrder): [number, number] {
  // regs[0], regs[1], regs[2], regs[3]
  if (byteOrder === 'LE') {
    // LE: regs[0]=low16, regs[1]=high16 of low32; regs[2]=low16, regs[3]=high16 of high32
    const low32 = (regs[1] << 16) | regs[0];
    const high32 = (regs[3] << 16) | regs[2];
    return [low32, high32];
  }
  // BE: regs[0]=high16, regs[1]=low16 of high32; regs[2]=high16, regs[3]=low16 of low32
  const high32 = (regs[0] << 16) | regs[1];
  const low32 = (regs[2] << 16) | regs[3];
  return [low32, high32];
}

// Parse input value: supports binary (0b...), hex (0x...), and signed decimal
function parseInputValue(input: string, bits: number = 16): number {
  const trimmed = input.trim();
  const maxVal = bits === 16 ? 0xFFFF : 0xFFFFFFFF;
  
  // Binary with spaces: "0b0000 0000 1001 1010"
  if (trimmed.startsWith('0b') || trimmed.startsWith('0B')) {
    const binStr = trimmed.slice(2).replace(/\s+/g, '');
    const val = parseInt(binStr, 2);
    return isNaN(val) ? 0 : Math.min(Math.max(val, 0), maxVal);
  }
  
  // Hex: "0xABCd" (case-insensitive)
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    const val = parseInt(trimmed.slice(2), 16);
    return isNaN(val) ? 0 : Math.min(Math.max(val, 0), maxVal);
  }
  
  // Signed decimal: "-123"
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) return 0;
  if (bits === 16) {
    // 16-bit signed: -32768 to 32767, stored as unsigned 0-65535
    if (num < -32768) return 0;
    if (num > 32767) return 0xFFFF;
    return num < 0 ? num + 65536 : num;
  }
  // 32-bit: clamp to valid range
  if (num < 0) return 0;
  if (num > maxVal) return maxVal;
  return num;
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

function uint64ToFloat64(low: number, high: number): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, low >>> 0);
  view.setUint32(4, high >>> 0);
  return view.getFloat64(0);
}

export function DataGrid({ data, startAddr, quantity, displayFormat, byteOrder, signed, currentPage, totalPages, onPageChange, editable = false, onCellChange }: DataGridProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);
  const [editingCell, setEditingCell] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Grid dimensions based on display format
  // Data array stores 16-bit register values
  // HEX/DEC: 1 register per cell, 16x8 = 128 cells/page
  // BIN: 1 register per cell, 16x4 = 64 cells/page
  // FLT: 2 registers per cell, 8x4 = 32 cells/page (double height)
  const isFlt = displayFormat === 'flt';
  const isBin = displayFormat === 'bin';
  const isHexOrDec = displayFormat === 'hex' || displayFormat === 'dec';
  
  const rows = isFlt ? 8 : 16;
  const cols = isFlt ? 4 : (isBin ? 4 : 8);
  const regsPerCell = isFlt ? 2 : 1;
  const cellsPerPage = rows * cols;
  const regsPerPage = cellsPerPage * regsPerCell;

  // Page start address: starts from the input startAddr, not from 0
  const pageStartAddr = startAddr + currentPage * regsPerPage;

  // Generate row headers: start from D (last hex digit of startAddr), increment
  const rowHeaders = useMemo(() => {
    const d = startAddr & 0xF;
    return Array.from({ length: rows }, (_, i) => {
      if (isFlt) {
        // For FLT: D, F, 1, 3, 5, 7, 9, B (step by 2)
        return HEX_CHARS[(d + i * 2) % 16];
      }
      return HEX_CHARS[(d + i) % 16];
    });
  }, [startAddr, rows, isFlt]);

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
    // For FLT (8 rows): Address = pageStartAddr + col * 16 + row * 2
    const rowOffset = isFlt ? row * 2 : row;
    const actualAddr = pageStartAddr + col * 16 + rowOffset;
    const relAddr = actualAddr - startAddr;
    
    if (relAddr < 0 || relAddr >= quantity) return '--';
    if (relAddr >= data.length) return '--';

    switch (displayFormat) {
      case 'bin': {
        // 16-bit binary
        const val = data[relAddr];
        return formatBinary16(val);
      }
      case 'hex': {
        // 16-bit hex
        const val = data[relAddr];
        return formatHex16(val);
      }
      case 'dec': {
        // 16-bit decimal
        const val = data[relAddr];
        if (!signed) return val.toString();
        return val > 32767 ? (val - 65536).toString() : val.toString();
      }
      case 'flt': {
        // 32-bit float (combine 2 registers)
        if (relAddr + 1 >= data.length || relAddr + 1 >= quantity) return '--';
        const val32 = combineRegs32(data[relAddr], data[relAddr + 1], byteOrder);
        const f = uint32ToFloat32(val32);
        return f.toFixed(4);
      }
      default:
        return data[relAddr]?.toString() ?? '--';
    }
  }, [data, startAddr, quantity, displayFormat, byteOrder, signed, pageStartAddr, isFlt]);

  const getTooltipContent = useCallback((row: number, col: number) => {
    const rowOffset = isFlt ? row * 2 : row;
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

    const val16 = data[relAddr];
    const content = (
      <div className="text-xs space-y-1">
        <div><span className="text-muted-foreground">{t('dataGrid.address')}:</span> {decAddr} ({hexAddr})</div>
        <div><span className="text-muted-foreground">BIN:</span> {formatBinary16(val16)}</div>
        <div><span className="text-muted-foreground">HEX:</span> {formatHex16(val16)}</div>
        <div><span className="text-muted-foreground">DEC:</span> {signed && val16 > 32767 ? val16 - 65536 : val16}</div>
        {relAddr + 1 < data.length && relAddr + 1 < quantity && (() => {
          const val32 = combineRegs32(data[relAddr], data[relAddr + 1], byteOrder);
          return (
            <div><span className="text-muted-foreground">FLT:</span> {uint32ToFloat32(val32).toFixed(4)}</div>
          );
        })()}
      </div>
    );

    return content;
  }, [data, startAddr, quantity, pageStartAddr, byteOrder, signed, isFlt, t]);

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
    const rowOffset = isFlt ? row * 2 : row;
    return pageStartAddr + col * 16 + rowOffset;
  }, [pageStartAddr, isFlt]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!editable) return;
    const addr = getCellAddress(row, col);
    const relAddr = addr - startAddr;
    if (relAddr < 0 || relAddr >= quantity) return;
    
    const currentVal = relAddr < data.length ? data[relAddr] : 0;
    setEditingCell(addr);
    // Show hex format for editing
    setEditValue(formatHex16(currentVal));
  }, [editable, getCellAddress, startAddr, quantity, data]);

  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  }, []);

  const handleEditBlur = useCallback(() => {
    if (editingCell !== null) {
      const num = parseInputValue(editValue, 16);
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
            gridTemplateRows: isFlt 
              ? `24px repeat(${rows}, 48px)` // FLT: header normal (24px), data rows 2x (48px)
              : `24px repeat(${rows}, 24px)`, // Other modes: all rows normal (24px)
          }}
        >
          {/* Header row */}
          <div className="bg-panel border-b border-r border-border flex items-center justify-center text-xs font-mono text-muted-foreground">
            
          </div>
          {colHeaders.map((h, i) => (
            <div key={i} className="bg-panel border-b border-border flex items-center justify-center text-xs font-mono text-accent">
              {h}
            </div>
          ))}

          {/* Data rows */}
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="contents">
              <div className="bg-panel border-r border-border flex items-center justify-center text-xs font-mono text-accent">
                {rowHeaders[row]}
              </div>
              {Array.from({ length: cols }, (_, col) => {
                const cellValue = getCellValue(row, col);
                const addr = getCellAddress(row, col);
                const relAddr = addr - startAddr;
                const isEditing = editingCell === addr;
                const inRange = relAddr >= 0 && relAddr < quantity;

                return (
                  <div
                    key={col}
                    className={`border-b border-r border-border flex items-center justify-center text-xs font-mono transition-colors ${
                      inRange
                        ? editable
                          ? 'cursor-text hover:bg-accent/20'
                          : 'cursor-default hover:bg-accent/10'
                        : 'bg-muted/30 text-muted-foreground'
                    } ${isFlt ? 'text-base' : ''}`}
                    style={isFlt ? { minHeight: '48px' } : {}}
                    onClick={() => handleCellClick(row, col)}
                    onMouseEnter={(e) => handleCellHover(row, col, e)}
                    onMouseLeave={handleCellLeave}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={handleEditChange}
                        onBlur={handleEditBlur}
                        onKeyDown={handleEditKeyDown}
                        className="w-full h-full bg-input text-foreground px-1 text-xs font-mono outline-none border border-accent"
                        autoFocus
                      />
                    ) : (
                      <span className={cellValue === '--' ? 'text-muted-foreground' : 'text-foreground'}>
                        {cellValue}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <div>{t('dataGrid.page')} {currentPage + 1} / {totalPages}</div>
        <div>{regsPerPage} {t('dataGrid.regsPerPage')}</div>
        <div className="flex gap-1">
          <button
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('dataGrid.prevPage')}
          </button>
          <button
            onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('dataGrid.nextPage')}
          </button>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-panel border border-border rounded px-2 py-1.5 shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid } from './DataGrid';
import type { ReadResult, DisplayFormat, ByteOrder } from '@/types/modbus';

const FC_NAMES: Record<number, string> = {
  1: 'FC01 - Read Coils',
  2: 'FC02 - Read Discrete Inputs',
  3: 'FC03 - Read Holding Registers',
  4: 'FC04 - Read Input Registers',
  5: 'FC05 - Write Single Coil',
  6: 'FC06 - Write Single Register',
  15: 'FC15 - Write Multiple Coils',
  16: 'FC16 - Write Multiple Registers',
};

const READ_FCS = [1, 2, 3, 4];
const WRITE_FCS = [5, 6, 15, 16];
const ALL_FCS = [...READ_FCS, ...WRITE_FCS];

function isReadFC(fc: number): boolean {
  return READ_FCS.includes(fc);
}

interface DataPanelProps {
  onRead: (functionCode: number, address: number, quantity: number) => Promise<ReadResult | null>;
  onWrite: (functionCode: number, address: number, values: number[] | boolean[]) => Promise<boolean>;
}

interface TabData {
  functionCode: number;
  startAddr: number;
  quantity: number;
  writeValue: string;
  data: number[];
  isPolling: boolean;
  pollInterval: number;
}

export function DataPanel({ onRead, onWrite }: DataPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0);
  const [tabs, setTabs] = useState<TabData[]>([
    { functionCode: 3, startAddr: 0, quantity: 128, writeValue: '0', data: [], isPolling: false, pollInterval: 1000 },
  ]);

  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [byteOrder, setByteOrder] = useState<ByteOrder>(() => {
    if (typeof window === 'undefined') return 'LE';
    return (localStorage.getItem('modbus-byte-order') as ByteOrder) || 'LE';
  });
  const [signed, setSigned] = useState(() => {
    if (typeof window === 'undefined') return true;
    const v = localStorage.getItem('modbus-signed');
    return v === null ? true : v === 'true';
  });
  const [currentPage, setCurrentPage] = useState(0);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    localStorage.setItem('modbus-byte-order', byteOrder);
  }, [byteOrder]);

  useEffect(() => {
    localStorage.setItem('modbus-signed', signed.toString());
  }, [signed]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  const currentTab = tabs[activeTab];
  const isRead = isReadFC(currentTab.functionCode);

  const updateTab = useCallback((index: number, updates: Partial<TabData>) => {
    setTabs((prev) => prev.map((tab, i) => (i === index ? { ...tab, ...updates } : tab)));
  }, []);

  const handleExecute = useCallback(async () => {
    if (isRead) {
      const result = await onRead(currentTab.functionCode, currentTab.startAddr, currentTab.quantity);
      if (result) {
        const numValues = result.values.filter((v): v is number => typeof v === 'number');
        updateTab(activeTab, { data: numValues });
        // Jump to page containing startAddr
        const page = Math.floor(currentTab.startAddr / 128);
        setCurrentPage(page);
      }
    } else {
      // Write operation
      const values = currentTab.writeValue.split(',').map((v) => {
        const num = parseInt(v.trim());
        return isNaN(num) ? 0 : num;
      });
      await onWrite(currentTab.functionCode, currentTab.startAddr, values);
    }
  }, [onRead, onWrite, currentTab, activeTab, updateTab, isRead]);

  const handleStartPolling = useCallback(() => {
    if (!isRead) return;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    updateTab(activeTab, { isPolling: true });

    handleExecute();
    pollingRef.current = setInterval(() => {
      handleExecute();
    }, currentTab.pollInterval);
  }, [handleExecute, activeTab, currentTab.pollInterval, updateTab, isRead]);

  const handleStopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    updateTab(activeTab, { isPolling: false });
  }, [activeTab, updateTab]);

  const addTab = useCallback(() => {
    const newTab: TabData = { functionCode: 3, startAddr: 0, quantity: 128, writeValue: '0', data: [], isPolling: false, pollInterval: 1000 };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(tabs.length);
  }, [tabs.length]);

  const removeTab = useCallback((index: number) => {
    if (tabs.length <= 1) return;
    setTabs((prev) => prev.filter((_, i) => i !== index));
    setActiveTab((prev) => Math.max(0, prev > index ? prev - 1 : prev));
  }, [tabs.length]);

  // Calculate total pages based on display format
  const getCellsPerPage = () => {
    if (displayFormat === 'dbl') return 32; // 8 rows x 4 cols
    if (displayFormat === 'bin' || displayFormat === 'flt') return 64; // 16 rows x 4 cols
    return 128; // 16 rows x 8 cols (hex/dec)
  };

  const cellsPerPage = getCellsPerPage();
  const totalPages = Math.ceil(65536 / cellsPerPage);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 border-b border-border pb-2">
        {tabs.map((tab, index) => (
          <div key={index} className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab(index)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === index
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-panel hover:bg-accent'
              }`}
            >
              {FC_NAMES[tab.functionCode] || `FC${tab.functionCode}`}
            </button>
            {tabs.length > 1 && (
              <button
                onClick={() => removeTab(index)}
                className="text-muted-foreground hover:text-destructive text-xs"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="px-2 py-1 text-xs bg-panel hover:bg-accent rounded"
        >
          +
        </button>
      </div>

      {/* Function Code Radio Buttons */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-2 block">{t('dataPanel.functionCode')}</label>
        <div className="flex flex-wrap gap-2">
          {ALL_FCS.map((fc) => (
            <label key={fc} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`fc-${activeTab}`}
                value={fc}
                checked={currentTab.functionCode === fc}
                onChange={() => updateTab(activeTab, { functionCode: fc })}
                className="w-3 h-3"
              />
              <span className="text-xs">{FC_NAMES[fc]}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Address/Quantity/Value Config */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('readPanel.startAddr')}</label>
          <input
            type="number"
            value={currentTab.startAddr}
            onChange={(e) => updateTab(activeTab, { startAddr: parseInt(e.target.value) || 0 })}
            className="w-full px-2 py-1 bg-panel border border-border rounded text-xs"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('readPanel.quantity')}</label>
          <input
            type="number"
            value={currentTab.quantity}
            onChange={(e) => updateTab(activeTab, { quantity: parseInt(e.target.value) || 1 })}
            className="w-full px-2 py-1 bg-panel border border-border rounded text-xs"
          />
        </div>
        {!isRead && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('writePanel.value')}</label>
            <input
              type="text"
              value={currentTab.writeValue}
              onChange={(e) => updateTab(activeTab, { writeValue: e.target.value })}
              placeholder="0,1,2,..."
              className="w-full px-2 py-1 bg-panel border border-border rounded text-xs"
            />
          </div>
        )}
        <div className="flex items-end">
          <button
            onClick={handleExecute}
            disabled={currentTab.isPolling}
            className={`w-full px-4 py-1 text-white rounded text-xs font-medium disabled:opacity-50 ${
              isRead ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {isRead ? t('readPanel.read') : t('writePanel.write')}
          </button>
        </div>
      </div>

      {/* Auto Polling (only for read) */}
      {isRead && (
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('readPanel.interval')}:</span>
            <input
              type="number"
              value={currentTab.pollInterval}
              onChange={(e) => updateTab(activeTab, { pollInterval: parseInt(e.target.value) || 1000 })}
              className="w-20 px-2 py-1 bg-panel border border-border rounded text-xs"
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
          {currentTab.isPolling ? (
            <button
              onClick={handleStopPolling}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
            >
              {t('readPanel.stop')}
            </button>
          ) : (
            <button
              onClick={handleStartPolling}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs"
            >
              {t('readPanel.start')}
            </button>
          )}
        </div>
      )}

      {/* Format Selection */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
        <div className="flex items-center gap-1">
          {(['hex', 'dec', 'bin', 'flt', 'dbl'] as DisplayFormat[]).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setDisplayFormat(fmt)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                displayFormat === fmt
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-panel hover:bg-accent'
              }`}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={() => setSigned(!signed)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              signed ? 'bg-primary text-primary-foreground' : 'bg-panel hover:bg-accent'
            }`}
          >
            {signed ? 'S' : 'U'}
          </button>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <select
            value={byteOrder}
            onChange={(e) => setByteOrder(e.target.value as ByteOrder)}
            className="px-2 py-1 bg-panel border border-border rounded text-xs"
          >
            <option value="LE">ABCD (LE)</option>
            <option value="BE">DCBA (BE)</option>
          </select>
        </div>
      </div>

      {/* Data Grid */}
      {isRead && (
        <DataGrid
          data={currentTab.data}
          startAddr={currentTab.startAddr}
          quantity={currentTab.quantity}
          displayFormat={displayFormat}
          byteOrder={byteOrder}
          signed={signed}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid } from './DataGrid';
import type { ReadResult, DisplayFormat, ByteOrder } from '@/types/modbus';

const FC_NAMES: Record<number, { en: string; zh: string }> = {
  1: { en: 'FC01 - Read Coils', zh: 'FC01 - 读线圈' },
  2: { en: 'FC02 - Read Discrete Inputs', zh: 'FC02 - 读离散输入' },
  3: { en: 'FC03 - Read Holding Registers', zh: 'FC03 - 读保持寄存器' },
  4: { en: 'FC04 - Read Input Registers', zh: 'FC04 - 读输入寄存器' },
  5: { en: 'FC05 - Write Single Coil', zh: 'FC05 - 写单个线圈' },
  6: { en: 'FC06 - Write Single Register', zh: 'FC06 - 写单个寄存器' },
  15: { en: 'FC15 - Write Multiple Coils', zh: 'FC15 - 写多个线圈' },
  16: { en: 'FC16 - Write Multiple Registers', zh: 'FC16 - 写多个寄存器' },
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
  customName?: string;
}

function getFCName(fc: number, lang: string): string {
  const names = FC_NAMES[fc];
  if (!names) return `FC${fc}`;
  return lang === 'zh' ? names.zh : names.en;
}

export function DataPanel({ onRead, onWrite }: DataPanelProps) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language?.startsWith('zh') ? 'zh' : 'en';
  const [activeTab, setActiveTab] = useState(0);
  const [tabs, setTabs] = useState<TabData[]>([
    { functionCode: 3, startAddr: 0, quantity: 128, writeValue: '0', data: [], isPolling: false, pollInterval: 1000 },
  ]);

  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('hex');
  const [byteOrder, setByteOrder] = useState<ByteOrder>('LE');
  const [signed, setSigned] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  // Load from localStorage after mount (avoid hydration mismatch)
  useEffect(() => {
    const savedByteOrder = localStorage.getItem('modbus-byte-order');
    if (savedByteOrder) setByteOrder(savedByteOrder as ByteOrder);
    const savedSigned = localStorage.getItem('modbus-signed');
    if (savedSigned !== null) setSigned(savedSigned === 'true');
  }, []);

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
  
  const isRead = currentTab ? isReadFC(currentTab.functionCode) : true;

  const updateTab = useCallback((index: number, updates: Partial<TabData>) => {
    setTabs((prev) => prev.map((tab, i) => (i === index ? { ...tab, ...updates } : tab)));
  }, []);

  const handleExecute = useCallback(async () => {
    if (!currentTab) return;
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
    if (!isRead || !currentTab) return;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    updateTab(activeTab, { isPolling: true });

    handleExecute();
    pollingRef.current = setInterval(() => {
      handleExecute();
    }, currentTab.pollInterval);
  }, [handleExecute, activeTab, currentTab, updateTab, isRead]);

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

  const getTabName = useCallback((tab: TabData) => {
    if (tab.customName) return tab.customName;
    const fcName = getFCName(tab.functionCode, currentLang);
    return `${fcName} @${tab.startAddr} [${displayFormat.toUpperCase()}]`;
  }, [currentLang, displayFormat]);

  const handleTabNameEdit = useCallback((index: number, name: string) => {
    updateTab(index, { customName: name || undefined });
  }, [updateTab]);

  const removeTab = useCallback((index: number) => {
    if (tabs.length <= 1) return;
    setTabs((prev) => {
      const newTabs = prev.filter((_, i) => i !== index);
      // Fix activeTab index after removal
      setActiveTab((prevActive) => {
        if (prevActive > index) return prevActive - 1;
        if (prevActive >= newTabs.length) return newTabs.length - 1;
        return prevActive;
      });
      return newTabs;
    });
  }, [tabs.length]);
  
  // Guard against undefined currentTab (e.g., after deleting a tab)
  if (!currentTab) {
    return <div className="bg-card border border-border rounded-lg p-4 text-center text-muted-foreground">No tabs available</div>;
  }

  // Calculate total pages based on display format and quantity
  const getCellsPerPage = () => {
    if (displayFormat === 'dbl') return 32; // 8 rows x 4 cols
    if (displayFormat === 'bin' || displayFormat === 'flt') return 64; // 16 rows x 4 cols
    return 128; // 16 rows x 8 cols (hex/dec)
  };

  const cellsPerPage = getCellsPerPage();
  // Total cells: for DBL = floor(quantity/2), for others = quantity
  const totalCells = displayFormat === 'dbl' ? Math.floor(currentTab.quantity / 2) : currentTab.quantity;
  const totalPages = Math.max(1, Math.ceil(totalCells / cellsPerPage));

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
              title={getTabName(tab)}
            >
              {tab.customName || `FC${tab.functionCode}`}
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
        {/* Tab name editor */}
        {currentTab && (
          <input
            type="text"
            value={currentTab.customName || ''}
            onChange={(e) => handleTabNameEdit(activeTab, e.target.value)}
            placeholder={getTabName(currentTab)}
            className="ml-4 px-2 py-1 bg-panel border border-border rounded text-xs w-48"
          />
        )}
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
              <span className="text-xs">{getFCName(fc, currentLang)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Address/Quantity/Value Config */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('readPanel.startAddr')}</label>
          <input
            type="text"
            value={currentTab.startAddr.toString()}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                updateTab(activeTab, { startAddr: 0 });
              } else {
                const num = parseInt(val);
                if (!isNaN(num)) updateTab(activeTab, { startAddr: num });
              }
            }}
            className="w-full px-2 py-1 bg-panel border border-border rounded text-xs"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('readPanel.quantity')}</label>
          <input
            type="text"
            value={currentTab.quantity.toString()}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                updateTab(activeTab, { quantity: 1 });
              } else {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0) updateTab(activeTab, { quantity: num });
              }
            }}
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
              type="text"
              value={currentTab.pollInterval.toString()}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  updateTab(activeTab, { pollInterval: 1000 });
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num) && num > 0) updateTab(activeTab, { pollInterval: num });
                }
              }}
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
            className="px-2 py-1 bg-card border border-border rounded text-xs text-foreground"
          >
            <option value="LE" className="bg-card text-foreground">ABCD (LE)</option>
            <option value="BE" className="bg-card text-foreground">DCBA (BE)</option>
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

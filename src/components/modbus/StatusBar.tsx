'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/i18n';
import type { ConnectionConfig, ByteOrder } from '@/types/modbus';

interface StatusBarProps {
  isConnected: boolean;
  isConnecting: boolean;
  connectionConfig: ConnectionConfig | null;
  isPolling: boolean;
  pollInterval: number;
  lastReadTime: number | null;
  defaultByteOrder: ByteOrder;
  defaultSigned: boolean;
  onSettingsChange: (byteOrder: ByteOrder, signed: boolean) => void;
}

export function StatusBar({
  isConnected,
  isConnecting,
  connectionConfig,
  isPolling,
  pollInterval,
  lastReadTime,
  defaultByteOrder,
  defaultSigned,
  onSettingsChange,
}: StatusBarProps) {
  const { t } = useTranslation();
  const { lang, changeLanguage } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  const protocolLabels: Record<string, string> = {
    tcp: 'TCP/IP',
    udp: 'UDP/IP',
    rtu_tcp: 'RTU over TCP/IP',
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-panel border-b border-border gap-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isConnecting ? 'bg-blue-500 animate-pulse' :
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {isConnected ? t('status.online') : t('status.offline')}
          </span>
        </div>

        {connectionConfig && (
          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
            <span>{protocolLabels[connectionConfig.protocol || 'tcp']}</span>
            <span>{connectionConfig.host}:{connectionConfig.port}</span>
            <span>UID:{connectionConfig.unitId}</span>
          </div>
        )}

        {isPolling && (
          <div className="flex items-center gap-1 text-xs font-mono">
            <span className="text-primary animate-pulse">●</span>
            <span className="text-muted-foreground">POLL {pollInterval}ms</span>
          </div>
        )}

        {lastReadTime && (
          <span className="text-xs font-mono text-muted-foreground">
            LAST: {new Date(lastReadTime).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="px-2 py-1 text-xs font-mono border border-border rounded-sm hover:bg-secondary hover:text-primary transition-colors"
          title={t('settings.title')}
        >
          ⚙
        </button>
        <button
          onClick={() => changeLanguage(lang === 'zh' ? 'en' : 'zh')}
          className="px-2 py-1 text-xs font-mono border border-border rounded-sm hover:bg-secondary hover:text-primary transition-colors w-[52px] text-center"
        >
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSettings(false)}>
          <div className="bg-card border border-border rounded-lg p-6 min-w-[300px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t('settings.title')}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.byteOrder')}</label>
                <select
                  value={defaultByteOrder}
                  onChange={(e) => onSettingsChange(e.target.value as ByteOrder, defaultSigned)}
                  className="w-full px-3 py-2 bg-panel border border-border rounded text-sm"
                >
                  <option value="LE">ABCD (Little Endian)</option>
                  <option value="BE">DCBA (Big Endian)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.signed')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="signed"
                      checked={defaultSigned}
                      onChange={() => onSettingsChange(defaultByteOrder, true)}
                      className="radio-primary"
                    />
                    <span className="text-sm">S - {t('settings.signedLabel')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="signed"
                      checked={!defaultSigned}
                      onChange={() => onSettingsChange(defaultByteOrder, false)}
                      className="radio-primary"
                    />
                    <span className="text-sm">U - {t('settings.unsignedLabel')}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

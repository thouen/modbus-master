'use client';

import { useTranslation } from 'react-i18next';
import { useI18n } from '@/lib/i18n';
import type { ConnectionConfig } from '@/types/modbus';

interface StatusBarProps {
  isConnected: boolean;
  isConnecting: boolean;
  connectionConfig: ConnectionConfig | null;
  isPolling: boolean;
  pollInterval: number;
  lastReadTime: number | null;
}

export function StatusBar({
  isConnected,
  isConnecting,
  connectionConfig,
  isPolling,
  pollInterval,
  lastReadTime,
}: StatusBarProps) {
  const { t } = useTranslation();
  const { lang, changeLanguage } = useI18n();

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
          onClick={() => changeLanguage(lang === 'zh' ? 'en' : 'zh')}
          className="px-2 py-1 text-xs font-mono border border-border rounded-sm hover:bg-secondary hover:text-primary transition-colors w-[52px] text-center"
        >
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>
    </div>
  );
}

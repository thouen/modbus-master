'use client';

import { I18nProvider, useI18n } from '@/hooks/use-i18n';
import { AppProvider, useAppState } from '@/hooks/use-app-state';
import { usePolling } from '@/components/register-tab-manager';
import { ConnectionPanel } from '@/components/connection-panel';
import { RegisterTabManager } from '@/components/register-tab-manager';
import { LogViewer } from '@/components/log-viewer';
import { Button } from '@/components/ui/button';
import { Cpu } from 'lucide-react';

function AppContent() {
  const { t, locale, setLocale } = useI18n();
  usePolling();

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5 text-primary" />
            </div>
            <h1 className="text-sm font-bold text-foreground tracking-wide">{t('appTitle')}</h1>
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">{t('appSubtitle')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] px-2"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </Button>
        </div>
      </header>

      {/* Main content area: left connections + right (tabs+table+logs) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: connection panel (always visible) */}
        <div className="w-70 shrink-0 bg-surface border-r border-border overflow-hidden">
          <ConnectionPanel />
        </div>

        {/* Right: tabs + config + table + logs */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <RegisterTabManager />
          </div>
          <div className="h-56 min-h-[140px] max-h-[40vh] border-t border-border overflow-hidden shrink-0">
            <LogViewer />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const { state } = useAppState();
  const { t } = useI18n();
  const connectedCount = Object.values(state.connectionStatus).filter(s => s === 'connected').length;
  const pollingCount = state.tabs.filter(t => t.isPolling).length;

  return (
    <footer className="flex items-center justify-between px-4 py-1 border-t border-border bg-surface text-[10px] text-muted-foreground shrink-0">
      <div className="flex items-center gap-4">
        <span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
            connectedCount > 0 ? 'bg-green-500' : 'bg-zinc-600'
          }`} />
          {connectedCount} {t('connectedDevice')}
        </span>
        <span>{state.connections.length} {t('connections')}</span>
        <span>{state.tabs.length} {t('tabs')}</span>
        {pollingCount > 0 && (
          <span className="text-amber-400">
            {pollingCount} {t('polling')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span>ModBus TCP/Serial</span>
        <span>ASCII/RTU</span>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <I18nProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </I18nProvider>
  );
}

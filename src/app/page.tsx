'use client';

import { useState } from 'react';
import { I18nProvider, useI18n } from '@/hooks/use-i18n';
import { AppProvider, useAppState } from '@/hooks/use-app-state';
import { usePolling } from '@/components/register-tab-manager';
import { ConnectionPanel } from '@/components/connection-panel';
import { RegisterTabManager } from '@/components/register-tab-manager';
import { LogViewer } from '@/components/log-viewer';
import { ProfileManager } from '@/components/profile-manager';
import { Button } from '@/components/ui/button';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

type SidePanel = 'connections' | 'profiles' | null;

function AppContent() {
  const { t, locale, setLocale } = useI18n();
  const [sidePanel, setSidePanel] = useState<SidePanel>('connections');
  const [showLogPanel, setShowLogPanel] = useState(true);
  usePolling();

  const togglePanel = (panel: SidePanel) => {
    setSidePanel(prev => prev === panel ? null : panel);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-[#0f1319] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
            <h1 className="text-sm font-bold text-foreground tracking-wide">{t('appTitle')}</h1>
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">{t('appSubtitle')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={sidePanel === 'connections' ? 'secondary' : 'ghost'}
            className="h-7 text-[10px] px-2"
            onClick={() => togglePanel('connections')}
          >
            {t('connections')}
          </Button>
          <Button
            size="sm"
            variant={sidePanel === 'profiles' ? 'secondary' : 'ghost'}
            className="h-7 text-[10px] px-2"
            onClick={() => togglePanel('profiles')}
          >
            {t('profiles')}
          </Button>
          <Button
            size="sm"
            variant={showLogPanel ? 'secondary' : 'ghost'}
            className="h-7 text-[10px] px-2"
            onClick={() => setShowLogPanel(!showLogPanel)}
          >
            {t('logs')}
          </Button>
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

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left side panel */}
        {sidePanel && (
          <>
            <div className="w-[240px] shrink-0 bg-[#0f1319] border-r border-border overflow-hidden">
              {sidePanel === 'connections' && <ConnectionPanel />}
              {sidePanel === 'profiles' && <ProfileManager />}
            </div>
          </>
        )}

        {/* Center + bottom log */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={showLogPanel ? 65 : 100} minSize={30}>
              <RegisterTabManager />
            </ResizablePanel>
            {showLogPanel && (
              <>
                <ResizableHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />
                <ResizablePanel defaultSize={35} minSize={15} maxSize={60}>
                  <LogViewer />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const { state } = useAppState();
  const connectedCount = Object.values(state.connectionStatus).filter(s => s === 'connected').length;
  const pollingCount = state.tabs.filter(t => t.isPolling).length;

  return (
    <footer className="flex items-center justify-between px-4 py-1 border-t border-border bg-[#0f1319] text-[10px] text-muted-foreground shrink-0">
      <div className="flex items-center gap-4">
        <span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
            connectedCount > 0 ? 'bg-green-500' : 'bg-zinc-600'
          }`} />
          {connectedCount} connected
        </span>
        <span>{state.connections.length} connections</span>
        <span>{state.tabs.length} tabs</span>
        {pollingCount > 0 && (
          <span className="text-amber-400">
            {pollingCount} polling
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span>ModBus TCP/UDP/Serial</span>
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

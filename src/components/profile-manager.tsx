'use client';

import { useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState } from '@/hooks/use-app-state';
import type { SavedProfile } from '@/lib/modbus-types';
import { generateId } from '@/lib/modbus-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ProfileManager() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState('');

  const handleSave = () => {
    const profile: SavedProfile = {
      id: generateId(),
      name: profileName || `Profile ${state.profiles.length + 1}`,
      connections: state.connections,
      tabs: state.tabs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'SAVE_PROFILE', payload: profile });
    setProfileName('');
    setSaveDialogOpen(false);
  };

  const handleLoad = (profile: SavedProfile) => {
    dispatch({ type: 'LOAD_PROFILE', payload: profile });
  };

  const handleDelete = (id: string) => {
    dispatch({ type: 'DELETE_PROFILE', payload: id });
  };

  const handleExport = (profile: SavedProfile) => {
    const json = JSON.stringify(profile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modbus-profile-${profile.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const profile = JSON.parse(ev.target?.result as string) as SavedProfile;
          profile.id = generateId();
          profile.updatedAt = Date.now();
          dispatch({ type: 'SAVE_PROFILE', payload: profile });
        } catch {
          // Invalid JSON
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground">{t('profiles')}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setSaveDialogOpen(true)}>
            {t('saveProfile')}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={handleImport}>
            {t('importProfile')}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {state.profiles.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">{t('noProfiles')}</p>
          )}
          {state.profiles.map(profile => (
            <div
              key={profile.id}
              className="flex items-center gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{profile.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {profile.connections.length} connections, {profile.tabs.length} tabs
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => handleLoad(profile)}>
                  Load
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => handleExport(profile)}>
                  Exp
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-red-400" onClick={() => handleDelete(profile.id)}>
                  Del
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="bg-[#141922] border-border text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('saveProfile')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs text-muted-foreground">{t('profileName')}</label>
            <Input
              className="h-8 text-xs bg-background border-border mt-1"
              value={profileName}
              onChange={e => setProfileName(e.target.value)}
              placeholder="My Configuration"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => setSaveDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button size="sm" className="text-xs h-8" onClick={handleSave}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

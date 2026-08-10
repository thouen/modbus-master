'use client';

import { useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState } from '@/hooks/use-app-state';
import type { ConnectionConfig, Protocol, Mode } from '@/lib/modbus-types';
import { generateId } from '@/lib/modbus-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ConnectionPanel() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleNew = () => {
    dispatch({ type: 'SET_EDITING_CONNECTION', payload: null });
    setDialogOpen(true);
  };

  const handleEdit = (conn: ConnectionConfig) => {
    dispatch({ type: 'SET_EDITING_CONNECTION', payload: conn });
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    dispatch({ type: 'DELETE_CONNECTION', payload: id });
  };

  const handleConnect = (id: string) => {
    const currentStatus = state.connectionStatus[id];
    if (currentStatus === 'connected') {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id, status: 'disconnected' } });
    } else {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id, status: 'connecting' } });
      setTimeout(() => {
        dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id, status: 'connected' } });
      }, 1000);
    }
  };

  // Count tabs and logs per connection
  const tabCountByConn = state.tabs.reduce<Record<string, number>>((acc, tab) => {
    acc[tab.connectionId] = (acc[tab.connectionId] ?? 0) + 1;
    return acc;
  }, {});

  const logCountByConn = Object.fromEntries(
    Object.entries(state.logs).map(([connId, logs]) => [connId, logs.length])
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{t('connections')}</h2>
        <Button size="sm" variant="outline" onClick={handleNew} className="h-7 text-xs">
          + {t('newConnection')}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {state.connections.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">{t('noData')}</p>
          )}
          {state.connections.map(conn => {
            const status = state.connectionStatus[conn.id] ?? 'disconnected';
            const tabCount = tabCountByConn[conn.id] ?? 0;
            const logCount = logCountByConn[conn.id] ?? 0;
            const configDetail = conn.protocol === 'serial'
              ? `${conn.serialConfig?.port ?? '-'} @ ${conn.serialConfig?.baudRate ?? '-'}`
              : `${conn.tcpConfig?.host ?? conn.udpConfig?.host ?? '-'}:${conn.tcpConfig?.port ?? conn.udpConfig?.port ?? '-'}`;

            return (
              <div
                key={conn.id}
                className="flex flex-col gap-1 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    status === 'connected' ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]' :
                    status === 'connecting' ? 'bg-amber-500 animate-pulse' :
                    'bg-zinc-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{conn.name}</div>
                  </div>
                  <Badge variant="outline" className={`text-[9px] h-4 px-1 ${
                    status === 'connected' ? 'border-green-500/50 text-green-400' :
                    status === 'connecting' ? 'border-amber-500/50 text-amber-400' :
                    'border-zinc-600 text-zinc-500'
                  }`}>
                    {status === 'connected' ? t('connected') :
                     status === 'connecting' ? t('connecting') : t('disconnected')}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-4">
                  <span>{conn.protocol.toUpperCase()}/{conn.mode.toUpperCase()}</span>
                  <span>Slave:{conn.slaveId}</span>
                  <span className="truncate">{configDetail}</span>
                </div>
                <div className="flex items-center justify-between pl-4">
                  <div className="flex items-center gap-2 text-[9px] text-muted-foreground/60">
                    <span>{tabCount} tabs</span>
                    <span>{logCount} logs</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[9px]"
                      onClick={() => handleConnect(conn.id)}
                    >
                      {status === 'connected' ? (
                        <span className="text-red-400">{t('disconnect')}</span>
                      ) : (
                        <span className="text-green-400">{t('connect')}</span>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[9px] text-blue-400"
                      onClick={() => handleEdit(conn)}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[9px] text-red-400"
                      onClick={() => handleDelete(conn.id)}
                    >
                      {t('delete')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function ConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const editing = state.editingConnection;

  const [name, setName] = useState(editing?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(editing?.protocol ?? 'tcp');
  const [mode, setMode] = useState<Mode>(editing?.mode ?? 'rtu');
  const [slaveId, setSlaveId] = useState(editing?.slaveId ?? 1);
  const [host, setHost] = useState(editing?.tcpConfig?.host ?? '127.0.0.1');
  const [port, setPort] = useState(editing?.tcpConfig?.port ?? 502);
  const [serialPort, setSerialPort] = useState(editing?.serialConfig?.port ?? '/dev/ttyUSB0');
  const [baudRate, setBaudRate] = useState(editing?.serialConfig?.baudRate ?? 9600);

  const handleSave = () => {
    const config: ConnectionConfig = {
      id: editing?.id ?? generateId(),
      name: name || `Connection ${state.connections.length + 1}`,
      protocol,
      mode,
      slaveId,
      ...(protocol === 'serial' ? {
        serialConfig: {
          port: serialPort,
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
        },
      } : protocol === 'tcp' ? {
        tcpConfig: { host, port },
      } : {
        udpConfig: { host, port, localPort: 502 },
      }),
    };

    if (editing) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: config });
    } else {
      dispatch({ type: 'ADD_CONNECTION', payload: config });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#141922] border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {editing ? t('editConnection') : t('newConnection')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('connectionName')}</label>
            <Input
              className="h-8 text-xs bg-background border-border"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ModBus Device"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('protocol')}</label>
              <Select value={protocol} onValueChange={v => setProtocol(v as Protocol)}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="serial">{t('serial')}</SelectItem>
                  <SelectItem value="tcp">{t('tcp')}</SelectItem>
                  <SelectItem value="udp">{t('udp')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('mode')}</label>
              <Select value={mode} onValueChange={v => setMode(v as Mode)}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rtu">{t('rtu')}</SelectItem>
                  <SelectItem value="ascii">{t('ascii')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('slaveId')}</label>
            <Input
              type="number"
              className="h-8 text-xs bg-background border-border"
              value={slaveId}
              min={1}
              max={247}
              onChange={e => setSlaveId(Number(e.target.value))}
            />
          </div>
          {protocol === 'serial' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('port')}</label>
                <Input
                  className="h-8 text-xs bg-background border-border"
                  value={serialPort}
                  onChange={e => setSerialPort(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('baudRate')}</label>
                <Select value={String(baudRate)} onValueChange={v => setBaudRate(Number(v))}>
                  <SelectTrigger className="h-8 text-xs bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map(br => (
                      <SelectItem key={br} value={String(br)}>{br}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('host')}</label>
                <Input
                  className="h-8 text-xs bg-background border-border"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('port')}</label>
                <Input
                  type="number"
                  className="h-8 text-xs bg-background border-border"
                  value={port}
                  onChange={e => setPort(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button size="sm" className="text-xs h-8" onClick={handleSave}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

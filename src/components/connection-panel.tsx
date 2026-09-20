'use client';

import { useState, useRef } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppState } from '@/hooks/use-app-state';
import { useModbusWs } from '@/hooks/use-modbus-ws';
import { isBroadcastSlave, DEFAULT_AREA_TOTAL_REGISTERS, BITS_PER_REGISTER, type ConnectionConfig, type Protocol, type Mode, type ByteOrder32, type ByteOrder64, type RowNotes } from '@/lib/modbus-types';
import { generateId } from '@/lib/modbus-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Plus, Upload, Download, Pencil, Trash2, Plug, Unplug, Radio, Cable, Gauge } from 'lucide-react';

function statusColor(status: string): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]';
    case 'connecting':
      return 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)] animate-pulse';
    default:
      return 'bg-zinc-600';
  }
}

function protocolBadge(protocol: Protocol, mode: Mode): { label: string; cls: string } {
  if (protocol === 'tcp') return { label: 'TCP', cls: 'bg-blue-500/15 text-blue-400' };
  if (mode === 'ascii') return { label: 'ASCII', cls: 'bg-amber-500/15 text-amber-400' };
  return { label: 'RTU', cls: 'bg-zinc-500/15 text-zinc-400' };
}

function connTarget(conn: ConnectionConfig): string {
  if (conn.protocol === 'tcp') {
    return `${conn.tcpConfig?.host ?? '-'}:${conn.tcpConfig?.port ?? '-'}`;
  }
  return `${conn.serialConfig?.port ?? '-'}@${conn.serialConfig?.baudRate ?? '-'}`;
}

export function ConnectionPanel() {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const { connectDevice, disconnectDevice } = useModbusWs();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<ConnectionConfig | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ connections: ConnectionConfig[]; tabs: RegisterTabType[]; rowNotes: RowNotes } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleConnect = (conn: ConnectionConfig) => {
    const status = state.connectionStatus[conn.id];
    if (status === 'connected') {
      disconnectDevice(conn.id);
    } else {
      connectDevice(conn.id, conn);
    }
  };

  const handleEdit = (conn: ConnectionConfig) => {
    setEditingConn(conn);
    setDialogOpen(true);
  };

  const handleDelete = (conn: ConnectionConfig) => {
    setDeleteTarget(conn);
  };

  const handleExport = () => {
    if (state.connections.length === 0) return;
    // R4：行备注一并导出，否则"导出 → 再导入"会静默丢掉用户手录的备注
    const data = { connections: state.connections, tabs: state.tabs, rowNotes: state.rowNotes };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modbus-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.connections)) {
          setPendingImport({
            connections: parsed.connections,
            tabs: parsed.tabs ?? [],
            rowNotes: parsed.rowNotes ?? {},
          });
          setImportOpen(true);
        }
      } catch {
        /* invalid json ignored */
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ⭐ 固定高度 h-10（40px）：与标签栏、slave 侧的标题栏**四者同高**。
          ⭐ 导入/导出移到与「+」同一行（对齐 slave 的「从站管理」头部），不再占独立底栏。 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-xs font-semibold text-foreground/90">{t('connections_management')}</h2>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setEditingConn(null);
              setDialogOpen(true);
            }}
            title={t('newConnection')}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            title={t('importConfig')}
          >
            <Upload className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleExport}
            title={t('exportConfig')}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {state.connections.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground/50">
              <Radio className="w-6 h-6" />
              <p className="text-[11px]">{t('noData')}</p>
            </div>
          )}
          {state.connections.map(conn => {
            const status = state.connectionStatus[conn.id] ?? 'disconnected';
            const tabCount = state.tabs.filter(t => t.connectionId === conn.id).length;
            const isActive = state.activeConnectionId === conn.id;
            const isBroadcast = isBroadcastSlave(conn.slaveId);
            return (
              <div
                key={conn.id}
                onClick={() => dispatch({ type: 'SET_ACTIVE_CONNECTION', payload: conn.id })}
                className={`group rounded-md border p-2 cursor-pointer transition-all ${
                  isActive
                    ? 'border-primary/60 bg-primary/[0.06] ring-1 ring-primary/30'
                    : 'border-border/60 hover:border-border bg-[#0d1117] hover:bg-[#111722]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(status)}`} />
                  <span className="flex-1 truncate text-xs font-medium text-foreground/90">{conn.name}</span>
                  <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded ${protocolBadge(conn.protocol, conn.mode).cls}`}>
                    {protocolBadge(conn.protocol, conn.mode).label}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground pl-4">
                  <span className={`${isBroadcast ? 'text-amber-400' : ''}`}>
                    {t('slave')}:{conn.slaveId}
                  </span>
                  <span className="truncate font-mono text-muted-foreground/80">{connTarget(conn)}</span>
                </div>

                <div className="mt-1.5 flex items-center justify-between pl-4">
                  <span className="text-[9px] text-muted-foreground/60">
                    32:{conn.byteOrder32} · 64:{conn.byteOrder64} · {tabCount} {t('tabs')}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {status === 'connected' ? (
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-red-400" onClick={e => { e.stopPropagation(); handleConnect(conn); }}>
                        <Unplug className="w-3 h-3 mr-0.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-green-400" onClick={e => { e.stopPropagation(); handleConnect(conn); }}>
                        <Plug className="w-3 h-3 mr-0.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-blue-400" onClick={e => { e.stopPropagation(); handleEdit(conn); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-red-400" onClick={e => { e.stopPropagation(); handleDelete(conn); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 导入/导出已上移到标题栏（见上），原来的独立底栏已删除 */}

      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editingConn} />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        pending={pendingImport}
      />
      <DeleteConfirmDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

type RegisterTabType = import('@/lib/modbus-types').RegisterTab;

function ImportDialog({
  open,
  onOpenChange,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: { connections: ConnectionConfig[]; tabs: RegisterTabType[]; rowNotes: RowNotes } | null;
}) {
  const { t } = useI18n();
  const { dispatch } = useAppState();

  const apply = (strategy: 'overwrite' | 'merge') => {
    if (!pending) return;
    dispatch({
      type: 'IMPORT_CONFIG',
      payload: { connections: pending.connections, tabs: pending.tabs, rowNotes: pending.rowNotes, strategy },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#141922] border-border text-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('importStrategy')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <button
            className="w-full text-left rounded-md border border-border/60 px-3 py-2 hover:border-primary/50 transition-colors"
            onClick={() => apply('overwrite')}
          >
            <p className="text-xs font-medium text-foreground/90">{t('importOverwrite')}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('importOverwriteDesc')}</p>
          </button>
          <button
            className="w-full text-left rounded-md border border-border/60 px-3 py-2 hover:border-primary/50 transition-colors"
            onClick={() => apply('merge')}
          >
            <p className="text-xs font-medium text-foreground/90">{t('importMerge')}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('importMergeDesc')}</p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({ target, onClose }: { target: ConnectionConfig | null; onClose: () => void }) {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const { disconnectDevice } = useModbusWs();

  if (!target) return null;
  const tabCount = state.tabs.filter(t => t.connectionId === target.id).length;

  return (
    <AlertDialog open={!!target} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent className="bg-[#141922] border-border text-foreground sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{t('deleteConnection')}</AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-muted-foreground">
            {tabCount > 0
              ? `${t('deleteConnection')} "${target.name}"？${tabCount} ${t('tabs')} ${t('importMergeDesc')}`
              : `${t('deleteConnection')} "${target.name}"？`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs h-8">{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="text-xs h-8 bg-red-500/90 hover:bg-red-500 text-white"
            onClick={() => {
              if (state.connectionStatus[target.id] === 'connected') {
                disconnectDevice(target.id);
              }
              dispatch({ type: 'DELETE_CONNECTION', payload: target.id });
              onClose();
            }}
          >
            {t('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConnectionDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ConnectionConfig | null;
}) {
  const { t } = useI18n();
  const { state, dispatch } = useAppState();
  const { disconnectDevice } = useModbusWs();

  const [name, setName] = useState(editing?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(editing?.protocol ?? 'tcp');
  const [mode, setMode] = useState<Mode>(editing?.mode ?? 'rtu');
  const [slaveId, setSlaveId] = useState(editing?.slaveId ?? 1);
  const [host, setHost] = useState(editing?.tcpConfig?.host ?? '127.0.0.1');
  const [port, setPort] = useState(editing?.tcpConfig?.port ?? 502);
  const [serialPort, setSerialPort] = useState(editing?.serialConfig?.port ?? '/dev/ttyUSB0');
  const [baudRate, setBaudRate] = useState(editing?.serialConfig?.baudRate ?? 9600);
  const [byteOrder32, setByteOrder32] = useState<ByteOrder32>(editing?.byteOrder32 ?? 'ABCD');
  const [byteOrder64, setByteOrder64] = useState<ByteOrder64>(editing?.byteOrder64 ?? 'ABCDEFGH');

  // 4 个区的「总寄存器数量」（概念名 areaTotalRegisters）：
  // 主站侧它们是**设备镜像数组的初始长度**，收到更远的响应会自动扩容。
  const [coilCount, setCoilCount] = useState(editing?.coilCount ?? DEFAULT_AREA_TOTAL_REGISTERS);
  const [discreteInputCount, setDiscreteInputCount] = useState(editing?.discreteInputCount ?? DEFAULT_AREA_TOTAL_REGISTERS);
  const [holdingRegisterCount, setHoldingRegisterCount] = useState(editing?.holdingRegisterCount ?? DEFAULT_AREA_TOTAL_REGISTERS);
  const [inputRegisterCount, setInputRegisterCount] = useState(editing?.inputRegisterCount ?? DEFAULT_AREA_TOTAL_REGISTERS);

  /** 位区的只读位范围提示（Q20：主显示是寄存器编号，位范围挂旁边作参考） */
  const bitRange = (registers: number) => `0 ~ ${Math.max(1, registers) * BITS_PER_REGISTER - 1}`;

  const handleSave = () => {
    const config: ConnectionConfig = {
      id: editing?.id ?? generateId(),
      name: name || `${t('connection')} ${state.connections.length + 1}`,
      protocol,
      mode,
      slaveId,
      byteOrder32,
      byteOrder64,
      coilCount: Math.max(1, coilCount),
      discreteInputCount: Math.max(1, discreteInputCount),
      holdingRegisterCount: Math.max(1, holdingRegisterCount),
      inputRegisterCount: Math.max(1, inputRegisterCount),
      ...(protocol === 'serial'
        ? {
            serialConfig: {
              port: serialPort,
              baudRate,
              dataBits: 8 as const,
              stopBits: 1 as const,
              parity: 'none' as const,
            },
          }
        : {
            tcpConfig: {
              host,
              port,
            },
          }),
    };

    if (editing) {
      // 编辑已连接设备：先断开，避免旧连接继续占用端口；用户保存后手动重连
      if (state.connectionStatus[editing.id] === 'connected') {
        disconnectDevice(editing.id);
      }
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
        <div className="grid gap-3 py-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('name')}</label>
            <Input
              className="h-8 text-xs bg-background border-border"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('connectionName')}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('protocol')}</label>
              <Select value={protocol} onValueChange={v => setProtocol(v as Protocol)}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="serial">Serial</SelectItem>
                  <SelectItem value="tcp">TCP</SelectItem>
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
                  <SelectItem value="rtu">RTU</SelectItem>
                  <SelectItem value="ascii">ASCII</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('slave')}</label>
              <Input
                type="number"
                min={0}
                max={247}
                className="h-8 text-xs bg-background border-border"
                value={slaveId}
                onChange={e => setSlaveId(Number(e.target.value))}
              />
            </div>
          </div>

          {protocol === 'tcp' ? (
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
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('serialPort')}</label>
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
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('byteOrder32')}</label>
              <Select value={byteOrder32} onValueChange={v => setByteOrder32(v as ByteOrder32)}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['ABCD', 'DCBA', 'BADC', 'CDAB'].map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('byteOrder64')}</label>
              <Select value={byteOrder64} onValueChange={v => setByteOrder64(v as ByteOrder64)}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['ABCDEFGH', 'HGFEDCBA', 'BADCFEHG', 'GHEFCDAB'].map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* 作用范围：16 位固定大端，不受这两种字节序影响（ModBus 规范） */}
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            {t('byteOrderScopeHint')}
          </p>

          {/* 设备镜像：4 个区的总寄存器数量（= 镜像数组的初始长度） */}
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-foreground">
              {t('deviceImage')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('coilCount')}</label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-xs bg-background border-border"
                  value={coilCount}
                  onChange={e => setCoilCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="block text-[9px] text-muted-foreground/60">
                  {t('bitLabel')} {bitRange(coilCount)}
                </span>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('discreteInputCount')}</label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-xs bg-background border-border"
                  value={discreteInputCount}
                  onChange={e => setDiscreteInputCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="block text-[9px] text-muted-foreground/60">
                  {t('bitLabel')} {bitRange(discreteInputCount)}
                </span>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('holdingRegisterCount')}</label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-xs bg-background border-border"
                  value={holdingRegisterCount}
                  onChange={e => setHoldingRegisterCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('inputRegisterCount')}</label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-xs bg-background border-border"
                  value={inputRegisterCount}
                  onChange={e => setInputRegisterCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground/60">
              {t('deviceImageHint')}
            </p>
          </div>

          {slaveId === 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-400">
              {t('broadcastHint')}
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
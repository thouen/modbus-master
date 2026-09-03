"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Pencil,
  RefreshCw,
  Radio,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/hooks/use-app-state";
import { useI18n } from "@/hooks/use-i18n";
import { useModbusWs } from "@/hooks/use-modbus-ws";
import {
  generateId,
  formatRegisterValue,
  getBitsPerValue,
  parseDisplayValue,
} from "@/lib/modbus-utils";
import type {
  RegisterTab,
  RegisterData,
  DataDisplayFormat,
  ByteOrder32,
  ByteOrder64,
  FunctionCode,
  ConnectionConfig,
} from "@/lib/modbus-types";

/** 广播从站地址（Slave ID = 0） */
export const BROADCAST_SLAVE_ID = 0;

/** 功能码选项 */
const FC_OPTIONS: { value: FunctionCode; labelKey: string }[] = [
  { value: '01', labelKey: "fc01" },
  { value: '02', labelKey: "fc02" },
  { value: '03', labelKey: "fc03" },
  { value: '04', labelKey: "fc04" },
  { value: '05', labelKey: "fc05" },
  { value: '06', labelKey: "fc06" },
  { value: '15', labelKey: "fc15" },
  { value: '16', labelKey: "fc16" },
];

/** 显示格式选项 */
const FORMAT_OPTIONS: { value: DataDisplayFormat; labelKey: string }[] = [
  { value: "led", labelKey: "formatLed" },
  { value: "short", labelKey: "formatShort" },
  { value: "ushort", labelKey: "formatUShort" },
  { value: "hex", labelKey: "formatHex" },
  { value: "binary", labelKey: "formatBinary" },
  { value: "long", labelKey: "formatLong" },
  { value: "ulong", labelKey: "formatULong" },
  { value: "float", labelKey: "formatFloat" },
  { value: "double", labelKey: "formatDouble" },
];

/** 32 位字节序 */
const BYTE_ORDER_32: { value: ByteOrder32; label: string }[] = [
  { value: "ABCD", label: "ABCD" },
  { value: "BADC", label: "BADC" },
  { value: "CDAB", label: "CDAB" },
  { value: "DCBA", label: "DCBA" },
];

/** 64 位字节序 */
const BYTE_ORDER_64: { value: ByteOrder64; label: string }[] = [
  { value: "ABCDEFGH", label: "ABCDEFGH" },
  { value: "HGFEDCBA", label: "HGFEDCBA" },
  { value: "BADCFEHG", label: "BADCFEHG" },
  { value: "GHEFCDAB", label: "GHEFCDAB" },
];

/** 生成默认标签名称：FCxx @起始地址 */
function generateTabName(functionCode: FunctionCode, startAddress: number): string {
  return `FC${functionCode} @${startAddress}`;
}

/**
 * 标签页管理器：标签栏 + 配置条 + 数据表格 + 写入弹窗
 */
export function RegisterTabManager() {
  const { state, dispatch } = useAppState();
  const { t } = useI18n();
  const { readRegisters, writeRegisters } = useModbusWs();

  const { tabs, activeTabId, registerData, connections, connectionStatus, activeConnectionId } = state;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeConn = activeTab
    ? connections.find((conn) => conn.id === activeTab.connectionId)
    : undefined;
  const isConnected = activeConn
    ? connectionStatus[activeConn.id] === "connected"
    : false;
  const isBroadcast = activeConn?.slaveId === BROADCAST_SLAVE_ID;

  // 标签重命名编辑态
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // 写入弹窗
  const [writeDialogOpen, setWriteDialogOpen] = useState(false);
  const [writeValues, setWriteValues] = useState<string[]>([]);

  // 广播写入确认弹窗
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<null | {
    tab: RegisterTab;
    values: number[];
  }>(null);

  // 行内编辑状态
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [cellValue, setCellValue] = useState("");
  const [editingFormatRow, setEditingFormatRow] = useState<string | null>(null);

  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // 标签选择
  const selectTab = useCallback(
    (tabId: string) => {
      dispatch({ type: "SET_ACTIVE_TAB", payload: tabId });
    },
    [dispatch],
  );

  // 添加标签
  const addTab = useCallback(() => {
    const connId = activeConnectionId ?? connections[0]?.id;
    if (!connId) return;
    const newTab: RegisterTab = {
      id: generateId(),
      name: "",
      connectionId: connId,
      functionCode: '03' as FunctionCode,
      startAddress: 0,
      bitCount: 10,
      pollInterval: 1000,
      isPolling: false,
      byteOrder32: "ABCD",
      byteOrder64: "ABCDEFGH",
      displayFormat: "ushort",
    };
    const namedTab = { ...newTab, name: generateTabName(newTab.functionCode, newTab.startAddress) };
    dispatch({ type: "ADD_TAB", payload: namedTab });
    dispatch({ type: "SET_ACTIVE_TAB", payload: namedTab.id });
  }, [activeConnectionId, connections, dispatch]);

  // 关闭标签
  const closeTab = useCallback(
    (tabId: string) => {
      if (pollTimers.current[tabId]) {
        clearInterval(pollTimers.current[tabId]);
        delete pollTimers.current[tabId];
      }
      dispatch({ type: "DELETE_TAB", payload: tabId });
    },
    [dispatch],
  );

  // 开始重命名
  const startRename = useCallback((tab: RegisterTab) => {
    setEditingTabId(tab.id);
    setEditingName(tab.name);
  }, []);

  // 确认重命名
  const commitRename = useCallback(
    (tabId: string) => {
      const name = editingName.trim();
      if (name && activeTab) {
        const updated = { ...activeTab, name };
        dispatch({ type: "UPDATE_TAB", payload: updated });
      }
      setEditingTabId(null);
    },
    [editingName, dispatch, activeTab],
  );

  // 更新标签配置
  const updateTab = useCallback(
    (tabId: string, updates: Partial<RegisterTab>) => {
      const existing = tabs.find(t => t.id === tabId);
      if (!existing) return;
      dispatch({ type: "UPDATE_TAB", payload: { ...existing, ...updates } });
    },
    [dispatch, tabs],
  );

  // 单次读取（广播连接禁止读取）
  const handleRead = useCallback(
    (tab: RegisterTab) => {
      if (!tab || isBroadcast) return;
      const conn = connections.find((c) => c.id === tab.connectionId);
      if (!conn) return;
      readRegisters(
        conn.id,
        tab.id,
        conn.slaveId,
        parseInt(tab.functionCode, 16),
        tab.startAddress,
        tab.bitCount,
      );
    },
    [connections, readRegisters, isBroadcast],
  );

  // 执行写入（含广播确认）
  const performWrite = useCallback(
    (tab: RegisterTab, values: number[]) => {
      const conn = connections.find((c) => c.id === tab.connectionId);
      if (!conn) return;
      writeRegisters(
        conn.id,
        tab.id,
        conn.slaveId,
        parseInt(tab.functionCode, 16),
        tab.startAddress,
        values,
      );
    },
    [connections, writeRegisters],
  );

  // 打开写入弹窗（根据当前表格数据）
  const openWriteDialog = useCallback(
    (tab: RegisterTab) => {
      const data = registerData[tab.id] ?? [];
      const initial = data.length > 0 ? data.map((d) => String(d.rawValue)) : [""];
      setWriteValues(initial);
      setWriteDialogOpen(true);
    },
    [registerData],
  );

  // 提交写入（弹窗）
  const submitWriteDialog = useCallback(() => {
    if (!activeTab) return;
    const values = writeValues
      .filter((v) => v.trim() !== "")
      .map((v) => {
        const num = parseDisplayValue(v, activeTab.displayFormat);
        return typeof num === "number" ? num : 0;
      });
    if (values.length === 0) return;
    if (isBroadcast) {
      setPendingWrite({ tab: activeTab, values });
      setWriteDialogOpen(false);
      setBroadcastConfirmOpen(true);
    } else {
      performWrite(activeTab, values);
      setWriteDialogOpen(false);
    }
  }, [activeTab, writeValues, isBroadcast, performWrite]);

  // 行内编辑提交
  const commitCellEdit = useCallback(
    (tab: RegisterTab, index: number, raw: string) => {
      const num = parseDisplayValue(raw, tab.displayFormat);
      if (num === null) return;
      if (isBroadcast) {
        setPendingWrite({ tab, values: [num] });
        setBroadcastConfirmOpen(true);
      } else {
        performWrite(tab, [num]);
      }
      setEditingCell(null);
    },
    [isBroadcast, performWrite],
  );

  // 切换轮询（广播连接禁止轮询）
  const togglePolling = useCallback(
    (tab: RegisterTab) => {
      if (isBroadcast) return;
      const next = !tab.isPolling;
      updateTab(tab.id, { isPolling: next });
      if (next) {
        const timer = setInterval(() => {
          handleRead(tab);
        }, Math.max(tab.pollInterval, 200));
        pollTimers.current[tab.id] = timer;
      } else if (pollTimers.current[tab.id]) {
        clearInterval(pollTimers.current[tab.id]);
        delete pollTimers.current[tab.id];
      }
    },
    [isBroadcast, handleRead, updateTab],
  );

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach((timer) => clearInterval(timer));
      pollTimers.current = {};
    };
  }, []);

  // 广播确认后执行写入
  const confirmBroadcastWrite = useCallback(() => {
    if (pendingWrite) {
      performWrite(pendingWrite.tab, pendingWrite.values);
      setPendingWrite(null);
    }
    setBroadcastConfirmOpen(false);
  }, [pendingWrite, performWrite]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* 标签栏 */}
      <TabBar
        tabs={tabs}
        connections={connections}
        activeTabId={activeTab?.id ?? null}
        editingTabId={editingTabId}
        editingName={editingName}
        onSelect={selectTab}
        onClose={closeTab}
        onAdd={addTab}
        onStartRename={startRename}
        onRenameChange={setEditingName}
        onCommitRename={commitRename}
        onCancelRename={() => setEditingTabId(null)}
      />

      {/* 配置条 */}
      {activeTab && activeConn && (
        <ConfigBar
          tab={activeTab}
          connName={activeConn.name}
          connSlaveId={activeConn.slaveId}
          isConnected={isConnected}
          isBroadcast={isBroadcast}
          onUpdate={updateTab}
          onRead={() => handleRead(activeTab)}
          onWrite={() => openWriteDialog(activeTab)}
          onTogglePolling={() => togglePolling(activeTab)}
        />
      )}

      {/* 数据表格 */}
      {activeTab ? (
        <DataTable
          tab={activeTab}
          data={registerData[activeTab.id] ?? []}
          isConnected={isConnected}
          isBroadcast={isBroadcast}
          onUpdate={updateTab}
          onRead={() => handleRead(activeTab)}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          cellValue={cellValue}
          setCellValue={setCellValue}
          onCommitCellEdit={(index, raw) => commitCellEdit(activeTab, index, raw)}
          editingFormatRow={editingFormatRow}
          setEditingFormatRow={setEditingFormatRow}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
          {t("empty")}
        </div>
      )}

      {/* 写入弹窗 */}
      <WriteDialog
        open={writeDialogOpen}
        onOpenChange={setWriteDialogOpen}
        tab={activeTab}
        values={writeValues}
        setValues={setWriteValues}
        onSubmit={submitWriteDialog}
        isBroadcast={isBroadcast}
      />

      {/* 广播写入确认 */}
      <AlertDialog open={broadcastConfirmOpen} onOpenChange={setBroadcastConfirmOpen}>
        <AlertDialogContent className="border-amber-500/40 bg-surface-container">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-500">
              <Radio className="h-4 w-4" />
              {t("broadcast")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
              {t("broadcastHint")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400"
              onClick={confirmBroadcastWrite}
            >
              <Radio className="mr-1 h-3.5 w-3.5" />
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ========== 数据表格 ========== */
function DataTable({
  tab,
  data,
  isConnected,
  isBroadcast,
  onUpdate,
  onRead,
  editingCell,
  setEditingCell,
  cellValue,
  setCellValue,
  onCommitCellEdit,
  editingFormatRow,
  setEditingFormatRow,
}: {
  tab: RegisterTab;
  data: RegisterData[];
  isConnected: boolean;
  isBroadcast: boolean;
  onUpdate: (tabId: string, updates: Partial<RegisterTab>) => void;
  onRead: () => void;
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  cellValue: string;
  setCellValue: (v: string) => void;
  onCommitCellEdit: (index: number, raw: string) => void;
  editingFormatRow: string | null;
  setEditingFormatRow: (address: string | null) => void;
}) {
  const { t } = useI18n();
  const isWriteFc =
    tab.functionCode === '05' ||
    tab.functionCode === '06' ||
    tab.functionCode === '15' ||
    tab.functionCode === '16';

  const bitsPerValue = getBitsPerValue(tab.displayFormat);

  if (data.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/50">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border/30 bg-surface-container/90 backdrop-blur">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {t("address")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {t("rawHex")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {t("rawDec")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {t("dataType")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {t("formattedValue")}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => {
            const cellKey = `${item.address}:${index}`;
            const isEditingThis = editingCell === cellKey;
            const formatEditing = editingFormatRow === String(item.address);
            return (
              <tr
                key={cellKey}
                className="border-b border-border/20 transition-colors odd:bg-surface/40 even:bg-transparent hover:bg-surface-container/50"
              >
                {/* 地址 */}
                <td className="px-3 py-1.5 font-mono text-data font-semibold">
                  {item.address}
                </td>
                {/* 原始 HEX */}
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {item.rawValue.toString(16).toUpperCase().padStart(4, '0')}
                </td>
                {/* 原始 DEC */}
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {item.rawValue}
                </td>
                {/* 数据类型（逐行格式切换） */}
                <td className="px-3 py-1.5">
                  {formatEditing ? (
                    <Select
                      value={tab.displayFormat}
                      onValueChange={(v) => {
                        onUpdate(tab.id, { displayFormat: v as DataDisplayFormat });
                        setEditingFormatRow(null);
                      }}
                    >
                      <SelectTrigger className="h-6 w-24 border-border/40 bg-background px-2 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORMAT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {t(opt.labelKey as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant="outline"
                      className={`cursor-pointer border-transparent bg-foreground/5 px-2 py-0.5 font-mono text-[10px] ${
                        tab.displayFormat === "float" ||
                        tab.displayFormat === "double"
                          ? "text-primary"
                          : tab.displayFormat === "led"
                            ? "text-success"
                            : "text-amber-500"
                      }`}
                      onClick={() => setEditingFormatRow(String(item.address))}
                    >
                      {t(FORMAT_KEY_MAP[tab.displayFormat] as Parameters<typeof t>[0])}
                    </Badge>
                  )}
                </td>
                {/* 格式化值（行内编辑） */}
                <td className="px-3 py-1.5">
                  {isEditingThis ? (
                    <input
                      autoFocus
                      value={cellValue}
                      onChange={(e) => setCellValue(e.target.value)}
                      onBlur={() => onCommitCellEdit(index, cellValue)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCommitCellEdit(index, cellValue);
                        if (e.key === "Escape") setEditingCell(null);
                      }}
                      disabled={!isConnected || !isWriteFc || isBroadcast}
                      className="w-28 rounded border border-primary/40 bg-background px-1.5 py-0.5 font-mono text-xs text-foreground outline-none"
                    />
                  ) : (
                    <span
                      className={`cursor-pointer rounded px-1.5 py-0.5 font-mono ${
                        isWriteFc && isConnected && !isBroadcast
                          ? "text-cyan-400 hover:bg-primary/10"
                          : "text-foreground"
                      }`}
                      onClick={() => {
                        if (!isWriteFc || !isConnected || isBroadcast) return;
                        setEditingCell(cellKey);
                        setCellValue(formatRegisterValue([item], 0, tab.displayFormat, tab.byteOrder32, tab.byteOrder64));
                      }}
                    >
                      {formatRegisterValue([item], 0, tab.displayFormat, tab.byteOrder32, tab.byteOrder64)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.length > 0 && bitsPerValue > 1 && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground/50">
          {t("bitHint").replace("{bits}", String(bitsPerValue))}
        </div>
      )}
    </div>
  );
}

/* ========== 写入弹窗 ========== */
function WriteDialog({
  open,
  onOpenChange,
  tab,
  values,
  setValues,
  onSubmit,
  isBroadcast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: RegisterTab | undefined;
  values: string[];
  setValues: (v: string[]) => void;
  onSubmit: () => void;
  isBroadcast: boolean;
}) {
  const { t } = useI18n();
  if (!tab) return null;
  const isMulti = tab.functionCode === '15' || tab.functionCode === '16';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/40 bg-surface-container sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("writeTitle")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isBroadcast ? t("broadcastHint") : t("writeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-muted-foreground">{t("address")}</span>
            <span className="font-mono text-data">{tab.startAddress}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-muted-foreground">{t("functionCode")}</span>
            <span className="font-mono">{t(`fc${tab.functionCode}` as Parameters<typeof t>[0])}</span>
          </div>
          {isMulti && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-muted-foreground">{t("registerCount")}</span>
              <span className="font-mono">{tab.bitCount}</span>
            </div>
          )}
          <div className="mt-1 flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t("writeValue")}</span>
            {values.map((v, i) => (
              <Input
                key={i}
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setValues(next);
                }}
                placeholder={String(tab.startAddress + i)}
                className="h-7 border-border/40 bg-background px-2 font-mono text-xs"
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            className={isBroadcast ? "border-amber-500/40 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25" : "bg-primary text-primary-foreground hover:bg-primary/90"}
          >
            {isBroadcast ? (
              <>
                <Radio className="mr-1 h-3 w-3" />
                {t("confirmBroadcast")}
              </>
            ) : (
              t("confirm")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ========== 轮询 Hook ========== */
export function usePolling() {
  const { state, dispatch } = useAppState();
  const { readRegisters } = useModbusWs();
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const stopPolling = useCallback((tabId: string) => {
    if (timers.current[tabId]) {
      clearInterval(timers.current[tabId]);
      delete timers.current[tabId];
    }
  }, []);

  const startPolling = useCallback(
    (tab: RegisterTab, conn: ConnectionConfig) => {
      if (tab.isPolling || conn.slaveId === 0) return;
      stopPolling(tab.id);
      timers.current[tab.id] = setInterval(() => {
        readRegisters(
          conn.id,
          tab.id,
          conn.slaveId,
          parseInt(tab.functionCode, 16),
          tab.startAddress,
          tab.bitCount,
        );
      }, Math.max(tab.pollInterval, 200));
    },
    [readRegisters, stopPolling],
  );

  // 同步轮询状态
  useEffect(() => {
    state.tabs.forEach((tab) => {
      if (tab.isPolling) {
        const conn = state.connections.find((c) => c.id === tab.connectionId);
        if (conn) startPolling(tab, conn);
      } else {
        stopPolling(tab.id);
      }
    });
    return () => {
      Object.values(timers.current).forEach((timer) => clearInterval(timer));
      timers.current = {};
    };
  }, [state.tabs, state.connections, startPolling, stopPolling]);

  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Map display format to i18n key */
const FORMAT_KEY_MAP: Record<DataDisplayFormat, string> = {
  led: 'formatLed',
  short: 'formatShort',
  ushort: 'formatUShort',
  hex: 'formatHex',
  binary: 'formatBinary',
  long: 'formatLong',
  ulong: 'formatULong',
  float: 'formatFloat',
  double: 'formatDouble',
};

/* ========== 标签栏 ========== */
function TabBar({
  tabs,
  connections,
  activeTabId,
  editingTabId,
  editingName,
  onSelect,
  onClose,
  onAdd,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
}: {
  tabs: RegisterTab[];
  connections: ConnectionConfig[];
  activeTabId: string | null;
  editingTabId: string | null;
  editingName: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: () => void;
  onStartRename: (tab: RegisterTab) => void;
  onRenameChange: (name: string) => void;
  onCommitRename: (tabId: string) => void;
  onCancelRename: () => void;
}) {
  const { t } = useI18n();
  const connNameOf = (connectionId: string) =>
    connections.find((c) => c.id === connectionId)?.name ?? '—';
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/30 bg-surface px-1.5 pt-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = tab.id === editingTabId;
        return (
          <div
            key={tab.id}
            className={`group relative flex shrink-0 cursor-pointer items-center gap-1 rounded-t-md px-3 py-2 text-xs transition-colors ${
              isActive
                ? "border-b-2 border-primary bg-surface-container text-foreground"
                : "border-b-2 border-transparent text-muted-foreground hover:bg-surface-container/60 hover:text-foreground"
            }`}
            onClick={() => !isEditing && onSelect(tab.id)}
            onDoubleClick={() => onStartRename(tab)}
            title={t("renameTab")}
          >
            {isEditing ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => onRenameChange(e.target.value)}
                onBlur={() => onCommitRename(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename(tab.id);
                  if (e.key === "Escape") onCancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-20 rounded border border-primary/40 bg-background px-1 py-0.5 text-xs text-foreground outline-none"
              />
            ) : (
              <>
                <span className="max-w-32 truncate font-medium">{tab.name || "—"}</span>
                <span
                  className={`max-w-24 truncate rounded px-1 py-0.5 text-[9px] leading-none ${
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "bg-foreground/5 text-muted-foreground"
                  }`}
                  title={connNameOf(tab.connectionId)}
                >
                  {connNameOf(tab.connectionId)}
                </span>
              </>
            )}
            {!isEditing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="ml-1 flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-container hover:text-primary"
        title={t("addTab")}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ========== 配置条 ========== */
function ConfigBar({
  tab,
  connName,
  connSlaveId,
  isConnected,
  isBroadcast,
  onUpdate,
  onRead,
  onWrite,
  onTogglePolling,
}: {
  tab: RegisterTab;
  connName: string;
  connSlaveId: number;
  isConnected: boolean;
  isBroadcast: boolean;
  onUpdate: (tabId: string, updates: Partial<RegisterTab>) => void;
  onRead: () => void;
  onWrite: () => void;
  onTogglePolling: () => void;
}) {
  const { t } = useI18n();
  const isWriteFc =
    tab.functionCode === '05' ||
    tab.functionCode === '06' ||
    tab.functionCode === '15' ||
    tab.functionCode === '16';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/30 bg-surface px-3 py-2">
      {/* 绑定连接 */}
      <span className="inline-flex max-w-40 items-center gap-1.5 rounded border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[11px] text-primary">
        <Radio className="h-3 w-3 shrink-0" />
        <span className="truncate font-medium">{connName}</span>
        <span className="text-[10px] text-muted-foreground">#{connSlaveId}</span>
      </span>

      {/* 功能码 */}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("functionCode")}
        <Select
          value={String(tab.functionCode)}
          onValueChange={(v) =>
            onUpdate(tab.id, { functionCode: v as FunctionCode })
          }
        >
          <SelectTrigger className="h-6 w-36 border-border/40 bg-background px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FC_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                {t(opt.labelKey as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <span className="h-4 w-px bg-border/30" />

      {/* 起始地址 */}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("startAddress")}
        <Input
          type="number"
          min={0}
          max={65535}
          value={tab.startAddress}
          onChange={(e) =>
            onUpdate(tab.id, { startAddress: Number(e.target.value) || 0 })
          }
          className="h-6 w-20 border-border/40 bg-background px-2 text-xs"
        />
      </label>

      <span className="h-4 w-px bg-border/30" />

      {/* 寄存器数量 */}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("registerCount")}
        <Input
          type="number"
          min={1}
          max={125}
          value={tab.bitCount}
          onChange={(e) =>
            onUpdate(tab.id, { bitCount: Number(e.target.value) || 1 })
          }
          className="h-6 w-16 border-border/40 bg-background px-2 text-xs"
        />
      </label>

      {/* 显示格式（标签级默认） */}
      <span className="hidden h-4 w-px bg-border/30 md:inline-block" />
      <label className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
        {t("displayFormat")}
        <Select
          value={tab.displayFormat}
          onValueChange={(v) =>
            onUpdate(tab.id, { displayFormat: v as DataDisplayFormat })
          }
        >
          <SelectTrigger className="h-6 w-32 border-border/40 bg-background px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {t(opt.labelKey as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {/* 32 位字节序 */}
      {(tab.displayFormat === "long" ||
        tab.displayFormat === "ulong" ||
        tab.displayFormat === "float") && (
        <label className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          {t("byteOrder32")}
          <Select
            value={tab.byteOrder32}
            onValueChange={(v) =>
              onUpdate(tab.id, { byteOrder32: v as ByteOrder32 })
            }
          >
            <SelectTrigger className="h-6 w-20 border-border/40 bg-background px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BYTE_ORDER_32.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      {/* 64 位字节序 */}
      {tab.displayFormat === "double" && (
        <label className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          {t("byteOrder64")}
          <Select
            value={tab.byteOrder64}
            onValueChange={(v) =>
              onUpdate(tab.id, { byteOrder64: v as ByteOrder64 })
            }
          >
            <SelectTrigger className="h-6 w-24 border-border/40 bg-background px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BYTE_ORDER_64.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      <span className="h-4 w-px bg-border/30" />

      {/* 轮询间隔 */}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("pollInterval")}
        <Input
          type="number"
          min={200}
          step={100}
          value={tab.pollInterval}
          onChange={(e) =>
            onUpdate(tab.id, { pollInterval: Number(e.target.value) || 1000 })
          }
          className="h-6 w-18 border-border/40 bg-background px-2 text-xs"
        />
      </label>

      {/* 操作按钮 */}
      <div className="ml-auto flex items-center gap-1.5">
        {!isBroadcast && (
          <Button
            variant="outline"
            size="sm"
            disabled={!isConnected}
            onClick={onRead}
            className="h-7 border-primary/30 bg-primary/10 px-2.5 text-xs text-primary hover:bg-primary/20 hover:text-primary"
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("read")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!isConnected || !isWriteFc}
          onClick={onWrite}
          className="h-7 border-border/40 bg-surface-container px-2.5 text-xs text-foreground hover:bg-surface-container/70"
        >
          <Pencil className="mr-1 h-3 w-3" />
          {t("write")}
        </Button>
        {!isBroadcast && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded border border-border/40 bg-surface-container px-2 py-1 text-[11px] text-muted-foreground">
            <span>{t("autoPoll")}</span>
            <Switch
              checked={tab.isPolling}
              disabled={!isConnected}
              onCheckedChange={onTogglePolling}
              className="scale-75"
            />
          </label>
        )}
        {isBroadcast && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500"
          >
            <Radio className="mr-1 h-3 w-3" />
            {t("broadcast")}
          </Badge>
        )}
      </div>
    </div>
  );
}
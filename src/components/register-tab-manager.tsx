"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  RefreshCw,
  Radio,
  Upload,
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
  parseDisplayValue,
  isWordFunctionCode,
  formatFitsAt,
  resolveRegisterLayout,
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

/** 功能码字符串（十进制 '01'~'16'）转数字 */
function parseFunctionCode(fc: FunctionCode): number {
  return parseInt(fc, 10);
}

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

  // 广播写入确认弹窗
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<null | {
    tab: RegisterTab;
    values: number[];
    startAddress?: number;
  }>(null);

  // 行内编辑状态
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [cellValue, setCellValue] = useState("");
  const [editingFormatRow, setEditingFormatRow] = useState<string | null>(null);

  // 写入草稿：地址 -> 待写入值（编辑后暂存，点击「写入」整段提交）
  const [writeDraft, setWriteDraft] = useState<Map<number, number>>(new Map());

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
      quantity: 10,
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
        parseFunctionCode(tab.functionCode),
        tab.startAddress,
        tab.quantity,
      );
    },
    [connections, readRegisters, isBroadcast],
  );

  // 执行写入（含广播确认），startAddress 缺省为 tab.startAddress
  const performWrite = useCallback(
    (tab: RegisterTab, values: number[], startAddress?: number) => {
      const conn = connections.find((c) => c.id === tab.connectionId);
      if (!conn) return;
      writeRegisters(
        conn.id,
        tab.id,
        conn.slaveId,
        parseFunctionCode(tab.functionCode),
        startAddress ?? tab.startAddress,
        values,
      );
    },
    [connections, writeRegisters],
  );

  // 行内编辑提交：暂存为草稿，不立即发送（点击「写入」整段提交）
  const commitCellEdit = useCallback(
    (tab: RegisterTab, address: number, raw: string) => {
      const num = parseDisplayValue(raw, tab.displayFormat);
      if (num === null) return;
      setWriteDraft((prev) => {
        const next = new Map(prev);
        next.set(address, num);
        return next;
      });
      setEditingCell(null);
    },
    [],
  );

  // 整段批量提交：startAddress 起 quantity 个值（草稿覆盖 + 未编辑行回填原值）
  const commitWriteDraft = useCallback(
    (tab: RegisterTab) => {
      if (!isConnected) return;
      const data = registerData[tab.id] ?? [];
      const isSingle = tab.functionCode === '05' || tab.functionCode === '06';
      const count = isSingle ? 1 : Math.max(1, tab.quantity);
      const values: number[] = [];
      const nextDraft = new Map<number, number>();
      for (let i = 0; i < count; i++) {
        const addr = tab.startAddress + i;
        const edited = writeDraft.get(addr);
        if (edited !== undefined) {
          values.push(edited);
        } else {
          // 未编辑行回填当前原始值，保证批量写完整覆盖
          const row = data.find((d) => d.address === addr);
          values.push(row ? row.rawValue : 0);
        }
        nextDraft.delete(addr);
      }
      if (isBroadcast) {
        setPendingWrite({ tab, values, startAddress: tab.startAddress });
        setBroadcastConfirmOpen(true);
        // 广播确认后再清空，因此这里不清空草稿
      } else {
        performWrite(tab, values, tab.startAddress);
        setWriteDraft(nextDraft);
      }
    },
    [isConnected, registerData, writeDraft, isBroadcast, performWrite],
  );

  // 切换轮询（广播连接禁止轮询，实际定时器由 usePolling 统一调度）
  const togglePolling = useCallback(
    (tab: RegisterTab) => {
      if (isBroadcast) return;
      updateTab(tab.id, { isPolling: !tab.isPolling });
    },
    [isBroadcast, updateTab],
  );

  // 广播确认后执行写入
  const confirmBroadcastWrite = useCallback(() => {
    if (pendingWrite) {
      performWrite(pendingWrite.tab, pendingWrite.values, pendingWrite.startAddress);
      // 清空已提交区间的草稿
      const count =
        pendingWrite.tab.functionCode === '05' || pendingWrite.tab.functionCode === '06'
          ? 1
          : Math.max(1, pendingWrite.tab.quantity);
      const start = pendingWrite.startAddress ?? pendingWrite.tab.startAddress;
      setWriteDraft((prev) => {
        const next = new Map(prev);
        for (let i = 0; i < count; i++) next.delete(start + i);
        return next;
      });
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
          hasDraft={writeDraft.size > 0}
          onUpdate={updateTab}
          onRead={() => handleRead(activeTab)}
          onTogglePolling={() => togglePolling(activeTab)}
          onWrite={() => commitWriteDraft(activeTab)}
        />
      )}

      {/* 数据表格 */}
      {activeTab ? (
        <DataTable
          tab={activeTab}
          data={registerData[activeTab.id] ?? []}
          isConnected={isConnected}
          writeDraft={writeDraft}
          onUpdate={updateTab}
          onRead={() => handleRead(activeTab)}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          cellValue={cellValue}
          setCellValue={setCellValue}
          onCommitCellEdit={(address, raw) => commitCellEdit(activeTab, address, raw)}
          editingFormatRow={editingFormatRow}
          setEditingFormatRow={setEditingFormatRow}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
          {t("empty")}
        </div>
      )}

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
/** Bits 格式：16 个可点击位开关，每 4 个一组排列 */
function LedBits({
  value,
  editable,
  drafted,
  onChange,
}: {
  value: number;
  editable: boolean;
  drafted: boolean;
  onChange: (raw: number) => void;
}) {
  const groups: number[][] = [
    [15, 14, 13, 12],
    [11, 10, 9, 8],
    [7, 6, 5, 4],
    [3, 2, 1, 0],
  ];
  return (
    <div className="flex items-center gap-1.5">
      {groups.map((g, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {g.map((bit) => {
            const on = (value >> bit) & 1;
            return (
              <button
                key={bit}
                type="button"
                disabled={!editable}
                onClick={() => onChange(value ^ (1 << bit))}
                title={`bit${bit}`}
                className={`flex h-4 w-4 items-center justify-center rounded-[2px] font-mono text-[9px] leading-none transition-colors ${
                  drafted ? "ring-1 ring-amber-400/60" : ""
                } ${
                  on
                    ? "bg-success text-background"
                    : "bg-foreground/10 text-muted-foreground"
                } ${editable ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
              >
                {on ? "1" : "0"}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DataTable({
  tab,
  data,
  isConnected,
  writeDraft,
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
  writeDraft: Map<number, number>;
  onUpdate: (tabId: string, updates: Partial<RegisterTab>) => void;
  onRead: () => void;
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  cellValue: string;
  setCellValue: (v: string) => void;
  onCommitCellEdit: (address: number, raw: string) => void;
  editingFormatRow: string | null;
  setEditingFormatRow: (address: string | null) => void;
}) {
  const { t } = useI18n();
  const isWriteFc =
    tab.functionCode === '05' ||
    tab.functionCode === '06' ||
    tab.functionCode === '15' ||
    tab.functionCode === '16';

  const isWordType = isWordFunctionCode(tab.functionCode);
  const isSingleWrite = tab.functionCode === '05' || tab.functionCode === '06';
  const rowCount = isSingleWrite ? 1 : Math.max(1, tab.quantity);
  const rows: RegisterData[] = Array.from({ length: rowCount }, (_, i) => {
    const address = tab.startAddress + i;
    return data.find((d) => d.address === address) ?? { address, rawValue: 0 };
  });

  // 逐行类型映射：计算每个地址是分组起点还是被宽类型占用
  const layout = resolveRegisterLayout({
    startAddress: tab.startAddress,
    quantity: rowCount,
    isWordType,
    defaultFormat: tab.displayFormat,
    formatOverrides: tab.formatOverrides,
  });

  // 是否存在跨寄存器（32/64 位）分组：用于底部提示
  const hasWideGroup = Array.from(layout.values()).some(
    (r) => r.role === 'start' && r.span > 1,
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
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
          {rows.map((item, index) => {
            const cellKey = `${item.address}:${index}`;
            const isEditingThis = editingCell === cellKey;
            const formatEditing = editingFormatRow === String(item.address);
            const res = layout.get(item.address);
            const isGroupStart = res?.role === 'start' || !res;
            const groupFits = res?.fits ?? true;
            const groupSpan = res?.span ?? 1;
            const format = res?.format ?? tab.displayFormat;
            // 写入：仅 16 位/bit 分组起点可编辑；跨寄存器组、占用行不可编辑
            const canEdit = isGroupStart && groupSpan === 1 && isWriteFc && isConnected;
            const isDrafted = writeDraft.has(item.address);
            const draftValue = writeDraft.get(item.address);
            // 起点且空间足够才计算格式化值；占用行 / 越界组显示 —
            const displayValue =
              isGroupStart && groupFits
                ? formatRegisterValue(rows, index, format, tab.byteOrder32, tab.byteOrder64)
                : "—";
            // 起点行可选格式：非寄存器（线圈）禁用 32/64 位；空间不足禁用跨寄存器类型
            const formatDisabled = !isGroupStart || !isWordType;
            return (
              <tr
                key={cellKey}
                className={`h-12 border-b border-border/20 transition-colors ${
                  isDrafted
                    ? "bg-amber-500/[0.07] odd:bg-amber-500/[0.07] even:bg-amber-500/[0.07]"
                    : "odd:bg-surface/40 even:bg-transparent hover:bg-surface-container/50"
                }`}
              >
                {/* 地址 */}
                <td className="w-18 px-3 py-1.5 font-mono text-data font-semibold">
                  {isDrafted && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                  )}
                  {item.address}
                </td>
                {/* 原始 HEX */}
                <td className="w-28 px-3 py-1.5 font-mono text-muted-foreground">
                  {item.rawValue.toString(16).toUpperCase().padStart(4, '0')}
                </td>
                {/* 原始 DEC */}
                <td className="w-28 px-3 py-1.5 font-mono text-muted-foreground">
                  {item.rawValue}
                </td>
                {/* 数据类型（逐行格式切换，写入 formatOverrides） */}
                <td className="w-48 px-3 py-1.5">
                  {!isGroupStart ? (
                    // 被前一 32/64 位类型占用的后续地址：禁用选择
                    <span className="px-2 font-mono text-[10px] text-muted-foreground/40">
                      —
                    </span>
                  ) : formatEditing ? (
                    <Select
                      value={format}
                      onValueChange={(v) => {
                        const next = v as DataDisplayFormat;
                        const overrides = { ...(tab.formatOverrides ?? {}) };
                        if (next === tab.displayFormat) {
                          // 选回默认格式 → 移除 override
                          delete overrides[item.address];
                        } else {
                          overrides[item.address] = next;
                        }
                        onUpdate(tab.id, { formatOverrides: overrides });
                        setEditingFormatRow(null);
                      }}
                    >
                      <SelectTrigger className="h-6 w-42 border-border/40 bg-background px-2 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORMAT_OPTIONS.map((opt) => {
                          // 空间不足 / 非寄存器：禁用无法应用的 32/64 位类型
                          const fits = formatFitsAt(opt.value, index, rowCount, isWordType);
                          return (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              disabled={!fits}
                              className="text-xs"
                            >
                              {t(opt.labelKey as Parameters<typeof t>[0])}
                              {!fits ? ` (${t("notEnoughRegisters")})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant="outline"
                      className={`cursor-pointer border-transparent px-2 py-0.5 font-mono text-[10px] ${
                        formatDisabled
                          ? "cursor-not-allowed bg-foreground/5 text-muted-foreground/40"
                          : "bg-foreground/5 " +
                            (format === "float" || format === "double"
                              ? "text-primary"
                              : format === "led"
                                ? "text-success"
                                : "text-amber-500")
                      } ${res?.overridden ? "ring-1 ring-primary/40" : ""}`}
                      onClick={() => {
                        if (formatDisabled) return;
                        setEditingFormatRow(String(item.address));
                      }}
                      title={isWordType ? undefined : t("wideTypeRequiresRegisters")}
                    >
                      {t(FORMAT_KEY_MAP[format] as Parameters<typeof t>[0])}
                      {res?.overridden ? " *" : ""}
                    </Badge>
                  )}
                </td>
                {/* 格式化值（行内编辑，32/64 位只读展示；led 渲染为位开关） */}
                <td className="w-48 px-3 py-1.5">
                  {format === "led" ? (
                    <LedBits
                      value={draftValue ?? item.rawValue}
                      editable={canEdit}
                      drafted={isDrafted}
                      onChange={(raw) => onCommitCellEdit(item.address, String(raw))}
                    />
                  ) : isEditingThis ? (
                    <input
                      autoFocus
                      value={cellValue}
                      onChange={(e) => setCellValue(e.target.value)}
                      onBlur={() => onCommitCellEdit(item.address, cellValue)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCommitCellEdit(item.address, cellValue);
                        if (e.key === "Escape") setEditingCell(null);
                      }}
                      disabled={!canEdit}
                      className="w-42 rounded border border-primary/40 bg-background px-1.5 py-0.5 font-mono text-xs text-foreground outline-none"
                    />
                  ) : (
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono ${
                        canEdit
                          ? "cursor-pointer text-cyan-400 hover:bg-primary/10"
                          : "text-foreground"
                      } ${isDrafted ? "text-amber-400" : ""}`}
                      onClick={() => {
                        if (!canEdit) return;
                        setEditingCell(cellKey);
                        setCellValue(formatRegisterValue(rows, index, format, tab.byteOrder32, tab.byteOrder64));
                      }}
                    >
                      {isDrafted && draftValue !== undefined
                        ? formatDraftValue(draftValue, format)
                        : displayValue}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 0 && hasWideGroup && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground/50">
          {t("perRowFormatHint")}
        </div>
      )}
    </div>
  );
}

/* ========== 轮询 Hook ========== */
export function usePolling() {
  const { state } = useAppState();
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
      if (!tab.isPolling || conn.slaveId === 0) return;
      stopPolling(tab.id);
      timers.current[tab.id] = setInterval(() => {
        readRegisters(
          conn.id,
          tab.id,
          conn.slaveId,
          parseFunctionCode(tab.functionCode),
          tab.startAddress,
          tab.quantity,
        );
      }, Math.max(tab.pollInterval, 200));
    },
    [readRegisters, stopPolling],
  );

  // 统一同步轮询定时器：只保留一处调度，避免重复轮询；
  // 仅当连接状态为 connected 时启动，否则停止。
  useEffect(() => {
    state.tabs.forEach((tab) => {
      if (tab.isPolling) {
        const conn = state.connections.find((c) => c.id === tab.connectionId);
        const isConnected = conn
          ? state.connectionStatus[conn.id] === "connected"
          : false;
        if (conn && isConnected && conn.slaveId !== 0) {
          startPolling(tab, conn);
        } else {
          stopPolling(tab.id);
        }
      } else {
        stopPolling(tab.id);
      }
    });
    return () => {
      Object.values(timers.current).forEach((timer) => clearInterval(timer));
      timers.current = {};
    };
  }, [state.tabs, state.connections, state.connectionStatus, startPolling, stopPolling]);

  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 格式化单个待写草稿值（写功能码行内编辑为 16 位单值） */
function formatDraftValue(value: number, format: DataDisplayFormat): string {
  switch (format) {
    case 'hex':
      return value.toString(16).toUpperCase().padStart(4, '0');
    case 'binary':
      return value.toString(2).padStart(16, '0');
    case 'short': {
      const s = value & 0xffff;
      return String(s <= 0x7fff ? s : s - 0x10000);
    }
    case 'led':
      return Array.from({ length: 16 }, (_, i) =>
        (value & (1 << (15 - i))) ? '1' : '0',
      ).join('');
    default:
      return String(value);
  }
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
  hasDraft,
  onUpdate,
  onRead,
  onTogglePolling,
  onWrite,
}: {
  tab: RegisterTab;
  connName: string;
  connSlaveId: number;
  isConnected: boolean;
  isBroadcast: boolean;
  hasDraft: boolean;
  onUpdate: (tabId: string, updates: Partial<RegisterTab>) => void;
  onRead: () => void;
  onTogglePolling: () => void;
  onWrite: () => void;
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
          value={tab.quantity}
          onChange={(e) =>
            onUpdate(tab.id, { quantity: Number(e.target.value) || 1 })
          }
          className="h-6 w-16 border-border/40 bg-background px-2 text-xs"
        />
      </label>

      {/* 显示格式（标签级默认，可被表格逐行 override） */}
      <span className="hidden h-4 w-px bg-border/30 md:inline-block" />
      <label
        className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex"
        title={t("defaultFormatHint")}
      >
        {t("defaultFormat")}
        <Select
          value={tab.displayFormat}
          onValueChange={(v) =>
            onUpdate(tab.id, { displayFormat: v as DataDisplayFormat })
          }
        >
          <SelectTrigger className="h-6 w-42 border-border/40 bg-background px-2 text-xs">
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
        {isWriteFc && !isBroadcast && (
          <Button
            variant="outline"
            size="sm"
            disabled={!isConnected}
            onClick={onWrite}
            className={`h-7 border-success/40 px-2.5 text-xs ${
              hasDraft
                ? "bg-success/15 text-success hover:bg-success/25"
                : "border-border/40 bg-surface-container text-muted-foreground hover:bg-surface-container/80"
            }`}
          >
            <Upload className="mr-1 h-3 w-3" />
            {t("write")}
          </Button>
        )}
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
        {isWriteFc && isBroadcast && (
          <Button
            variant="outline"
            size="sm"
            disabled={!isConnected}
            onClick={onWrite}
            className={`h-7 border-amber-500/40 px-2.5 text-xs ${
              hasDraft
                ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                : "border-border/40 bg-surface-container text-muted-foreground hover:bg-surface-container/80"
            }`}
          >
            <Upload className="mr-1 h-3 w-3" />
            {t("write")}
          </Button>
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
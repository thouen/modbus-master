"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  encodeValueToRegisters,
  registerWindowKey,
} from "@/lib/modbus-utils";
import { readRegisterRows } from "@/lib/connection-image";
import {
  fcToArea,
  isBitArea,
  BITS_PER_REGISTER,
  type RegisterArea,
  type ConnectionRegisterImage,
} from "@/lib/modbus-types";
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

/** 标签的功能码 → 它看的是哪个寄存器区域 */
function tabArea(tab: RegisterTab): RegisterArea | null {
  return fcToArea(parseFunctionCode(tab.functionCode));
}

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

  const { tabs, activeTabId, registerImages, connections, connectionStatus, activeConnectionId } = state;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeConn = activeTab
    ? connections.find((conn) => conn.id === activeTab.connectionId)
    : undefined;
  const isConnected = activeConn
    ? connectionStatus[activeConn.id] === "connected"
    : false;
  const isBroadcast = activeConn?.slaveId === BROADCAST_SLAVE_ID;

  /** 当前标签看的是哪个寄存器区域 */
  const activeArea = activeTab ? tabArea(activeTab) : null;

  /**
   * 该标签所属连接（= 它所看那台"设备"）的镜像（R3）。
   * ⭐ 值的来源是**连接**而不是标签：同一个物理寄存器在所有引用该连接的标签里
   * 看到的是同一份值。标签只是视图。
   */
  const activeImage: ConnectionRegisterImage | undefined = activeConn
    ? registerImages[activeConn.id]
    : undefined;

  /** 当前窗口的表格行 —— 四区同构，**一行 = 一个寄存器**（Q20） */
  const activeRows: RegisterData[] = useMemo(() => {
    if (!activeTab || !activeArea) return [];
    const isSingleWrite = activeTab.functionCode === '05' || activeTab.functionCode === '06';
    const count = isSingleWrite ? 1 : Math.max(1, activeTab.registerCount);
    return readRegisterRows(activeImage, activeArea, activeTab.startAddress, count);
  }, [activeTab, activeArea, activeImage]);

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

  /**
   * 写入草稿：**窗口身份 → (寄存器序号 → 待写入值)**。
   *
   * ⚠️ 按窗口分桶，而不是一张全局表：草稿若不带窗口身份，标签 A 在地址 3 的草稿
   * 会串到标签 B（slave 侧踩过同一个坑，见 ROADMAP §3.2「R1 后续修复：跨区串值」）。
   *
   * ⚠️ 草稿值的口径是**寄存器**：位区的一个草稿值就是"该寄存器的 16 位打包字"，
   * 与表格一行、与镜像一格完全对应。
   */
  const [writeDrafts, setWriteDrafts] = useState<Record<string, Map<number, number>>>({});

  /**
   * 当前窗口的草稿桶。
   *
   * ⚠️ `registerWindowKey()` **必须包在 useMemo 里，不要在渲染期直接调用**：
   * 实测在渲染期调用一个编译器无法证明纯度的模块级函数，会让 React Compiler
   * **跳过整个组件**的编译，报 `react-hooks/preserve-manual-memoization`，
   * 且报错会落在与本次改动无关的回调上，极难定位。
   */
  const writeDraft: Map<number, number> = useMemo(
    () =>
      (activeTab ? writeDrafts[registerWindowKey(activeTab)] : undefined) ??
      new Map<number, number>(),
    [activeTab, writeDrafts],
  );

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
      registerCount: 10,
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
        tab.registerCount,
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
    (
      tab: RegisterTab,
      address: number,
      raw: string,
      format?: DataDisplayFormat,
      span?: number,
    ) => {
      const fmt = format ?? tab.displayFormat;
      // 草稿按**窗口身份**分桶存：切走再切回来还在，别的窗口看不到（R3）
      const key = registerWindowKey(tab);
      const writeInto = (entries: [number, number][]) => {
        setWriteDrafts((prev) => {
          const next = new Map(prev[key] ?? []);
          for (const [addr, value] of entries) next.set(addr, value);
          return { ...prev, [key]: next };
        });
      };

      if (span && span > 1) {
        // 宽类型（32/64 位）：解析为格式化值后拆分回 span 个 16 位寄存器原始值
        const regs = encodeValueToRegisters(
          parseDisplayValue(raw, fmt),
          fmt,
          tab.byteOrder32,
          tab.byteOrder64,
        );
        if (regs.length !== span) return;
        writeInto(regs.map((value, i) => [address + i, value] as [number, number]));
      } else {
        const num = parseDisplayValue(raw, fmt);
        if (num === null) return;
        writeInto([[address, num]]);
      }
      setEditingCell(null);
    },
    [],
  );

  // 整段批量提交：startAddress 起 registerCount 个值（草稿覆盖 + 未编辑行回填**镜像现值**）
  const commitWriteDraft = useCallback(
    (tab: RegisterTab) => {
      if (!isConnected) return;
      const area = tabArea(tab);
      if (!area) return;
      const isSingle = tab.functionCode === '05' || tab.functionCode === '06';
      const count = isSingle ? 1 : Math.max(1, tab.registerCount);
      const key = registerWindowKey(tab);
      const draft = writeDrafts[key] ?? new Map<number, number>();

      // ⭐ 回填的"原值"取自**该连接的设备镜像**（不是标签自己的缓存）：
      // 同一个物理寄存器在所有标签里是同一份值。
      const conn = connections.find((c) => c.id === tab.connectionId);
      const image = conn ? registerImages[conn.id] : undefined;
      const rows = readRegisterRows(image, area, tab.startAddress, count);
      const values: number[] = rows.map((row) => draft.get(row.address) ?? row.rawValue);

      // 提交后只清空**本窗口**的草稿
      const nextDraft = new Map(draft);
      for (let i = 0; i < count; i++) nextDraft.delete(tab.startAddress + i);

      if (isBroadcast) {
        setPendingWrite({ tab, values, startAddress: tab.startAddress });
        setBroadcastConfirmOpen(true);
        // 广播确认后再清空，因此这里不清空草稿
      } else {
        performWrite(tab, values, tab.startAddress);
        setWriteDrafts((prev) => ({ ...prev, [key]: nextDraft }));
      }
    },
    [isConnected, connections, registerImages, writeDrafts, isBroadcast, performWrite],
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
      // 清空已提交区间的草稿（只动本窗口的桶）
      const count =
        pendingWrite.tab.functionCode === '05' || pendingWrite.tab.functionCode === '06'
          ? 1
          : Math.max(1, pendingWrite.tab.registerCount);
      const start = pendingWrite.startAddress ?? pendingWrite.tab.startAddress;
      const key = registerWindowKey(pendingWrite.tab);
      setWriteDrafts((prev) => {
        const next = new Map(prev[key] ?? []);
        for (let i = 0; i < count; i++) next.delete(start + i);
        return { ...prev, [key]: next };
      });
      setPendingWrite(null);
    }
    setBroadcastConfirmOpen(false);
  }, [pendingWrite, performWrite]);

  // 切换标签 / 换功能码 / 改窗口范围时，只清理**编辑态** —— 那几行已经不属于当前窗口了。
  //
  // ⚠️ 草稿**不在这里清**：草稿按窗口身份分桶保存，切走再切回来原样还在；
  // 而"别的窗口看不到它"是分桶本身带来的，不需要靠清空来挡。
  // ——**"不串"和"不丢"是同一套机制的两面**。
  useEffect(() => {
    setEditingCell(null);
    setEditingFormatRow(null);
    setEditingTabId(null);
  }, [activeTabId, activeTab?.functionCode, activeTab?.startAddress, activeTab?.registerCount]);

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
      {activeTab && activeConn && activeArea && (
        <ConfigBar
          tab={activeTab}
          area={activeArea}
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
      {activeTab && activeArea ? (
        <DataTable
          tab={activeTab}
          area={activeArea}
          rows={activeRows}
          writeDraft={writeDraft}
          onUpdate={updateTab}
          onRead={() => handleRead(activeTab)}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          cellValue={cellValue}
          setCellValue={setCellValue}
          onCommitCellEdit={(address, raw, fmt, span) =>
            commitCellEdit(activeTab, address, raw, fmt ?? activeTab.displayFormat, span ?? 1)
          }
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
  area,
  rows,
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
  /** 该标签看的寄存器区域（决定是否按"16 位打包"呈现） */
  area: RegisterArea;
  /** 当前窗口的行：**一行 = 一个寄存器**（四区同构，Q20） */
  rows: RegisterData[];
  writeDraft: Map<number, number>;
  onUpdate: (tabId: string, updates: Partial<RegisterTab>) => void;
  onRead: () => void;
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  cellValue: string;
  setCellValue: (v: string) => void;
  onCommitCellEdit: (address: number, raw: string, format?: DataDisplayFormat, span?: number) => void;
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
  /** 位区（线圈 / 离散输入）：一行 = 1 寄存器 = 16 个位地址 */
  const isBit = isBitArea(area);
  const rowCount = rows.length;

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
            // ⭐ 位区：一行 = 一个寄存器 = 16 个位地址 ⇒ 固定按 LED 组呈现（Q20 四区同构）
            const format: DataDisplayFormat = isBit ? 'led' : (res?.format ?? tab.displayFormat);
            // 写入：仅分组起点可编辑（含 32/64 位宽类型）；被占用的后续地址不可编辑。
            // 编辑（暂存草稿）不依赖连接状态，仅"写入"提交才要求已连接。
            const canEdit = isGroupStart && isWriteFc;
            const isDrafted = writeDraft.has(item.address);
            const draftValue = writeDraft.get(item.address);
            // 起点且空间足够才计算格式化值；占用行 / 越界组显示 —
            const displayValue =
              isGroupStart && groupFits
                ? formatRegisterValue(rows, index, format, tab.byteOrder32, tab.byteOrder64)
                : "—";
            // 宽类型整组草稿展示：整组地址均已编辑时按草稿重算格式化值
            let groupDisplay = displayValue;
            if (isGroupStart && groupSpan > 1) {
              const addrs = Array.from({ length: groupSpan }, (_, k) => rows[index + k]?.address ?? 0);
              const drafted = addrs.map((a) => writeDraft.get(a));
              if (drafted.every((v) => v !== undefined)) {
                const eff: RegisterData[] = addrs.map((a, k) => ({ address: a, rawValue: drafted[k]! }));
                groupDisplay = formatRegisterValue(eff, 0, format, tab.byteOrder32, tab.byteOrder64);
              }
            }
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
                {/* 地址（寄存器编号；位区旁附只读的位范围，Q20） */}
                <td className="w-24 px-3 py-1.5 font-mono text-data font-semibold">
                  {isDrafted && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                  )}
                  {item.address}
                  {isBit && (
                    <span className="ml-1.5 rounded bg-foreground/10 px-1 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                      {t("bitLabel")} {item.address * BITS_PER_REGISTER} ~{" "}
                      {item.address * BITS_PER_REGISTER + BITS_PER_REGISTER - 1}
                    </span>
                  )}
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
                      onBlur={() => onCommitCellEdit(item.address, cellValue, format, groupSpan)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCommitCellEdit(item.address, cellValue, format, groupSpan);
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
                      {groupSpan > 1
                        ? groupDisplay
                        : isDrafted && draftValue !== undefined
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
          tab.registerCount,
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
  area,
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
  /** 该标签看的寄存器区域（决定是否给出只读的位范围提示） */
  area: RegisterArea;
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
  const isBit = isBitArea(area);
  /** 位区的只读位范围（Q20：主显示是寄存器编号，位范围挂在旁边作参考） */
  const bitStart = tab.startAddress * BITS_PER_REGISTER;
  const bitEnd = (tab.startAddress + Math.max(1, tab.registerCount)) * BITS_PER_REGISTER - 1;

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

      {/* 起始地址（寄存器编号；位区旁附只读起始位） */}
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
        {isBit && (
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {t("bitLabel")} {bitStart}
          </span>
        )}
      </label>

      <span className="h-4 w-px bg-border/30" />

      {/* 寄存器数量（四区同一标签、同一单位；位区旁附只读位范围） */}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("registerCount")}
        <Input
          type="number"
          min={1}
          max={125}
          value={tab.registerCount}
          onChange={(e) =>
            onUpdate(tab.id, { registerCount: Number(e.target.value) || 1 })
          }
          className="h-6 w-16 border-border/40 bg-background px-2 text-xs"
        />
        {isBit && (
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {t("bitLabel")} {bitStart} ~ {bitEnd}
          </span>
        )}
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
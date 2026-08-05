'use client';

import { useEffect, useState } from 'react';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

const resources = {
  zh: {
    translation: {
      app: {
        title: 'MODBUS 主站',
      },
      connection: {
        title: '连接',
        protocol: '协议',
        host: '主机',
        port: '端口',
        unitId: '单元 ID',
        timeout: '超时 (ms)',
        connect: '连接',
        disconnect: '断开',
        connections: '连接管理',
        name: '连接名称',
        connectionStatus: '连接状态',
        noConnections: '暂无连接',
        editing: '编辑连接',
        addConnection: '添加连接',
        editConnection: '编辑连接',
        defaultName: '本地连接',
        status: {
          online: '在线',
          offline: '离线',
        },
      },
      common: {
        add: '添加',
        edit: '编辑',
        delete: '删除',
        save: '保存',
        cancel: '取消',
        close: '关闭',
      },
      settings: {
        title: '全局设置',
        byteOrder: '默认字节序',
        signed: '默认符号类型',
        signedLabel: '有符号',
        unsignedLabel: '无符号',
      },
      readPanel: {
        functionCode: '功能码',
        startAddr: '起始地址',
        quantity: '数量',
        read: '读取',
        autoPolling: '自动轮询',
        interval: '间隔 (ms)',
        start: '开始',
        stop: '停止',
      },
      writePanel: {
        functionCode: '功能码',
        address: '地址',
        value: '值',
        write: '写入',
      },
      dataPanel: {
        functionCode: '功能码',
      },
      displayFormat: {
        decimal: '十进制',
        hexadecimal: '十六进制',
        binary: '二进制',
        float: '浮点数',
      },
      dataGrid: {
        address: '地址',
        decimal: '十进制',
        hex: '十六进制',
        binary: '二进制',
        float: '浮点数',
        page: '页',
        prevPage: '上一页',
        nextPage: '下一页',
        jumpToPage: '跳转',
        noData: '无数据',
        regsPerPage: '寄存器/页',
      },
      log: {
        title: '操作日志',
        clear: '清除',
        noLogs: '暂无操作记录',
        connectedSince: '连接于',
        fc: {
          1: '读线圈',
          2: '读离散输入',
          3: '读保持寄存器',
          4: '读输入寄存器',
          5: '写单个线圈',
          6: '写单个寄存器',
          15: '写多个线圈',
          16: '写多个寄存器',
        },
        type: {
          connect: '连接',
          disconnect: '断开',
          read: '读取',
          write: '写入',
          error: '错误',
        },
        msg: {
          connected: '已连接到 {host}:{port}',
          connectedFull: '已通过 {protocol} 连接到 {host}:{port} (单元 ID: {unitId})',
          disconnected: '已断开连接',
          disconnectedFull: '已断开与 {host}:{port} 的连接',
          readSuccess: '读取 {fc} - 地址 {address}，{count} 个数据',
          writeSuccess: '写入 {fc} - 地址 {address}，{count} 个数据',
          readFailed: '读取失败',
          writeFailed: '写入失败',
          notConnected: '未连接到设备',
          connectionFailed: '连接失败: {error}',
          protocol: {
            tcp: 'Modbus TCP/IP',
            udp: 'Modbus UDP/IP',
            rtu_tcp: 'Modbus RTU over TCP/IP',
          },
        },
      },
      lang: {
        zh: '中文',
        en: 'English',
      },
    },
  },
  en: {
    translation: {
      app: {
        title: 'MODBUS Master',
      },
      connection: {
        title: 'Connection',
        protocol: 'Protocol',
        host: 'Host',
        port: 'Port',
        unitId: 'Unit ID',
        timeout: 'Timeout (ms)',
        connect: 'Connect',
        disconnect: 'Disconnect',
        connections: 'Connections',
        name: 'Connection Name',
        connectionStatus: 'Connection Status',
        noConnections: 'No connections',
        editing: 'Editing Connection',
        addConnection: 'Add Connection',
        editConnection: 'Edit Connection',
        defaultName: 'Local Connection',
        status: {
          online: 'Online',
          offline: 'Offline',
        },
      },
      common: {
        add: 'Add',
        edit: 'Edit',
        delete: 'Delete',
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
      },
      settings: {
        title: 'Global Settings',
        byteOrder: 'Default Byte Order',
        signed: 'Default Sign Type',
        signedLabel: 'Signed',
        unsignedLabel: 'Unsigned',
      },
      readPanel: {
        functionCode: 'Function Code',
        startAddr: 'Start Address',
        quantity: 'Quantity',
        read: 'Read',
        autoPolling: 'Auto Polling',
        interval: 'Interval (ms)',
        start: 'Start',
        stop: 'Stop',
      },
      writePanel: {
        functionCode: 'Function Code',
        address: 'Address',
        value: 'Value',
        write: 'Write',
      },
      dataPanel: {
        functionCode: 'Function Code',
      },
      displayFormat: {
        decimal: 'Decimal',
        hexadecimal: 'Hexadecimal',
        binary: 'Binary',
        float: 'Float',
      },
      dataGrid: {
        address: 'Address',
        decimal: 'Decimal',
        hex: 'Hex',
        binary: 'Binary',
        float: 'Float',
        page: 'Page',
        prevPage: 'Prev',
        nextPage: 'Next',
        jumpToPage: 'Go',
        noData: 'No data',
        regsPerPage: 'regs/page',
      },
      log: {
        title: 'Operation Log',
        clear: 'Clear',
        noLogs: 'No operations logged',
        connectedSince: 'Connected since',
        fc: {
          1: 'Read Coils',
          2: 'Read Discrete Inputs',
          3: 'Read Holding Registers',
          4: 'Read Input Registers',
          5: 'Write Single Coil',
          6: 'Write Single Register',
          15: 'Write Multiple Coils',
          16: 'Write Multiple Registers',
        },
        type: {
          connect: 'Connect',
          disconnect: 'Disconnect',
          read: 'Read',
          write: 'Write',
          error: 'Error',
        },
        msg: {
          connected: 'Connected to {host}:{port}',
          connectedFull: 'Connected to {host}:{port} via {protocol} (Unit ID: {unitId})',
          disconnected: 'Disconnected',
          disconnectedFull: 'Disconnected from {host}:{port}',
          readSuccess: 'Read {fc} - Address {address}, {count} items',
          writeSuccess: 'Write {fc} - Address {address}, {count} items',
          readFailed: 'Read failed',
          writeFailed: 'Write failed',
          notConnected: 'Not connected to device',
          connectionFailed: 'Connection failed: {error}',
          protocol: {
            tcp: 'Modbus TCP/IP',
            udp: 'Modbus UDP/IP',
            rtu_tcp: 'Modbus RTU over TCP/IP',
          },
        },
      },
      lang: {
        zh: '中文',
        en: 'English',
      },
    },
  },
};

if (!i18n.isInitialized) {
  const savedLang = typeof window !== 'undefined' ? localStorage.getItem('modbus-lang') || 'zh' : 'zh';
  i18n.use(initReactI18next).init({
    resources,
    lng: savedLang,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });
}

export function useI18n() {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState(i18n.language || 'zh');

  const changeLanguage = (newLang: string) => {
    i18n.changeLanguage(newLang);
    localStorage.setItem('modbus-lang', newLang);
    setLang(newLang);
  };

  return { lang, changeLanguage };
}

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

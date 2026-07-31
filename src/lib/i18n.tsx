'use client';

import { useEffect } from 'react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  zh: {
    translation: {
      app: {
        title: 'MODBUS 主站',
      },
      connection: {
        title: '连接',
        protocol: '协议',
        ip: 'IP',
        port: '端口',
        unitId: '单元 ID',
        timeout: '超时 (ms)',
        connect: '连接',
        disconnect: '断开',
      },
      read: {
        title: '读取寄存器',
        functionCode: '功能码',
        startAddr: '起始地址',
        quantity: '数量',
        read: '读取',
        autoPolling: '自动轮询',
        interval: '间隔 (ms)',
        start: '开始',
        stop: '停止',
      },
      write: {
        title: '写入寄存器',
        address: '地址',
        value: '值',
        write: '写入',
      },
      data: {
        title: '寄存器数据',
        page: '页',
        of: '/',
        prev: '上一页',
        next: '下一页',
        goTo: '跳转',
        hex: '十六进制',
        dec: '十进制',
        bin: '二进制',
        flt: '单精度浮点',
        dlb: '双精度浮点',
        byteOrder: '字节序',
        littleEndian: '小端',
        bigEndian: '大端',
        signed: '有符号',
        unsigned: '无符号',
      },
      log: {
        title: '操作日志',
        clear: '清除',
      },
      status: {
        online: '在线',
        offline: '离线',
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
        ip: 'IP',
        port: 'Port',
        unitId: 'Unit ID',
        timeout: 'Timeout (ms)',
        connect: 'Connect',
        disconnect: 'Disconnect',
      },
      read: {
        title: 'Read Registers',
        functionCode: 'Function Code',
        startAddr: 'Start Address',
        quantity: 'Quantity',
        read: 'Read',
        autoPolling: 'Auto Polling',
        interval: 'Interval (ms)',
        start: 'Start',
        stop: 'Stop',
      },
      write: {
        title: 'Write Registers',
        address: 'Address',
        value: 'Value',
        write: 'Write',
      },
      data: {
        title: 'Register Data',
        page: 'Page',
        of: '/',
        prev: 'Prev',
        next: 'Next',
        goTo: 'Go',
        hex: 'Hex',
        dec: 'Dec',
        bin: 'Bin',
        flt: 'Float',
        dlb: 'Double',
        byteOrder: 'Byte Order',
        littleEndian: 'Little Endian',
        bigEndian: 'Big Endian',
        signed: 'Signed',
        unsigned: 'Unsigned',
      },
      log: {
        title: 'Operation Log',
        clear: 'Clear',
      },
      status: {
        online: 'Online',
        offline: 'Offline',
      },
    },
  },
};

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: 'zh',
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });
}

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // i18n is already initialized above
  }, []);

  return <>{children}</>;
}

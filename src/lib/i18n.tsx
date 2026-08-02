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
        ip: 'IP',
        port: '端口',
        unitId: '单元 ID',
        timeout: '超时 (ms)',
        connect: '连接',
        disconnect: '断开',
        connections: '连接管理',
        name: '连接名称',
        noConnections: '暂无连接',
        editing: '编辑连接',
      },
      common: {
        add: '添加',
        edit: '编辑',
        delete: '删除',
        save: '保存',
        cancel: '取消',
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
      dataGrid: {
        address: '地址',
        decimal: '十进制',
        hex: '十六进制',
        binary: '二进制',
        page: '页',
        prevPage: '上一页',
        nextPage: '下一页',
        jumpToPage: '跳转',
      },
      log: {
        title: '操作日志',
        clear: '清除',
        noLogs: '暂无操作记录',
      },
      status: {
        online: '在线',
        offline: '离线',
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
        ip: 'IP',
        port: 'Port',
        unitId: 'Unit ID',
        timeout: 'Timeout (ms)',
        connect: 'Connect',
        disconnect: 'Disconnect',
        connections: 'Connections',
        name: 'Connection Name',
        noConnections: 'No connections',
        editing: 'Editing Connection',
      },
      common: {
        add: 'Add',
        edit: 'Edit',
        delete: 'Delete',
        save: 'Save',
        cancel: 'Cancel',
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
      dataGrid: {
        address: 'Address',
        decimal: 'Decimal',
        hex: 'Hex',
        binary: 'Binary',
        page: 'Page',
        prevPage: 'Prev',
        nextPage: 'Next',
        jumpToPage: 'Go',
      },
      log: {
        title: 'Operation Log',
        clear: 'Clear',
        noLogs: 'No operations logged',
      },
      status: {
        online: 'Online',
        offline: 'Offline',
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

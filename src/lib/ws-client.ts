export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
}

export interface WsOptions {
  path: string;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
  reconnect?: boolean;
  heartbeatMs?: number;
}

export function createWsConnection(opts: WsOptions): {
  send: (msg: WsMessage) => void;
  close: () => void;
  readyState: () => number;
} {
  const {
    path,
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    heartbeatMs = 30000,
  } = opts;
  let ws: WebSocket;
  let heartbeatTimer: ReturnType<typeof setInterval>;
  let closed = false;

  function connect() {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}${path}`);

    ws.onopen = () => {
      heartbeatTimer = setInterval(
        () => ws.send(JSON.stringify({ type: 'ping', payload: null })),
        heartbeatMs,
      );
      onOpen?.();
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        if (msg.type === 'pong') return;
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      onClose?.();
      if (reconnect && !closed) setTimeout(connect, 1000);
    };

    ws.onerror = (err) => {
      onError?.(err);
    };
  }

  connect();

  return {
    send: (msg) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close: () => {
      closed = true;
      clearInterval(heartbeatTimer);
      ws?.close();
    },
    readyState: () => ws?.readyState ?? WebSocket.CLOSED,
  };
}
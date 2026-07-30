import { NextRequest, NextResponse } from 'next/server';
import { modbusManager, type ModbusProtocol } from '@/lib/modbus-client';

const VALID_PROTOCOLS: ModbusProtocol[] = ['tcp', 'udp', 'rtu_tcp'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, port, unitId, timeout, protocol } = body;

    if (!host || typeof host !== 'string') {
      return NextResponse.json({ success: false, error: 'Host is required' }, { status: 400 });
    }
    if (!port || typeof port !== 'number' || port < 1 || port > 65535) {
      return NextResponse.json({ success: false, error: 'Valid port (1-65535) is required' }, { status: 400 });
    }
    if (unitId === undefined || typeof unitId !== 'number' || unitId < 1 || unitId > 247) {
      return NextResponse.json({ success: false, error: 'Valid Unit ID (1-247) is required' }, { status: 400 });
    }
    if (protocol && !VALID_PROTOCOLS.includes(protocol)) {
      return NextResponse.json(
        { success: false, error: `Invalid protocol. Must be one of: ${VALID_PROTOCOLS.join(', ')}` },
        { status: 400 }
      );
    }

    const log = await modbusManager.connect({ host, port, unitId, timeout, protocol: protocol || 'tcp' });
    if (!log.success) {
      return NextResponse.json({ success: false, error: log.message, data: log }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: log });
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}

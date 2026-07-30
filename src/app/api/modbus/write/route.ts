import { NextRequest, NextResponse } from 'next/server';
import { modbusManager, type ModbusLogEntry } from '@/lib/modbus-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { functionCode, address, values } = body;

    if (typeof functionCode !== 'number' || ![5, 6, 15, 16].includes(functionCode)) {
      return NextResponse.json(
        { success: false, error: 'functionCode must be 5, 6, 15, or 16' },
        { status: 400 }
      );
    }
    if (typeof address !== 'number' || address < 0 || address > 65535) {
      return NextResponse.json(
        { success: false, error: 'Valid address (0-65535) is required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(values) || values.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Values must be a non-empty array' },
        { status: 400 }
      );
    }

    let log: ModbusLogEntry;
    switch (functionCode) {
      case 5:
        if (typeof values[0] !== 'boolean') {
          return NextResponse.json(
            { success: false, error: 'Coil value must be boolean' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeSingleCoil(address, values[0]);
        break;
      case 6:
        if (typeof values[0] !== 'number' || values[0] < 0 || values[0] > 65535) {
          return NextResponse.json(
            { success: false, error: 'Register value must be 0-65535' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeSingleRegister(address, values[0]);
        break;
      case 15:
        if (!values.every((v: unknown) => typeof v === 'boolean')) {
          return NextResponse.json(
            { success: false, error: 'All coil values must be boolean' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeMultipleCoils(address, values);
        break;
      case 16:
        if (!values.every((v: unknown) => typeof v === 'number' && v >= 0 && v <= 65535)) {
          return NextResponse.json(
            { success: false, error: 'All register values must be 0-65535' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeMultipleRegisters(address, values);
        break;
      default:
        return NextResponse.json({ success: false, error: 'Unsupported function code' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: log });
  } catch (error) {
    const errObj = error as { type?: string; message?: string; success?: boolean; timestamp?: number; id?: string };
    if (errObj.type === 'error') {
      return NextResponse.json({ success: false, error: errObj.message, log: errObj }, { status: 502 });
    }
    const msg = error instanceof Error ? error.message : 'Write operation failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

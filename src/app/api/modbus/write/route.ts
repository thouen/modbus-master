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

    // Modbus 规范数量限制：
    // FC05/FC06（写单个）：必须为 1 个
    // FC15（写多个线圈）：最大 1968 个
    // FC16（写多个寄存器）：最大 123 个
    if (functionCode === 5 || functionCode === 6) {
      if (values.length !== 1) {
        return NextResponse.json(
          { success: false, error: `FC${functionCode} requires exactly 1 value` },
          { status: 400 }
        );
      }
    } else if (functionCode === 15 && values.length > 1968) {
      return NextResponse.json(
        { success: false, error: 'FC15: maximum 1968 coils allowed' },
        { status: 400 }
      );
    } else if (functionCode === 16 && values.length > 123) {
      return NextResponse.json(
        { success: false, error: 'FC16: maximum 123 registers allowed' },
        { status: 400 }
      );
    }
    // Filter out NaN/Infinity values that could cause buffer length mismatch
    const cleanValues = values.filter((v: number | boolean) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)));
    if (cleanValues.length === 0) {
      return NextResponse.json(
        { success: false, error: 'All values are invalid (NaN or Infinity)' },
        { status: 400 }
      );
    }

    let log: ModbusLogEntry;
    switch (functionCode) {
      case 5:
        if (typeof cleanValues[0] !== 'boolean') {
          return NextResponse.json(
            { success: false, error: 'Coil value must be boolean' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeSingleCoil(address, cleanValues[0]);
        break;
      case 6:
        if (typeof cleanValues[0] !== 'number' || cleanValues[0] < 0 || cleanValues[0] > 65535) {
          return NextResponse.json(
            { success: false, error: 'Register value must be 0-65535' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeSingleRegister(address, cleanValues[0]);
        break;
      case 15:
        if (!cleanValues.every((v: unknown) => typeof v === 'boolean')) {
          return NextResponse.json(
            { success: false, error: 'All coil values must be boolean' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeMultipleCoils(address, cleanValues as boolean[]);
        break;
      case 16:
        if (!cleanValues.every((v: unknown) => typeof v === 'number' && v >= 0 && v <= 65535)) {
          return NextResponse.json(
            { success: false, error: 'All register values must be 0-65535' },
            { status: 400 }
          );
        }
        log = await modbusManager.writeMultipleRegisters(address, cleanValues as number[]);
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

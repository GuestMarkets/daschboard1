// app/api/_utils/responses.ts
import { NextResponse } from 'next/server';

/**
 * OK JSON response helper.
 * - Accepts either a numeric status (e.g., 201) or a full ResponseInit object.
 */
export function jsonOk<T>(data: T, init?: number): NextResponse;
export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse;
export function jsonOk<T>(data: T, init?: number | ResponseInit): NextResponse {
  const resInit: ResponseInit | undefined =
    typeof init === 'number' ? { status: init } : init;

  return NextResponse.json({ ok: true, data }, resInit);
}

/**
 * Error JSON response helper.
 * - Second arg can be a status code (number) or a full ResponseInit.
 * - By default returns status 400.
 */
export function jsonError(
  message: string,
  statusOrInit?: number,
  extra?: Record<string, unknown>
): NextResponse;
export function jsonError(
  message: string,
  statusOrInit?: ResponseInit,
  extra?: Record<string, unknown>
): NextResponse;
export function jsonError(
  message: string,
  statusOrInit: number | ResponseInit = 400,
  extra?: Record<string, unknown>
): NextResponse {
  const resInit: ResponseInit =
    typeof statusOrInit === 'number' ? { status: statusOrInit } : statusOrInit;

  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    resInit
  );
}

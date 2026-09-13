/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {z} from 'zod';

export const profileNames = ['cesar', 'tyson'] as const;
export type ProfileName = (typeof profileNames)[number];
const absolutePath = z.string().refine(path.isAbsolute, 'Use an absolute path');
export const configSchema = z.object({
  version: z.literal(1),
  stateDir: absolutePath,
  workerEntry: absolutePath,
  allowedRoots: z.array(absolutePath).min(1),
  profiles: z.object({cesar: absolutePath, tyson: absolutePath}),
  profileExtensions: z
    .object({
      cesar: z.array(absolutePath).default([]),
      tyson: z.array(absolutePath).default([]),
    })
    .optional(),
});
export type ManagerConfig = z.infer<typeof configSchema>;
export interface ManagerRuntime {
  url: string;
  token: string;
  pid: number;
}
export interface ProfileRuntime {
  pid: number;
  endpoint: string;
  startedAt: string;
  extensions?: Array<{id: string; path: string}>;
}

export function configPath(): string {
  return (
    process.env.JS_REVERSE_MANAGER_CONFIG ??
    path.join(os.homedir(), '.config/js-reverse-manager/config.json')
  );
}

export function readConfig(filename = configPath()): ManagerConfig {
  return configSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
}

export function readJSON<T>(filename: string): T {
  return JSON.parse(readFileSync(filename, 'utf8')) as T;
}

export function writePrivateJSON(filename: string, value: unknown): void {
  mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(temporary, filename);
}

export function runtimePath(config: ManagerConfig): string {
  return path.join(config.stateDir, 'manager.json');
}

export function profileRuntime(
  config: ManagerConfig,
  name: ProfileName,
): ProfileRuntime | undefined {
  try {
    const state = readJSON<ProfileRuntime>(
      path.join(config.stateDir, `${name}.json`),
    );
    process.kill(state.pid, 0);
    const endpoint = new URL(state.endpoint);
    if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1')
      return;
    return state;
  } catch {
    return;
  }
}

export async function control<T>(
  route: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const config = readConfig();
  const runtime = readJSON<ManagerRuntime>(runtimePath(config));
  const response = await fetch(new URL(route, runtime.url), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${runtime.token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json()) as T & {error?: string};
  if (!response.ok)
    throw new Error(result.error ?? `Manager returned ${response.status}`);
  return result;
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TargetInfo {
  targetId: string;
  type: string;
  title?: string;
  url?: string;
}
export interface SessionInfo {
  id: string;
  sessionId: string;
  parentSessionId?: string;
  targetId: string;
  type: string;
  title: string;
  url: string;
}
interface Message {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: {sessionId?: string; targetId?: string; targetInfo?: TargetInfo};
  result?: {sessionId?: string};
}

// Strip URL credentials, query strings, and fragments from menu metadata.
// CDP messages themselves are forwarded byte-for-byte and never retained.
function displayURL(raw = ''): string {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:', 'chrome:', 'chrome-extension:', 'about:'].includes(
        url.protocol,
      )
    )
      return url.protocol;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href.slice(0, 600);
  } catch {
    return '';
  }
}

export class SessionTracker {
  readonly sessions = new Map<string, SessionInfo>();
  readonly #targets = new Map<string, TargetInfo>();
  readonly #attaching = new Map<string, {targetId: string; parent?: string}>();
  constructor(readonly connectionId: string) {}

  observe(raw: string, direction: 'request' | 'response'): void {
    // Parse target metadata and outstanding attachment replies only. Long target
    // URLs still count; a payload-size cutoff would make the inventory incomplete.
    if (!raw.includes('"Target.') && this.#attaching.size === 0) return;
    let message: Message;
    try {
      message = JSON.parse(raw) as Message;
    } catch {
      return;
    }
    const key = `${message.sessionId ?? ''}:${message.id}`;
    if (direction === 'request') {
      if (
        message.method === 'Target.attachToTarget' ||
        message.method === 'Target.attachToBrowserTarget'
      ) {
        this.#attaching.set(key, {
          targetId: message.params?.targetId ?? 'browser',
          parent: message.sessionId,
        });
      }
      return;
    }
    if (
      message.method === 'Target.attachedToTarget' &&
      message.params?.sessionId &&
      message.params.targetInfo
    ) {
      this.add(
        message.params.sessionId,
        message.params.targetInfo,
        message.sessionId,
      );
    } else if (
      message.method === 'Target.detachedFromTarget' &&
      message.params?.sessionId
    ) {
      this.remove(message.params.sessionId);
    } else if (
      message.method === 'Target.targetInfoChanged' ||
      message.method === 'Target.targetCreated'
    ) {
      const info = message.params?.targetInfo;
      if (info) {
        this.#targets.set(info.targetId, info);
        for (const session of this.sessions.values()) {
          if (session.targetId === info.targetId)
            this.add(session.sessionId, info, session.parentSessionId);
        }
      }
    } else if (
      message.method === 'Target.targetDestroyed' &&
      message.params?.targetId
    ) {
      this.#targets.delete(message.params.targetId);
      for (const session of this.sessions.values()) {
        if (session.targetId === message.params.targetId)
          this.remove(session.sessionId);
      }
    }
    const attaching = this.#attaching.get(key);
    if (message.id !== undefined && attaching) {
      this.#attaching.delete(key);
      if (
        message.result?.sessionId &&
        !this.sessions.has(message.result.sessionId)
      ) {
        this.add(
          message.result.sessionId,
          this.#targets.get(attaching.targetId) ?? {
            targetId: attaching.targetId,
            type: attaching.targetId === 'browser' ? 'browser' : 'target',
          },
          attaching.parent,
        );
      }
    }
  }

  private add(
    sessionId: string,
    target: TargetInfo,
    parentSessionId?: string,
  ): void {
    this.#targets.set(target.targetId, target);
    this.sessions.set(sessionId, {
      id: `${this.connectionId}:${sessionId}`,
      sessionId,
      parentSessionId,
      targetId: target.targetId,
      type: target.type,
      title: (target.title ?? '')
        .replace(/(?:https?:|chrome-extension:)\/\/\S+/g, value =>
          displayURL(value),
        )
        .slice(0, 240),
      url: displayURL(target.url),
    });
  }

  remove(sessionId: string): void {
    const target = this.sessions.get(sessionId)?.targetId;
    this.sessions.delete(sessionId);
    if (
      target &&
      ![...this.sessions.values()].some(session => session.targetId === target)
    )
      this.#targets.delete(target);
    for (const child of this.sessions.values()) {
      if (child.parentSessionId === sessionId) this.remove(child.sessionId);
    }
  }
}

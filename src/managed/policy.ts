/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {ProfileName} from './config.js';

// Match registrable service hosts and their subdomains, never URL substrings.
// Purpose classification covers providers not yet in this deterministic list.
const cesarDomains = [
  'openrouter.ai',
  'x.com',
  'twitter.com',
  't.co',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'gcp.gvt2.com',
  'youtube.com',
  'youtu.be',
  'vultr.com',
  'aws.amazon.com',
  'console.aws.amazon.com',
  'digitalocean.com',
  'linode.com',
  'akamai.com',
  'hetzner.com',
  'azure.com',
  'portal.azure.com',
  'cloudflare.com',
  'oraclecloud.com',
];

export interface RouteRequest {
  profile?: ProfileName | 'auto';
  url?: string;
  purpose: string;
  service?: 'general' | 'learning' | 'cloud' | 'google' | 'openrouter' | 'x';
}

export function chooseProfile(request: RouteRequest): {
  profile: ProfileName;
  reason: string;
} {
  if (request.profile && request.profile !== 'auto') {
    return {profile: request.profile, reason: 'Explicit profile choice'};
  }
  if (request.url) {
    const url = new URL(request.url);
    if (!['https:', 'http:', 'about:'].includes(url.protocol)) {
      throw new Error(
        'Start a browsing activity with an HTTP(S) URL or about:blank',
      );
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      cesarDomains.some(
        domain => host === domain || host.endsWith(`.${domain}`),
      )
    ) {
      return {profile: 'cesar', reason: `Known Cesar service: ${host}`};
    }
  }
  if (
    request.service &&
    ['cloud', 'google', 'openrouter', 'x'].includes(request.service)
  ) {
    return {
      profile: 'cesar',
      reason: `Activity classified as ${request.service}`,
    };
  }
  return {
    profile: 'tyson',
    reason:
      request.service === 'learning'
        ? 'Learning activity'
        : 'Default browsing identity',
  };
}

/** Type declarations for scripts/security-headers.mjs (allowJs is off). */
export declare const PROVIDER_ORIGINS: string[];
export declare function buildCsp(opts?: { frameAncestors?: boolean; scriptHashes?: string[] }): string;
export declare function buildSecurityHeaders(): Record<string, string>;
export declare function expectedHeadersFile(): string;
export declare function expectedVercelConfig(): {
  $schema: string;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

export interface ProxyHealth {
  ok: boolean;
  service: string;
  configured: boolean;
  provider: string;
  model: string;
  allowedModels: string[];
  label: string;
}

export declare function handleProxy(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response>;

export declare function createNodeMiddleware(
  env: Record<string, string | undefined>,
): (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;

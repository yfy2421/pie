/**
 * Shared types for route handlers
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { TsserverManager } from "../ts-server";

export interface ChatStreamState {
  buffer: string;
  response: ServerResponse | null;
  currentWorkspace?: string;
}

export interface ServerContext {
  session: any;
  modelRegistry: any;
  chatStream: ChatStreamState;
  sseClients: ServerResponse[];
  tsServer?: TsserverManager;
  paths: {
    APP_ROOT: string;
    DATA_DIR: string;
    PI_CONFIG_DIR: string;
    SESSIONS_DIR: string;
    SETTINGS_FILE: string;
    FRONTEND_DIR: string;
    FRONTEND_SRC_DIR: string;
    HAS_BUILT_FRONTEND: boolean;
  };
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
) => boolean | Promise<boolean>;

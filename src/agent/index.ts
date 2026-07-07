/**
 * Agent layer — 在 PI 框架之上叠自定义层
 *
 * 封装 createAgentSession()，注入自定义 system prompt sections、
 * 自定义工具，并为后续的 system prompt 分片缓存、子 Agent 编排
 * 提供扩展点。
 *
 * 原则：只封装，不 fork。PI 的 agent-loop 不改。
 */
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "path";
import { resolveSystemPrompt } from "./prompts";
import { customTools } from "./tools";

export interface AgentConfig {
  agentDir: string;
  cwd: string;
  sessionsDir: string;
  authFile: string;
  modelsFile: string;
}

/**
 * Initialize the agent session with custom configuration.
 *
 * Usage:
 *   const { session, cleanup } = await initAgent({ ... });
 */
export async function initAgent(config: AgentConfig) {
  const {
    agentDir,
    cwd,
    sessionsDir,
    authFile,
    modelsFile,
  } = config;

  const authStorage = AuthStorage.create(authFile);
  const modelRegistry = ModelRegistry.create(authStorage, modelsFile);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
  });
  await loader.reload();

  const sessionManager = SessionManager.create(cwd, sessionsDir);

  // 组装 system prompt
  const systemPrompt = resolveSystemPrompt();

  const { session } = await createAgentSession({
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader: loader,
    cwd,
    sessionManager,
    tools: customTools.length > 0 ? customTools : undefined,
  });

  return {
    session,
    modelRegistry,
    authStorage,
    sessionManager,
    /** 清理资源 */
    cleanup: () => {
      // 后续扩展：断开 MCP 连接等
    },
  };
}

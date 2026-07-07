/**
 * System prompt section management
 *
 * 分片组装 system prompt，每片独立缓存。
 * 目标：类似 Claude Code 的 systemPromptSection() 模式。
 *
 * 当前实现：同步加载缓存的 sections。后续可扩展为按需刷新。
 */

export interface PromptSection {
  key: string;
  content: string;
  /** 是否需要每次重新计算（如环境信息） */
  volatile?: boolean;
}

const sectionCache = new Map<string, PromptSection>();

/**
 * 注册一个 system prompt section。
 * 相同 key 的 section 会被缓存，直到调用 invalidateSection(key)。
 */
export function defineSection(key: string, content: string, volatile = false): PromptSection {
  const section: PromptSection = { key, content, volatile };
  sectionCache.set(key, section);
  return section;
}

/**
 * 使某个 section 的缓存失效，下次 resolve 时重新计算。
 */
export function invalidateSection(key: string): void {
  sectionCache.delete(key);
}

/**
 * 合并所有已注册的 sections 为一个完整的 system prompt。
 */
export function resolveSystemPrompt(): string {
  const parts: string[] = [];
  for (const [, section] of sectionCache) {
    parts.push(section.content);
  }
  return parts.join("\n\n");
}

// ─── 默认 sections ─────────────────────────────────────────────

defineSection("identity", `你是 My Code Agent，一个基于 PI 框架的智能编程助手。
你通过工具与用户交互：读文件、写代码、执行命令、搜索内容。
`);

defineSection("tools_guidance", `## 工具使用指南

- 使用 Read 来查看文件内容
- 使用 Edit/Write 来修改文件
- 使用 Bash 来执行命令（编译、运行、测试）
- 使用 Glob/Grep 来搜索文件

注意安全：执行破坏性命令前需确认。
`);

defineSection("code_style", `## 代码风格

- TypeScript + ESM（"type": "module"）
- 注释密度与周围代码保持一致
- 使用 markdown 链接格式引用文件：\`[filename](path)\`
- 渐进式修改，不重写
`);

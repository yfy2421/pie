/**
 * Custom tool definitions for the agent.
 *
 * PI 框架内置 read/write/edit/bash/grep/find/ls 等工具。
 * 这里注册本项目的自定义工具，遵循 PI 的 Tool 接口。
 *
 * Tool 接口参考（来自 PI 的 packages/agent/src/types.ts）：
 *   interface Tool {
 *     name: string;
 *     description: string;
 *     parameters: { ... };
 *     execute: (args, context) => Promise<string>;
 *   }
 *
 * 安全原则：
 *   - 路径沙箱：所有文件操作限定在工作区内
 *   - 命令白名单：Bash 执行限制在安全的命令集合
 *   - 并发控制：同一文件的写入串行化
 */

// 当前使用 PI 内置工具，暂无自定义工具。
// 后续可在此注册：
//   - 项目专用的代码分析工具
//   - MCP 桥接工具
//   - 子 Agent 编排工具
//   - 自定义搜索/替换工具

export const customTools: any[] = [];

/**
 * 注册一个自定义工具。
 * 遵循 PI 的 Tool 接口。
 */
export function registerTool(tool: any): void {
  customTools.push(tool);
}

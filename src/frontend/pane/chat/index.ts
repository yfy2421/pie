/**
 * Chat (Session History) pane — 会话列表面板
 */
/// <reference path="../../dashboard.d.ts" />

function chatPaneRender(container: HTMLElement): void {
  container.innerHTML = [
    '<div class="sg-t">会话历史</div>',
    '<div class="session-actions"><button class="sa-btn" onclick="newSession()">+ 新会话</button></div>',
    '<div class="session-list" id="sl">加载中...</div>',
  ].join('');
  loadSessions();
}

registerPane('chat', chatPaneRender);

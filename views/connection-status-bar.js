// views/connection-status-bar.js
//
// Shared bridge connection status bar used by:
//   - 「其他平台」settings tab (variant: 'settings')
//   - 多平台发布弹窗     (variant: 'modal')
//
// Pure DOM rendering — no `this.*` / no plugin / no Obsidian Setting API.
// Caller is responsible for building the connection object (status,
// checkedAt, message) from `multiPlatformSync.connection`.
//
// Contract is locked by tests/connection_status_bar.test.js.

function formatWechatsyncCheckedAt(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Resolve `{ dotLabel, dotClass, text }` for a given bridge connection
// state. Centralized so both surfaces render identical wording for
// identical states. The two variants only differ in user-facing wording —
// they should never diverge on the dot color or class.
function describeWechatsyncConnectionState(connection = {}, context = {}) {
  const { variant = 'modal' } = context;
  const checkedAtText = formatWechatsyncCheckedAt(connection.checkedAt);
  if (connection.status === 'connected') {
    if (variant === 'settings') {
      return {
        dotLabel: '已连接',
        dotClass: 'is-ok',
        text: connection.message
          || (checkedAtText
            ? `已连接浏览器插件。上次检查 ${checkedAtText}。`
            : '已连接浏览器插件。'),
      };
    }
    return {
      dotLabel: '已连接',
      dotClass: 'is-ok',
      text: checkedAtText
        ? `已连接。使用设置中 ${checkedAtText} 的所选平台配置，微信不会出现在这里。`
        : '已连接。勾选本次要发送的平台，微信不会出现在这里。',
    };
  }
  if (connection.status === 'failed') {
    return {
      dotLabel: '未连接',
      dotClass: 'is-error',
      text: variant === 'settings'
        ? `上次连接失败${connection.message ? `：${connection.message}` : ''}。请检查端口、令牌后点击「测试连接」。`
        : `上次连接失败${connection.message ? `：${connection.message}` : ''}。请先连接浏览器插件后再发布。`,
    };
  }
  return {
    dotLabel: '未测试',
    dotClass: '',
    text: variant === 'settings'
      ? '尚未测试与浏览器插件的连接。点击下方「测试连接」开始诊断。'
      : '尚未连接浏览器插件。平台列表先显示本地备用清单，连接后会读取插件实际支持的平台。',
  };
}

// Pure renderer for the bridge connection status bar. Returns the bar
// element and (optional) action button so the caller can flip disabled
// state during async work.
function renderWechatsyncConnectionStatusBar(parentEl, options = {}) {
  const {
    dotLabel = '',
    dotClass = '',
    text = '',
    action = null,
  } = options;
  const bar = parentEl.createDiv({ cls: 'wechat-multiplatform-status' });
  if (dotLabel) {
    bar.createEl('span', {
      text: dotLabel,
      cls: `wechat-multiplatform-status-dot ${dotClass}`.trim(),
    });
  }
  if (text) {
    bar.createEl('span', { text, cls: 'wechat-multiplatform-status-text' });
  }
  let actionButton = null;
  if (action && typeof action === 'object') {
    actionButton = bar.createEl('button', {
      text: action.label || '重试',
      cls: 'wechat-multiplatform-status-action',
    });
    if (action.disabled) actionButton.disabled = true;
    if (typeof action.onClick === 'function') {
      actionButton.addEventListener('click', (event) => {
        action.onClick(event, actionButton);
      });
    }
  }
  return { bar, actionButton };
}

module.exports = {
  formatWechatsyncCheckedAt,
  describeWechatsyncConnectionState,
  renderWechatsyncConnectionStatusBar,
};

const form = document.getElementById('connection-form');
const button = document.getElementById('connect-button');
const status = document.getElementById('status');
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = '正在验证云端服务…';
  status.dataset.ok = 'true';
  try {
    const result = await window.dataagentConnection.connect(document.getElementById('server-url').value);
    if (!result.ok) throw new Error(result.error);
    status.textContent = '验证成功，正在打开工作台…';
  } catch (error) {
    status.dataset.ok = 'false';
    status.textContent = error.message || '连接失败，请检查地址并重试。';
  } finally { button.disabled = false; }
});

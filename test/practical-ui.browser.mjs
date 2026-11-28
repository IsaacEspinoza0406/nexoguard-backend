// Headless Chrome against practical-ui.fixture.mjs ONLY. No personal browser profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const chrome = process.env.NEXOGUARD_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const output = resolve(process.argv[2] || '');
if (!process.argv[2] || existsSync(output)) throw new Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
mkdirSync(output, { recursive: true });
const profile = join(output, 'profile');
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let i = 0; i < 100 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await sleep(100);
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = event => { const msg = JSON.parse(event.data); if (msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') events.push(msg); if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error('UI_EVALUATION_FAILED');
    return result.result.value;
  }
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); } writeFileSync(join(output, 'failure.json'), JSON.stringify({text:await evaluate('document.body.innerText'),events},null,2)); throw new Error('UI_WAIT_TIMEOUT'); }
  await call('Page.bringToFront');
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable'); await call('Log.enable');
  await call('Browser.grantPermissions', { origin: 'http://127.0.0.1:38800', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  // Fixed public dummy, accepted only by the UI simulator. Never a real session.
  await call('Network.setCookie', { name: 'nexoguard_session', value: 'a'.repeat(64), url: 'http://127.0.0.1:38800', path: '/' });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:38800/cuenta' });
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Ver historial'))");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ver historial')).click()");
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='Ver resultados')");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Ver resultados').click()");
  await until("document.querySelectorAll('.practical-guide').length===12");
  const selectTechnology = "s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}));";
  await evaluate(`document.querySelectorAll('.results-section details').forEach(d=>d.open=true);document.querySelectorAll('.practical-guide select').forEach(s=>{${selectTechnology}})`);
  await until("document.querySelectorAll('.guide-content').length===12");
  assert.equal(await evaluate("document.querySelectorAll('.practical-guide').length"), 12);
  assert.ok(await evaluate("document.body.textContent.includes('SIMULACIÓN VISUAL')"));
  const hsts = "[...document.querySelectorAll('.results-section li')].find(li=>li.querySelector('h5')?.textContent==='HSTS')";
  await evaluate(`${hsts}.querySelector('button').click()`);
  await until(`${hsts}.textContent.includes('Ejemplo corregido copiado.')`);
  assert.equal((await evaluate('navigator.clipboard.readText()')).replace(/\r\n/g, '\n'), '/*\n  Strict-Transport-Security: max-age=300');
  assert.ok(await evaluate('localStorage.length===0'));
  await evaluate(`document.querySelectorAll('.results-section details').forEach(d=>d.open=d===${hsts}.querySelector('details'));${hsts}.querySelector('.practical-guide').scrollIntoView({block:'start',behavior:'instant'})`);
  await sleep(300);
  writeFileSync(join(output, 'examples-desktop.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await evaluate(`${hsts}.querySelector('.practical-guide').scrollIntoView({block:'start',behavior:'instant'})`);
  await sleep(300);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await evaluate(`${hsts}.querySelector('button').focus()`);
  assert.ok(await evaluate(`${hsts}.querySelector('button')===document.activeElement`));
  await evaluate(`${hsts}.querySelector('.practical-guide').scrollIntoView({block:'start',behavior:'instant'})`);
  writeFileSync(join(output, 'examples-mobile.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const report = { scope: 'Real Chrome rendering, simulated API/data, not public analysis or TLS proof', checksWithGuides: 12, desktop: '1440x1100', mobile: '390x1000', clipboardCorrectedOnlyWindowsNewlinesNormalized: true, localStorageEmpty: true, mobileNoHorizontalOverflow: true, copyKeyboardFocusable: true };
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { socket?.close(); child.kill(); }

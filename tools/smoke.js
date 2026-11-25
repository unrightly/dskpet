'use strict';

/**
 * 一键自检：用临时数据目录启动应用，跑完三窗口渲染 / 流式对话 / 记忆 / 附件检查后自动退出。
 * 截图写到 .smoke/，不会碰你的真实配置。
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const electron = require('electron'); // Node 下返回 electron 可执行文件路径
const dataDir = path.join(root, '.smoke-data');

try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

const child = spawn(electron, ['.', '--smoke'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    DSKPET_DATA_DIR: dataDir,
    DSKPET_DEBUG: process.env.DSKPET_DEBUG || ''
  }
});

child.on('exit', (code) => {
  process.exit(code == null ? 0 : code);
});

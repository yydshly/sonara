import {readFile} from 'node:fs/promises';

// Small, dependency-free ZIP (stored entries, UTF-8 names), built only on the local admin route.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function storedZip(files){const chunks=[],central=[];let offset=0;
  for(const [name,value] of Object.entries(files)){
    const data=Buffer.isBuffer(value)?value:Buffer.from(value),filename=Buffer.from(name),crc=crc32(data),header=Buffer.alloc(30),entry=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    chunks.push(header,filename,data);central.push(entry,filename);offset+=header.length+filename.length+data.length;
  }
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,index,end]);
}
async function workerFiles(){
  const files={};for(const name of ['scripts/remote-worker.mjs','server/minimax-code.mjs','server/process-runner.mjs','server/studio-media.mjs','dist/studio-core.mjs'])files[name]=await readFile(new URL('../'+name,import.meta.url));
  files['start-worker.cmd']='@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\ntitle Sonara Windows Connector\r\necho Sonara connector starting...\r\necho Logs: worker.log ^(double-click view-logs.cmd^)\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js was not found. Please install Node.js 24 LTS and reopen this window.\r\n  echo [%date% %time%] Node.js was not found.>>worker.log\r\n  pause\r\n  exit /b 1\r\n)\r\nnode scripts\\remote-worker.mjs connection.json\r\nif errorlevel 1 echo Startup or execution failed. See the messages above and worker.log.\r\necho.\r\npause\r\n';
  files['view-logs.cmd']='@echo off\r\ncd /d "%~dp0"\r\nif exist worker.log (\r\n  start "" notepad.exe "%~dp0worker.log"\r\n) else (\r\n  echo No worker.log yet. Start start-worker.cmd first.\r\n  pause\r\n)\r\n';
  return files;
}
export async function workerUpdatePackage(){
  const files=await workerFiles();files['更新说明.txt']='声间连接器更新 v0.3.3\r\n\r\n1. 在另一台 Windows 电脑关闭旧的连接程序窗口。\r\n2. 将此 ZIP 解压到之前的连接包目录，覆盖同名文件。\r\n3. 保留原有 connection.json 和 .local 文件夹；本更新包没有这两项，不会替换配对或任务记录。\r\n4. 双击 start-worker.cmd。窗口应立即显示版本、Node.js 检测与连接阶段，每 30 秒报告等待状态。\r\n5. 无论窗口是否还开着，都可双击 view-logs.cmd 查看 worker.log。\r\n\r\n后续任务的详细诊断在 .local/remote-worker/tasks/任务编号/minimax-execution.json，另有 minimax-output.log 和 minimax-error.log。日志经过常见凭证脱敏，但可能包含创作内容，只保存在这台电脑，不要公开全部文件。旧版本未保存的完整错误不能补回。更新不会重新提交旧任务。\r\n';return storedZip(files);
}
export async function workerPackage(config){
  const files=await workerFiles();
  files['connection.json']=JSON.stringify(config,null,2);
  files['使用说明.txt']='声间 Windows 局域网连接包\r\n\r\n1. 将整个 ZIP 复制到已登录 MiniMax Code 的电脑，先解压到自己的文件夹。\r\n2. 安装 Node.js 24 LTS；在终端确认 mcode --version 能执行，并先在 MiniMax Code 完成登录。\r\n3. 双击 start-worker.cmd，保持窗口开启。第一次只检查入口与配对，不会发起音乐生成。\r\n4. 回到声间，在歌词或音乐页面选择“另一台电脑”，明确提交后才生成。\r\n\r\n两台电脑需要保持在线。只在受信任的私人局域网使用；当前传输为 HTTP。connection.json 是本次配对凭证，请勿公开或提交仓库。关闭平台连接或重启平台后旧包失效，应重新下载。\r\n如连接不上：确认本机工作台仍在运行、选择的是 WLAN/以太网地址；如 Windows 防火墙拦截，可允许本机 Node 的私人网络访问，不要开放公共网络或路由器端口。\r\n\r\n任务、日志和音频保存在解压目录 .local/remote-worker/tasks。程序只重传已生成结果，不会因断线重新生成。生成中退出后需要核查结果；可将已有 song.mp3 或 song.wav 手动导回声间。\r\n自定义 MiniMax 安装可设置 SONARA_MCODE_ENTRY（cli.js 完整路径），或 SONARA_MCODE_BIN（可执行文件）。不需要将 MiniMax 密码或密钥填写在声间。\r\n';
  files['使用说明.txt']+='\r\n运行日志：双击 view-logs.cmd 打开同目录 worker.log。启动、连接、每 30 秒等待状态及错误都会记录。每个新任务的详细诊断在 minimax-execution.json、minimax-output.log 和 minimax-error.log；不读取或上传账户配置。\r\n';
  return storedZip(files);
}

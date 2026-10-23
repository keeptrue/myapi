# 运维手册

## 1. 部署

### Docker Compose（推荐）

```bash
mkdir -p data
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
docker compose logs -f
```

默认只映射 `127.0.0.1:8787`。要暴露到局域网，修改 compose 的 ports，并设置强面板密码：

```yaml
environment:
  - MYAPI_ADMIN_PASSWORD=换成强密码
ports:
  - "8787:8787"
```

### 裸跑

```bash
bun install
bun run build
HOST=127.0.0.1 PORT=8787 ./start.sh
```

`start.sh` 会把参数原样传给 Node：

```bash
./start.sh --port 8799 --data-dir /srv/myapi
./start.sh --lan
```

## 2. 首次登录

1. `http://127.0.0.1:8787/`；
2. 用首启日志中的随机密码登录（或 `MYAPI_ADMIN_PASSWORD`）；
3. 账号 → 添加账号 → 短信登录；
4. 浏览器完成 GeeTest，收短信码，登录；
5. 密钥 → 创建 Key，立刻保存；
6. 模型 → 刷新目录；设置 → 修改面板密码。

远端服务器推荐 SSH 隧道，面板继续只绑回环：

```bash
ssh -L 8787:127.0.0.1:8787 user@server
# 本地浏览器打开 http://127.0.0.1:8787/
```

## 3. 反向代理（Nginx）

```nginx
server {
  listen 443 ssl;
  server_name astudio.example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_buffering off;          # SSE 必须关闭缓冲
  }

  location /v1/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header x-api-key $http_x_api_key;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
  }
}
```

设置 `MYAPI_TRUST_PROXY=true` 后，面板会按 `X-Forwarded-Proto` 判断 Secure Cookie。

## 4. 备份与恢复

`data/` 里包含：

- `state.json`：账号凭据（密文）、Key HMAC、设置、统计；
- `secret.key`：解密主密钥；
- `logs/`、`benefits.jsonl`、`catalog.json`、`modelsdev.json`、`backups/`。

```bash
# 停服务后备份
docker compose stop
tar czf myapi-data-$(date +%F).tgz data
docker compose start

# 恢复
docker compose down
tar xzf myapi-data-2026-01-01.tgz
docker compose up -d
```

> `secret.key` 丢失 = 账号凭据无法解密。备份必须同时包含它，且不要提交到仓库。

## 5. 升级

```bash
docker compose pull
docker compose up -d
```

或：

```bash
git pull
bun install --frozen-lockfile
bun run check
bun run build
./start.sh
```

升级前先备份 `data/`。状态文件 schemaVersion 目前为 1；升级时启动流程会先备份再加载。

## 6. 健康检查

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/ping
```

`/healthz` 只暴露计数与版本，不暴露账号身份。

## 7. 真实链路冒烟

```bash
MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs
```

覆盖：`/healthz`、`/v1/models`、chat 非流式、chat 流式、responses、messages。任一项失败返回非零。

## 8. 排障

| 现象 | 排查 |
|---|---|
| 面板打不开 | 端口/HOST；`/healthz`；容器日志 |
| 登录一直 401 | 密码是否正确；是否被登录限流；`data/state.json` 是否被替换 |
| 添加账号提示 GeeTest 脚本失败 | 浏览器是否访问得到 `static.geetest.com`；公司网络/代理 |
| 账号显示「会话已失效」 | Cookie 过期；重新短信登录，或粘贴新的 `astron-session.json` |
| 模型目录为空 | 账号是否可用；点「刷新目录」；看目录 error；上游 401/403 |
| 官方价/上下文不显示 | 设置 → 官方元数据是否启用；点「刷新官方元数据」；看 status.error；网络能否访问 models.dev |
| 官方条目匹配错 | 模型详情 → 官方 / 倍率 → 搜索条目手动绑定；绑定只影响对照 |
| 官方元数据一直失败 | 换 `modelsDevUrl` 镜像；删除 `data/modelsdev.json` 后重启重拉；失败会退避 15 分钟 |
| 请求 503 `no_upstream_account` | 没有账号，或全部禁用/冷却 |
| 请求 403 `model_not_allowed` | Key 的模型白名单 |
| 请求 429 `rate_limited` | Key 的 RPM 限制 |
| 上游 400 无名错误 | 查看日志 error 摘要；网关会尝试降形状/诊断；必要时用探测定位 |
| 流式请求中断 | 反代是否 `proxy_buffering off`；上游空闲超时；客户端断开 |
| 签到成功但积分不变 | 可能今日已领；事件里会记 skipped |

## 9. 安全建议

- 公网暴露必须加 TLS、反代鉴权或 IP 白名单；面板密码至少 16 位。
- 定期轮换 API Key；不同客户端用不同 Key，必要时绑定账号/模型。
- 不要把 `data/`、`.env`、日志上传到公开仓库。
- 只使用自己的账号；不要共享账号池给不受信任的人。

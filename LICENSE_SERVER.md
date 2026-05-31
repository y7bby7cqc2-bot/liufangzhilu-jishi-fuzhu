# 授权服务器接口

客户端已经预留“激活码 + 设备绑定 + 30 天有效期”的授权流程。当前推荐使用腾讯云 CloudBase 部署授权服务器，代码在 `cloudbase-license-server/`。

上线收费前，需要配置环境变量 `POE2_LICENSE_SERVER_URL`，或把 `main.js` 里的 `LICENSE_SERVER_URL` 改成你的授权接口地址。

## 客户端请求

软件激活或刷新授权时，会向授权服务器发送：

```http
POST /api/license/verify
content-type: application/json
```

```json
{
  "activationCode": "用户输入的激活码",
  "deviceId": "本机设备指纹哈希",
  "appVersion": "0.1.0",
  "platform": "win32"
}
```

## 服务端成功响应

```json
{
  "ok": true,
  "plan": "monthly",
  "expiresAt": "2026-06-30T23:59:59.000Z",
  "message": "月卡已激活"
}
```

## 服务端失败响应

```json
{
  "ok": false,
  "message": "激活码无效或已绑定其他设备"
}
```

## 推荐数据表字段

- `code`：激活码，唯一
- `status`：`unused` / `active` / `disabled`
- `device_id`：首次激活绑定的设备指纹
- `plan`：`monthly`
- `expires_at`：到期时间
- `created_at`：创建时间
- `activated_at`：首次激活时间
- `last_seen_at`：最近校验时间

## 校验规则

1. 激活码不存在：返回失败。
2. 激活码被禁用：返回失败。
3. 首次激活：写入 `device_id`，设置或返回 30 天到期时间。
4. 后续校验：请求的 `deviceId` 必须等于已绑定的 `device_id`。
5. 到期后：返回失败或返回 `ok: false` 和到期提示。

## 当前客户端行为

- 查询功能不受授权影响。
- 自动点击 `Travel to Hideout` 需要授权。
- 未激活时赠送 1 次免费自动传送。
- 月卡有效时自动传送不限次数。
- 授权成功后会缓存 24 小时离线有效期。
- 客户端本地判断只用于体验，最终授权状态必须以服务端记录为准。

## 腾讯云 CloudBase

部署说明见 `cloudbase-license-server/README.md`。

部署完成后，客户端授权地址格式类似：

```text
https://你的云函数访问地址/api/license/verify
```

## LeanCloud 备选

LeanCloud 中国节点已不再支持注册新账号。如果你已有旧账号，可以参考 `leancloud-license-server/README.md`；新项目优先使用 CloudBase。

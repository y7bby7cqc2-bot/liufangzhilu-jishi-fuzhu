# LeanCloud 授权服务器

这是 POE2 集市提醒器的授权服务器。它负责：

- 校验用户输入的月卡激活码。
- 首次激活时绑定设备指纹。
- 返回月卡到期时间。
- 给管理员批量生成激活码。

## 1. 注册和创建应用

1. 打开 LeanCloud 控制台：https://console.leancloud.app/
2. 注册并登录。
3. 左上角节点切换为「国内版」。
4. 创建应用，例如 `POE2 License`。
5. 进入应用后，找到「设置」里的：
   - `App ID`
   - `App Key`
   - `Master Key`

## 2. 部署云引擎

把本目录作为一个 Node.js 云引擎项目部署。LeanCloud 云引擎会读取 `package.json`，执行：

```bash
npm install
npm start
```

需要配置环境变量：

```text
LEANCLOUD_APP_ID=你的 App ID
LEANCLOUD_APP_KEY=你的 App Key
LEANCLOUD_APP_MASTER_KEY=你的 Master Key
ADMIN_TOKEN=你自己设置的一串管理员密钥
```

`ADMIN_TOKEN` 用于生成激活码，不要发给用户。

## 3. 生成激活码

部署后，用下面请求生成月卡激活码：

```bash
curl -X POST "https://你的云引擎域名/api/admin/licenses" \
  -H "content-type: application/json" \
  -H "authorization: Bearer 你的_ADMIN_TOKEN" \
  -d '{"count": 10}'
```

返回示例：

```json
{
  "ok": true,
  "codes": [
    "POE2-ABCD-2345-WXYZ"
  ]
}
```

## 4. 客户端校验接口

客户端会请求：

```http
POST /api/license/verify
```

请求体：

```json
{
  "activationCode": "POE2-ABCD-2345-WXYZ",
  "deviceId": "设备指纹",
  "appVersion": "0.1.0",
  "platform": "win32"
}
```

成功返回：

```json
{
  "ok": true,
  "plan": "monthly",
  "expiresAt": "2026-07-01T00:00:00.000Z",
  "message": "月卡已激活"
}
```

失败返回：

```json
{
  "ok": false,
  "message": "激活码已绑定其他设备。"
}
```

## 5. 数据表

代码会自动创建 `License` Class。主要字段：

- `code`：激活码
- `status`：`unused` / `active` / `disabled`
- `deviceId`：绑定设备
- `plan`：`monthly`
- `expiresAt`：到期时间
- `activatedAt`：首次激活时间
- `lastSeenAt`：最近校验时间

## 6. 接入客户端

部署成功后，把客户端 [../main.js](../main.js) 里的授权地址改成：

```js
const LICENSE_SERVER_URL = "https://你的云引擎域名/api/license/verify";
```

然后重新打包发布。

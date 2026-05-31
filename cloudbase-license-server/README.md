# 腾讯云 CloudBase 授权服务器

这是 POE2 集市提醒器的中国大陆授权服务器版本。腾讯云 CloudBase 官方文档说明，CloudBase 内置数据库、云函数等后端能力；Node.js 云函数可使用 `@cloudbase/node-sdk` 直接调用数据库资源。

## 1. 创建数据库集合

在 CloudBase 控制台进入你已经创建的环境：

1. 打开「数据库」。
2. 新建集合：`licenses`
3. 权限建议先设为「仅管理员可读写」。

代码会往 `licenses` 集合里写入这些字段：

- `code`：激活码
- `status`：`unused` / `active` / `disabled`
- `deviceId`：绑定设备
- `plan`：`monthly`
- `expiresAt`：到期时间
- `createdAt`：创建时间
- `activatedAt`：首次激活时间
- `lastSeenAt`：最近校验时间

## 2. 创建 HTTP 云函数

1. 进入「云函数」。
2. 新建函数。
3. 类型选择「HTTP 云函数」。
4. 运行环境选择 Node.js 18 或更高。
5. 函数名建议：`poe2-license`
6. 上传本目录 `cloudbase-license-server/` 下的文件：
   - `index.js`
   - `package.json`

入口保持默认：

```text
index.main
```

## 3. 配置环境变量

在云函数配置里添加：

```text
ADMIN_TOKEN=你自己设置的一串管理员密钥
```

这个密钥只给你自己生成激活码用，不能发给用户。

当前本地部署配置里的 `ADMIN_TOKEN` 已写在 `cloudbaserc.json`，该文件已加入 `.gitignore`，不会提交到 GitHub。

## 4. 配置 HTTP 访问路径

当前已部署的 HTTP 访问服务地址：

```text
https://poe2-license-d0gfpfta2f4454ec5.service.tcloudbase.com/api
```

客户端校验地址是：

```text
https://poe2-license-d0gfpfta2f4454ec5.service.tcloudbase.com/api/license/verify
```

## 5. 生成激活码

部署后，用下面命令生成激活码：

```bash
curl -X POST "https://poe2-license-d0gfpfta2f4454ec5.service.tcloudbase.com/api/admin/licenses" \
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

## 6. 客户端校验

软件会请求：

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

成功响应：

```json
{
  "ok": true,
  "plan": "monthly",
  "expiresAt": "2026-07-01T00:00:00.000Z",
  "message": "月卡已激活"
}
```

失败响应：

```json
{
  "ok": false,
  "message": "激活码已绑定其他设备。"
}
```

## 7. 接入客户端

客户端 [../main.js](../main.js) 已接入当前 CloudBase 地址：

```js
const LICENSE_SERVER_URL = process.env.POE2_LICENSE_SERVER_URL
  || "https://poe2-license-d0gfpfta2f4454ec5.service.tcloudbase.com/api/license/verify";
```

重新打包发布后，用户软件会请求这个接口校验激活码。

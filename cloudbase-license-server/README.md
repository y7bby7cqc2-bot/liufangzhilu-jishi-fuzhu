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

## 4. 配置 HTTP 访问路径

给 HTTP 云函数开启公网访问后，你会得到一个访问地址。最终客户端需要的校验地址是：

```text
https://你的云函数访问地址/api/license/verify
```

如果 CloudBase 控制台要求你配置路径，建议配置：

```text
/api/license/verify
/api/admin/licenses
```

## 5. 生成激活码

部署后，用下面命令生成激活码：

```bash
curl -X POST "https://你的云函数访问地址/api/admin/licenses" \
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

部署成功并测试通过后，把客户端 [../main.js](../main.js) 里的授权地址改成你的接口：

```js
const LICENSE_SERVER_URL = "https://你的云函数访问地址/api/license/verify";
```

然后重新打包发布。

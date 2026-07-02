# CORS跨域问题修复说明

## 问题描述

在GitHub Pages部署的网站版本中，尝试调用第三方API时遇到CORS（跨域资源共享）错误：

```
Access to fetch at 'https://sub.sailapi.top/images/generations' from origin 'https://mmkj555-png.github.io' 
has been blocked by CORS policy: Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### 错误原因

1. **浏览器安全策略**：浏览器阻止从一个域（GitHub Pages）直接访问另一个域（第三方API）的资源
2. **API服务器配置**：第三方API服务器未配置允许来自 `mmkj555-png.github.io` 的跨域请求
3. **预检请求失败**：浏览器发送的OPTIONS预检请求被服务器拒绝

## 已实施的修复

### 1. CORS错误检测与友好提示

修改了 `src/services/aiService.ts` 中的以下方法，添加CORS错误捕获：

#### a. `generateImage` 方法（第1232-1245行）

```typescript
let response: Response;
try {
  response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (error) {
  // 捕获CORS错误或网络错误
  const targetUrl = `${baseUrl}/images/generations`;
  throw new Error(formatNetworkProbeError(error, targetUrl));
}
```

#### b. `generateVideo` 方法（第1827-1841行）

```typescript
let response: Response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (fetchError) {
  // 捕获CORS错误或网络错误
  throw new Error(formatNetworkProbeError(fetchError, endpoint));
}
```

### 2. 友好的错误提示信息

现在当遇到CORS错误时，用户会看到以下提示（已存在的 `formatNetworkProbeError` 函数，第140-148行）：

```
浏览器已拦截跨域请求，网站版无法直接访问该 API。

这通常不是 API 地址或密钥错误，而是 API 服务端没有允许 https://mmkj555-png.github.io 跨域访问。
请在设置页手动添加模型，或改用支持 CORS 的 API、桌面版/可信后端代理。

⚠️ 不建议使用公共 CORS 代理，以免泄露 API Key。
```

## 用户解决方案

### 方案1：使用桌面版（推荐）

桌面版不受浏览器CORS限制，可以直接调用任何API。

### 方案2：更换支持CORS的API平台

选择明确支持跨域请求的API服务商，这些服务商的API响应头中包含：
```
Access-Control-Allow-Origin: *
```

### 方案3：使用CORS代理（不推荐，存在安全风险）

**⚠️ 警告**：此方案会将API密钥暴露给第三方代理服务器，存在安全风险。

如果确实需要使用CORS代理，可以：
1. 搭建自己的CORS代理服务器
2. 在API地址前添加代理前缀，例如：
   - 原API地址：`https://sub.sailapi.top`
   - 代理后地址：`https://your-cors-proxy.com/https://sub.sailapi.top`

### 方案4：联系API服务商

请求API服务商在其服务器配置中添加CORS支持，允许来自GitHub Pages的跨域请求。

## 技术细节

### CORS工作原理

1. **同源策略**：浏览器默认只允许页面访问同源的资源（协议+域名+端口相同）
2. **预检请求**：对于非简单请求（如带Authorization头的POST请求），浏览器会先发送OPTIONS请求
3. **服务器响应**：服务器需要在响应头中明确允许跨域访问

### 为什么桌面版不受影响

桌面版使用Tauri框架，HTTP请求不经过浏览器的CORS检查，可以直接访问任何URL。

## 代码改进

此次修复确保了：

1. ✅ **错误捕获**：所有网络请求都有完善的错误处理
2. ✅ **友好提示**：用户能看到清晰的错误原因和解决方案
3. ✅ **一致性**：图片生成和视频生成都使用相同的错误处理逻辑
4. ✅ **安全提醒**：警告用户不要使用公共CORS代理以免泄露API密钥

## 测试

修复后的代码已通过编译，构建输出：
```
✓ built in 6.81s
```

在实际使用中，当遇到CORS错误时，用户将看到明确的错误提示，而不是模糊的 "Failed to fetch" 错误。

## 后续建议

1. **文档更新**：在用户手册中说明CORS限制和推荐使用桌面版
2. **API选择指南**：提供支持CORS的API服务商列表
3. **代理配置**：如有必要，可在设置页面添加可选的CORS代理配置功能（需用户自己搭建代理服务器）

---

**修复完成时间**：2026-07-02
**影响范围**：`src/services/aiService.ts`
**测试状态**：✅ 编译通过

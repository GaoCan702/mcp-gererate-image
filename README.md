# 为Cursor打造你自己的AI图片生成服务：MCP协议实战指南

![Cursor与AI图像生成功能的交互界面](tutorial_images/cursor_ai_image_generation.jpg)

> *想象一下，在你敲代码的同时，只需一句话就能让AI为你生成任何想象中的图像。是不是还挺方便*


## 什么是MCP？为什么它很重要？

模型上下文协议（MCP）是一个开放的协议，它标准化了应用程序如何向LLMs提供上下文和工具。将MCP视为Cursor的插件系统 - 它允许您通过标准化接口将Agent连接到各种数据源和工具，从而扩展其功能。

## 我们要构建什么

在这个教程中，我们将创建一个MCP服务器，它可以：

1. 接收来自Cursor的图像生成请求
2. 调用Cloudflare的Flux AI模型
3. 保存生成的图像到本地或临时目录
4. 将结果反馈给Cursor


## 准备工作

在开始之前，你需要准备：

- 一个Cloudflare账号（免费即可）
- Cloudflare AI API密钥和账户ID (用于Rest api的方式调用)
- Node.js环境（v16+）
- 基本的TypeScript知识
- 已安装的Cursor IDE

cloudflare控制台 -> AI -> workers ai -> 使用 REST API, 这个页面来获取账户id和 api令牌


## 第一步：项目设置

让我们从创建项目和安装依赖开始：

```bash
mkdir mcp-image-generator
cd mcp-image-generator
npm init -y
npm install @modelcontextprotocol/sdk zod dotenv
npm install --save-dev typescript @types/node
```

接下来，创建一个基本的TypeScript配置文件。在项目根目录创建`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "outDir": "./dist",
    "strict": true
  },
  "include": ["src/**/*"]
}
```

然后，创建一个`.env`文件来存储你的Cloudflare凭证：

```
CLOUDFLARE_ACCOUNT_ID=你的账户ID
CLOUDFLARE_API_TOKEN=你的API令牌
```

别忘了将这个文件添加到`.gitignore`，保护你的API密钥不被意外公开。

## 第二步：构建MCP服务器

现在，让我们创建服务器的核心文件。新建`src/index.ts`：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 创建MCP服务器
const server = new McpServer({
    name: "AI图片生成助手",
    version: "1.0.0"
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
```

这段代码创建了一个基本的MCP服务器，它使用标准输入/输出与Cursor通信。但目前它还没有任何功能。

## 第三步：添加图片生成工具

现在，让我们在服务器实例上添加图片生成工具。在`connect`调用之前添加以下代码：

```typescript
// 添加一个文生图工具
server.tool(
    "generate-image-from-text",
    "使用Cloudflare的Flux模型生成图像",
    {
        prompt: z.string()
            .min(1, "提示文本不能为空")
            .max(2048, "提示文本不能超过2048个字符")
            .describe("用于生成图像的文本描述"),
        steps: z.number()
            .int("步数必须是整数")
            .max(8, "步数最大为8")
            .default(4)
            .describe("扩散步数，值越高质量越好但耗时更长"),
        outputPath: z.string()
            .min(1, "输出路径不能为空")
            .describe("生成图片的保存目录路径"),
        filename: z.string()
            .min(1, "文件名不能为空")
            .describe("保存的图片文件名，不需要包含扩展名")
    },
    async ({ prompt, steps = 4, outputPath, filename }) => {
        // 实现代码将在下一步添加
    }
);
```

这段代码定义了我们的工具接口，使用`zod`库进行参数验证，确保所有输入都有合理的约束。

## 第四步：实现API调用逻辑


现在，让我们实现工具的核心逻辑——调用Cloudflare API并处理响应：

```typescript
async ({ prompt, steps = 4, outputPath, filename }) => {
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    try {
        // 调用Cloudflare API
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt
            })
        });

        // 解析响应
        const responseData = await response.json() as { image?: string;[key: string]: unknown };

        if (!response.ok) {
            return {
                content: [{ type: "text", text: `调用API失败: ${response.status} ${response.statusText}` }]
            };
        }

        // 提取图像数据
        let imageBase64 = null;

        if (responseData.image) {
            imageBase64 = responseData.image as string;
        } else if (responseData.result && typeof responseData.result === 'object') {
            const resultObj = responseData.result as Record<string, unknown>;
            if (resultObj.image) {
                imageBase64 = resultObj.image as string;
            } else if (resultObj.data) {
                imageBase64 = resultObj.data as string;
            }
        }

        if (!imageBase64) {
            return {
                content: [{ type: "text", text: "API返回的数据中没有图像" }]
            };
        }

        // 图像处理逻辑将在下一步添加
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `发生错误: ${errorMessage}` }]
        };
    }
}
```

这段代码处理了API调用和响应解析。我特别关注了错误处理和不同响应格式的兼容，因为在我的经验中，API响应格式有时会变化，尤其是在使用预览版API时。

## 第五步：图像保存逻辑

最后，让我们添加图像保存逻辑，完成我们的工具实现：

```typescript
// 接上一步代码，在提取出imageBase64之后

// 保存图像文件
let targetFilePath = path.join(outputPath, `${filename}.jpg`);
let actualSavePath = targetFilePath;
let message = '';

try {
    // 确保输出目录存在
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    // 测试目录是否可写
    const testFileName = path.join(outputPath, '.write-test');
    fs.writeFileSync(testFileName, '');
    fs.unlinkSync(testFileName);

    // 将Base64图像保存为文件
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(targetFilePath, imageBuffer);
    message = `图像已成功生成并保存到: ${targetFilePath}`;
} catch (fileError) {
    // 备用方案：保存到临时目录
    const tempDir = path.join(os.tmpdir(), 'mcp_generated_images');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    actualSavePath = path.join(tempDir, `${filename}.jpg`);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(actualSavePath, imageBuffer);

    message = `由于权限问题无法保存到 ${targetFilePath}，已保存到临时位置: ${actualSavePath}`;
}

return {
    content: [{ type: "text", text: message }]
};
```

这段代码处理了文件保存，并包含了一个优雅的回退机制——如果用户指定的目录不可写，我们会将图像保存到临时目录，确保用户总能获得生成的图像。

## 第六步：编译和运行

在`package.json`中添加以下脚本：

```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js"
}
```

然后编译并运行你的服务器：

```bash
npm run build
```


## 在Cursor中配置你的MCP服务

```json
{
    "mcpServers": {
        "随便起个名字": {
            "command": "node",
            "args": [
                "/path/to/your/dist/index.js"
            ]
        }
    }
}
```

现在我们需要告诉Cursor如何找到并使用我们的服务器：

1. 打开Cursor IDE
2. 进入设置
3. 添加新的MCP服务，指向你的服务器启动命令
4. 重启Cursor使配置生效

具体的配置界面可能随Cursor版本更新有所变化，提供
- 服务名称（如"图片生成器"）
- 命令路径（指向你的Node.js可执行文件）
- 启动参数（指向你的编译后的脚本如`/path/to/your/dist/index.js`）

## 使用你的图片生成服务

设置完成后，你可以在Cursor中通过与AI助手的对话使用这项功能：

```
请生成一张猫咪在月球上弹钢琴的图片，保存到/Users/me/Pictures目录，文件名为space_cat_piano
```

![生成的太空猫弹钢琴示例](tutorial_images/space_cat_piano_example.jpg)

 cursor agent 会识别这个请求，调用你的MCP服务器，生成图像，然后告诉你图像已保存的位置。


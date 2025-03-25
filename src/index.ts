import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// Create an MCP server
const server = new McpServer({
    name: "Demo",
    version: "1.0.0"
});

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
            .describe("生成图片的保存目录路径(绝对路径)"),
        filename: z.string()
            .min(1, "文件名不能为空")
            .describe("保存的图片文件名，不需要包含扩展名")
    },
    async ({ prompt, steps = 4, outputPath, filename }) => {
        const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
        const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

        const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

        try {
            console.log("发送请求到API:", url);
            console.log("请求体:", JSON.stringify({ prompt: prompt }));

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

            // 解析响应JSON
            const responseData = await response.json() as { image?: string;[key: string]: unknown };

            console.log("API响应状态:", response.status, response.statusText);
            console.log("API响应头:", JSON.stringify(Object.fromEntries([...response.headers])));

            // 检查responseData的结构
            console.log("API响应数据结构:", Object.keys(responseData));
            console.log("响应是否包含image字段:", responseData.hasOwnProperty('image'));

            if (responseData.hasOwnProperty('image')) {
                const imageData = responseData.image;
                console.log("图像数据类型:", typeof imageData);
                console.log("图像数据长度:", typeof imageData === 'string' ? imageData.length : 'Not a string');
                console.log("图像数据预览:", typeof imageData === 'string' ? imageData.substring(0, 50) + '...' : 'N/A');
            } else if (responseData.hasOwnProperty('result')) {
                // 检查是否有result字段，可能包含图像
                console.log("包含result字段，其类型为:", typeof responseData.result);
                if (typeof responseData.result === 'object' && responseData.result !== null) {
                    console.log("result字段的键:", Object.keys(responseData.result));
                }
            }

            // 检查错误信息
            if (responseData.hasOwnProperty('errors')) {
                console.log("API返回错误:", JSON.stringify(responseData.errors));
            }

            if (!response.ok) {
                return {
                    content: [{ type: "text", text: `调用 API 失败: ${response.status} ${response.statusText} - ${JSON.stringify(responseData)}` }]
                };
            }

            let imageBase64 = null;

            if (responseData.image) {
                imageBase64 = responseData.image as string;
            } else if (responseData.result && typeof responseData.result === 'object') {
                // 在result对象中查找可能的图像字段
                const resultObj = responseData.result as Record<string, unknown>;
                if (resultObj.image) {
                    imageBase64 = resultObj.image as string;
                } else if (resultObj.data) {
                    imageBase64 = resultObj.data as string;
                }
            }

            if (!imageBase64) {
                console.log("未找到图像数据字段，尝试过: image, result.image, result.data");
                return {
                    content: [{ type: "text", text: "API 返回的数据中没有图像" }]
                };
            }

            // 保存图像文件的逻辑
            let targetFilePath = path.join(outputPath, `${filename}.jpg`);
            let actualSavePath = targetFilePath;
            let message = '';

            try {
                // 尝试确保输出目录存在
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
                console.log(`尝试保存到 ${targetFilePath} 失败: ${fileError}`);

                // 备用方案：保存到临时目录
                const tempDir = path.join(os.tmpdir(), 'mcp_generated_images');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                actualSavePath = path.join(tempDir, `${filename}.jpg`);
                const imageBuffer = Buffer.from(imageBase64, 'base64');
                fs.writeFileSync(actualSavePath, imageBuffer);

                message = `由于权限原因无法保存到 ${targetFilePath}，已保存到临时位置: ${actualSavePath}。
建议使用以下命令复制到指定位置:
cp "${actualSavePath}" "${targetFilePath}"`;
            }

            return {
                content: [{
                    type: "text",
                    text: message
                }]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `发生错误: ${errorMessage}` }]
            };
        }
    }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
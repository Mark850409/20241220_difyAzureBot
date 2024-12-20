#  dify聊天機器人部署到AZURE+串接telegram

## 1. 簡介

建立dify聊天機器人，並建立AzureBot與多平台串接

## 2. 目錄

- [dify聊天機器人部署到AZURE+串接telegram](#dify聊天機器人部署到azure串接telegram)
  - [1. 簡介](#1-簡介)
  - [2. 目錄](#2-目錄)
  - [3. 相關教學](#3-相關教學)
  - [4. 操作步驟](#4-操作步驟)
    - [4.1. dify環境部署與專案建立](#41-dify環境部署與專案建立)
    - [4.2. 撰寫部署到AzureBot所需程式](#42-撰寫部署到azurebot所需程式)
    - [4.3. 配置環境變數檔](#43-配置環境變數檔)
    - [4.4. 主程式說明](#44-主程式說明)
    - [4.5. 本地環境部署](#45-本地環境部署)
    - [4.6. ngrok內網穿透(短暫測試)](#46-ngrok內網穿透短暫測試)
    - [4.7. 部署到AzureFunction](#47-部署到azurefunction)
    - [4.8. 建立Azure Bot Service](#48-建立azure-bot-service)
    - [4.9. 配置Azure Bot Service](#49-配置azure-bot-service)
    - [4.10. Telegram測試畫面](#410-telegram測試畫面)


## 3. 相關教學

本地機器人測試程式+部署範本
https://github.com/microsoft/BotFramework-Emulator

使用 Bot Framework 與 Azure Bot 建立 Teams Bot (2024)
https://studyhost.blogspot.com/2024/12/bot-framework-azure-bot-teams-bot-2024.html

使用 Dify 和 Azure Bot Framework 建立Teams Bot
https://docs.dify.ai/zh-hans/learn-more/use-cases/dify-on-teams


## 4. 操作步驟

### 4.1. dify環境部署與專案建立

請先參考這篇安裝教學
https://github.com/Mark850409/20241013_LineBotWithDify


### 4.2. 撰寫部署到AzureBot所需程式

請先將我的專案整包下載下來

```
git clone https://github.com/Mark850409/20241220_difyAzureBot.git
```

### 4.3. 配置環境變數檔

請將`.env.example`複製一份並重新命名為`.env`，在裡面修改以下參數

```
MicrosoftAppType=MultiTenant
MicrosoftAppId=<在 Azure Bot組態找的到>
MicrosoftAppPassword=<在 Azure Bot設定密碼>
MicrosoftAppTenantId=<Bot類型是多租用戶不用設定，單租用戶要設定>

API_ENDPOINT=<在 Dify 上面查看 >
API_KEY=<在 Dify 上面設定 >
```


 > [!note] 
 >單一租使用者和多租使用者的MicrosoftAppType不一樣喔!!!
 

![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122016.png)

![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122003.png)

### 4.4. 主程式說明

範本下載下來預設會有此檔案`index.js`，無須修改

```javascript
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');

const dotenv = require('dotenv');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });

const restify = require('restify');

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication
} = require('botbuilder');

// This bot's main dialog.
const { EchoBot } = require('./bot');

// Create HTTP server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${ server.name } listening to ${ server.url }`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(process.env);

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about how bots work.
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights. See https://aka.ms/bottelemetry for telemetry
    //       configuration instructions.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Set the onTurnError for the singleton CloudAdapter.
adapter.onTurnError = onTurnErrorHandler;

// Create the main dialog.
const myBot = new EchoBot();

// Listen for incoming requests.
server.post('/api/messages', async (req, res) => {
    // Route received a request to adapter for processing
    await adapter.process(req, res, (context) => myBot.run(context));
});

// Listen for Upgrade requests for Streaming.
server.on('upgrade', async (req, socket, head) => {
    // Create an adapter scoped to this WebSocket connection to allow storing session data.
    const streamingAdapter = new CloudAdapter(botFrameworkAuthentication);
    // Set onTurnError for the CloudAdapter created for each connection.
    streamingAdapter.onTurnError = onTurnErrorHandler;

    await streamingAdapter.process(req, socket, head, (context) => myBot.run(context));
});
```

`bot.js`這隻程式主要包含fetch請求，與`dify api`溝通的部分

```javascript
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
const path = require('path');
const { markdown } = require('telegram-format');
const { marked } = require('marked');
const { ActivityHandler, MessageFactory } = require('botbuilder');
let fetch;
if (parseInt(process.versions.node.split('.')[0]) >= 30) {
  fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
} else {
  fetch = require('node-fetch');
}

const dotenv = require('dotenv');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });
var conversation_ids = {};

function sanitizeMarkdown(input) {
     // 定義正則表達式，保留中英文字符、標點符號、換行符以及Markdown超連結
    const regex = /\[[^\]]+\]\([^\)]+\)|[^\u4e00-\u9fa5a-zA-Z0-9\s\u3000\,\.\!\?\;\:\-\(\)\[\]\{\}\'\"\`\~\u2026\u2014\u2018\u2019\u201c\u201d\u3002\uFF0C\uFF1F\uFF01\n]/g;

    // 過濾不需要的字符
    const sanitized = input.replace(regex, (match) => {
        if (/^\[[^\]]+\]\([^\)]+\)$/.test(match)) {
            return match; // 保留超連結
        }
        return ''; // 移除其他字符
    });
    return sanitized
}

class EchoBot extends ActivityHandler {
    constructor() {
        super();

        this.onMessage(async (context, next) => {
            try {
                const myHeaders = new Headers();
                myHeaders.append("Content-Type", "application/json");
                myHeaders.append("Authorization", "Bearer " + process.env.API_KEY);

                const raw = JSON.stringify({
                    "inputs": {},
                    "query": context.activity.text,
                    "response_mode": "blocking",
                    "conversation_id": conversation_ids[context.activity.recipient.id] ? conversation_ids[context.activity.recipient.id] : '',
                    "user": context.activity.recipient.id
                });

                const requestOptions = {
                    method: "POST",
                    headers: myHeaders,
                    body: raw,
                    redirect: "follow"
                };

                const response = await fetch(process.env.API_ENDPOINT, requestOptions);
                const result = await response.json();

                 // Extract the "answer" field from the result and sanitize it
                let replyText = result.answer || 'Sorry, I could not process your request.';
                replyText = sanitizeMarkdown(replyText);

                // Use markdown format in the response
                await context.sendActivity(MessageFactory.text(replyText, replyText, "markdown"));
            } catch (error) {
                console.error('Error communicating with Dify API:', error);
                await context.sendActivity(MessageFactory.text('There was an error processing your request. Please try again later.'));
            }

            await next();
        });

        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            const welcomeText = 'Hello and welcome! I am connected to Dify, how can I assist you today?';
            for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
                }
            }
            await next();
        });
    }
}

module.exports.EchoBot = EchoBot;
```

### 4.5. 本地環境部署
```docker 
docker compose up
```

![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122240.png)


 > [!note] 
 > 1. 這邊請自行將環境部署到Azure或是cloudflare上面
 > 2. 這邊為了測試方便，使用內網穿透工具取得一個臨時的公開伺服器網址
 > 

### 4.6. ngrok內網穿透(短暫測試)

將紅框處網址複製起來，等等建立AzureBot會使用
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122727.png)

### 4.7. 部署到AzureFunction

可參考這篇的教學
https://github.com/Mark850409/20231217_AzureFunctionAPI

### 4.8. 建立Azure Bot Service

請點擊此連結進行建立

https://portal.azure.com/#view/Microsoft_Azure_Marketplace/GalleryItemDetailsBladeNopdl/id/Microsoft.AzureBot/selectionMode~/false/resourceGroupId//resourceGroupLocation//dontDiscardJourney~/false/selectedMenuId/home/launchingContext~/%7B%22galleryItemId%22%3A%22Microsoft.AzureBot%22%2C%22source%22%3A%5B%22GalleryFeaturedMenuItemPart%22%2C%22VirtualizedTileDetails%22%5D%2C%22menuItemId%22%3A%22home%22%2C%22subMenuItemId%22%3A%22Search%20results%22%2C%22telemetryId%22%3A%22a09b3b54-129b-475f-bd39-d7285a272043%22%7D/searchTelemetryId/258b225f-e7d5-4744-bfe4-69fa701d9d5a

![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123524.png)

填寫紅框處必填資訊
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123623.png)

定價請選擇`Free`
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123656.png)

點擊檢閱+建立
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123715.png)

### 4.9. 配置Azure Bot Service

請將剛才複製的網址貼入`訊息端點`，後面記得加上`/api/messages`
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122425.png)

上圖的APP ID旁邊有個`管理密碼`，請點擊進入如下圖的畫面，建立一個用戶端密碼，並先記起來
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220122459.png)


進入頻道，找到可用通道，這邊可以自己選擇想要部署的地方，請自行參照設定設置即可
![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123254.png)

### 4.10. Telegram測試畫面

![](https://raw.githubusercontent.com/Mark850409/20241220_difyAzureBot/refs/heads/master/images/20241220123919.png)
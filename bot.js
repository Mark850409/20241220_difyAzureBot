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